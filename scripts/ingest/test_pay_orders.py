"""Tests for ``pay_orders.py``.

Two layers, deliberately: the parsing logic (``find_rate_change``,
``apply_da_rate_change``) is tested directly and needs no network at all; the
two ``check_*`` functions that fetch are tested against a scripted
``FakeSession``, the same pattern ``test_ingest.py`` uses for
``ncrb_sankalan.py``. ``main()`` is the thin CLI/JSON-emission shell around
both and is not separately tested, the same call ``CheckForUpdates.tsx``
makes about its own one-`fetch` shell on the frontend side.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pay_orders as po
import pay_orders_pr_body as po_body

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "pay-orders"


def load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


# --------------------------------------------------------------------------
# find_rate_change: the regex, against real extracted text
# --------------------------------------------------------------------------


class FindRateChange(unittest.TestCase):
    """The five REAL fixtures prove no false positive on real, confusing
    government-document noise. The synthetic one proves the regex can still
    find a true positive shaped like the real thing — see
    fixtures/pay-orders/SOURCES.md for why both halves are needed."""

    def test_matches_the_synthetic_wellformed_order(self):
        change = po.find_rate_change(load_fixture("synthetic-wellformed.txt"))
        self.assertIsNotNone(change)
        self.assertEqual(change.old_rate, 60)
        self.assertEqual(change.new_rate, 63)
        self.assertEqual(change.effective_from, "2027-07-01")
        self.assertIn("60%", change.snippet)
        self.assertIn("63%", change.snippet)

    def test_a_scanned_order_with_no_text_layer_does_not_match(self):
        # Both real, fetched fixtures for the two fixed-path DA order URLs.
        self.assertIsNone(po.find_rate_change(load_fixture("da-order-current.txt")))
        self.assertIsNone(po.find_rate_change(load_fixture("da-order-previous.txt")))

    def test_a_near_empty_scan_does_not_match(self):
        self.assertIsNone(po.find_rate_change(load_fixture("hra-om.txt")))

    def test_ta_da_entitlements_text_never_says_dearness_allowance(self):
        # Real, fetched: a genuine OCR text layer, percentages and "TA/DA"
        # throughout, never the words "Dearness Allowance". A regex keyed on
        # the letters "DA" alone would false-positive on this document.
        text = load_fixture("ta-da-nonofficials.txt")
        self.assertNotIn("dearness allowance", text.lower())
        self.assertIsNone(po.find_rate_change(text))

    def test_daily_allowance_next_to_a_percent_sign_does_not_match(self):
        # Real, fetched: "25o/o oI DA" (OCR for "25% of DA") sits in a
        # sentence about Daily Allowance, a different real DoE allowance
        # that is also abbreviated "DA". The sharper version of the trap
        # above: here "DA" and a percentage are directly adjacent.
        text = load_fixture("ta-rules-om-2018.txt")
        self.assertIn("Daily Allowance", text)
        self.assertIsNone(po.find_rate_change(text))

    def test_numeric_effective_date_is_also_recognised(self):
        text = (
            "Subject: Revision of rate of Dearness Allowance.\n"
            "the rate of Dearness Allowance shall be enhanced from the existing rate of 53% to 55% "
            "of the Basic Pay with effect from 01.01.2025."
        )
        change = po.find_rate_change(text)
        self.assertIsNotNone(change)
        self.assertEqual(change.effective_from, "2025-01-01")

    def test_an_impossible_date_is_not_a_match(self):
        text = (
            "Dearness Allowance shall be enhanced from the existing rate of 53% to 55% "
            "with effect from 31st February, 2025."
        )
        self.assertIsNone(po.find_rate_change(text))

    def test_an_implausible_rate_is_not_a_match(self):
        # `\d{1,3}` accepts up to 999, and data/pay/da-history.json's own
        # schema caps a rate at 300 — a schema-invalid rate reaching
        # apply_da_rate_change() used to crash the whole script with an
        # uncaught ValueError rather than degrade to manual review. This is
        # the guard that stops the implausible parse before it gets there:
        # OCR turning "60%" into "600%" or "960%" (a stray digit, or an
        # adjacent number bleeding into the match) is exactly a 3-digit
        # reading the regex alone would happily accept.
        text = (
            "Dearness Allowance shall be enhanced from the existing rate of 60% to 999% "
            "of the Basic Pay with effect from 1st July, 2027."
        )
        self.assertIsNone(po.find_rate_change(text))

    def test_a_rate_right_at_the_plausibility_ceiling_still_matches(self):
        text = (
            "Dearness Allowance shall be enhanced from the existing rate of 97% to 100% "
            "of the Basic Pay with effect from 1st July, 2027."
        )
        change = po.find_rate_change(text)
        self.assertIsNotNone(change)
        self.assertEqual(change.new_rate, 100)

    def test_no_effective_date_at_all_is_not_a_match(self):
        text = "Dearness Allowance shall be enhanced from the existing rate of 53% to 55% of the Basic Pay."
        self.assertIsNone(po.find_rate_change(text))


# --------------------------------------------------------------------------
# apply_da_rate_change
# --------------------------------------------------------------------------


def _minimal_da_history(rates: list[dict]) -> dict:
    return {
        "version": "1.0.0",
        "generatedAt": "2026-08-28",
        "disclaimer": {"en": "Reference only.", "hi": "केवल संदर्भ हेतु।"},
        "base": {"cpc": 7, "from": "2016-01-01", "index": 261.4, "linkingFactor": 2.88},
        "formula": {
            "expression": "DA% = ...",
            "description": {"en": "...", "hi": "..."},
            "source": {"name": "7th CPC report", "url": "https://doe.gov.in/x.pdf"},
        },
        "rates": rates,
    }


def _dummy_rate(effective_from: str, rate: int, status: str = "notified") -> dict:
    return {
        "effectiveFrom": effective_from,
        "rate": rate,
        "status": status,
        "note": None,
        "source": {"name": "Test source", "url": "https://doe.gov.in/test.pdf"},
        "fetchedAt": "2026-08-28T00:00:00Z",
        "verify": False,
    }


class ApplyDaRateChange(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "da-history.json"
        self.original_file = po.DA_HISTORY_FILE
        po.DA_HISTORY_FILE = self.path
        self.addCleanup(setattr, po, "DA_HISTORY_FILE", self.original_file)

        self.original_versions = None
        try:
            import ingest_common as common

            self.original_versions = common.VERSIONS_FILE
            common.VERSIONS_FILE = Path(self.dir.name) / "versions.json"
            self.addCleanup(setattr, common, "VERSIONS_FILE", self.original_versions)
        except ImportError:
            pass

        # 19 rates: the schema's own floor (minItems: 19).
        base_rates = [_dummy_rate(f"20{16 + i // 2:02d}-{'01' if i % 2 == 0 else '07'}-01", i) for i in range(19)]
        self.path.write_text(json.dumps(_minimal_da_history(base_rates)), encoding="utf-8")

    def test_writes_a_new_notified_rate(self):
        change = po.RateChange(old_rate=18, new_rate=20, effective_from="2027-01-01", snippet="...")
        changed, warnings = po.apply_da_rate_change(change, source_url="https://doe.gov.in/new.pdf", fetched_at="2027-04-01T00:00:00Z")
        self.assertTrue(changed)
        self.assertEqual(warnings, [])

        payload = json.loads(self.path.read_text(encoding="utf-8"))
        added = next(r for r in payload["rates"] if r["effectiveFrom"] == "2027-01-01")
        self.assertEqual(added["rate"], 20)
        self.assertEqual(added["status"], "notified")
        self.assertTrue(added["verify"])
        self.assertEqual(len(payload["rates"]), 20)

    def test_replaces_a_standing_projection_for_the_same_date(self):
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        payload["rates"].append({**_dummy_rate("2027-01-01", 22, status="projected"), "range": {"low": 21, "high": 23}})
        self.path.write_text(json.dumps(payload), encoding="utf-8")

        change = po.RateChange(old_rate=18, new_rate=20, effective_from="2027-01-01", snippet="...")
        po.apply_da_rate_change(change, source_url="https://doe.gov.in/new.pdf", fetched_at="2027-04-01T00:00:00Z")

        after = json.loads(self.path.read_text(encoding="utf-8"))
        matching = [r for r in after["rates"] if r["effectiveFrom"] == "2027-01-01"]
        self.assertEqual(len(matching), 1, "the projection must be replaced, not kept alongside the notified rate")
        self.assertEqual(matching[0]["status"], "notified")

    def test_refuses_to_overwrite_an_already_notified_rate(self):
        # The 19 base rates include one at 2025-01-01 (i=18).
        change = po.RateChange(old_rate=17, new_rate=99, effective_from="2025-01-01", snippet="...")
        with self.assertRaises(po.AlreadyRecorded):
            po.apply_da_rate_change(change, source_url="https://doe.gov.in/new.pdf", fetched_at="2027-04-01T00:00:00Z")
        # And it must not have touched the file.
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        self.assertEqual(len(payload["rates"]), 19)

    def test_refuses_to_overwrite_a_frozen_rate(self):
        # Real data/pay/da-history.json has exactly this shape: the 2020
        # COVID-era installments are `status: "frozen"`, not "notified" — an
        # announced-but-withheld rate is still a recorded historical fact,
        # not a placeholder the way a "projected" entry is. An earlier
        # version of this guard checked only `== "notified"` and silently
        # overwrote a frozen row with no warning at all — confirmed to
        # happen before this test was written to catch it.
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        frozen = next(r for r in payload["rates"] if r["effectiveFrom"] == "2020-01-01")
        frozen["status"] = "frozen"
        self.path.write_text(json.dumps(payload), encoding="utf-8")

        change = po.RateChange(old_rate=17, new_rate=77, effective_from="2020-01-01", snippet="...")
        with self.assertRaises(po.AlreadyRecorded):
            po.apply_da_rate_change(change, source_url="https://doe.gov.in/new.pdf", fetched_at="2027-04-01T00:00:00Z")

        after = json.loads(self.path.read_text(encoding="utf-8"))
        still_frozen = next(r for r in after["rates"] if r["effectiveFrom"] == "2020-01-01")
        self.assertEqual(still_frozen["status"], "frozen")
        self.assertEqual(still_frozen["rate"], frozen["rate"], "the frozen row's own rate must survive untouched")

    def test_warns_when_the_orders_own_previous_rate_disagrees_with_the_dataset(self):
        # The dataset's latest notified rate before 2027-01-01 is 18 (i=17,
        # 2026-07-01). Telling the order's own "old rate" as something else
        # should not stop the write, but must be surfaced.
        change = po.RateChange(old_rate=99, new_rate=20, effective_from="2027-01-01", snippet="...")
        _changed, warnings = po.apply_da_rate_change(
            change, source_url="https://doe.gov.in/new.pdf", fetched_at="2027-04-01T00:00:00Z"
        )
        self.assertEqual(len(warnings), 1)
        self.assertIn("99%", warnings[0])


# --------------------------------------------------------------------------
# check_da_order / check_allowances_index: fetch, via a FakeSession
# --------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status: int = 200, body: bytes = b"ok", headers: dict[str, str] | None = None):
        self.status_code = status
        self.content = body
        self.headers = headers or {}


class FakeSession:
    def __init__(self, script):
        self.script = list(script)
        self.calls: list[str] = []

    def get(self, url, **_kwargs):
        self.calls.append(url)
        item = self.script.pop(0) if self.script else FakeResponse()
        if isinstance(item, Exception):
            raise item
        return item


class CheckDaOrder(unittest.TestCase):
    def test_unchanged_content_is_not_reported(self):
        body = b"same bytes"
        seen = {"da-order": {"url": po.DA_ORDER_URL, "sha256": hashlib.sha256(body).hexdigest()}}
        session = FakeSession([FakeResponse(body=body)])
        result = po.check_da_order(seen, force=False, session=session)
        self.assertIsNone(result)

    def test_new_content_that_parses_is_a_rate_change_action(self):
        session = FakeSession([FakeResponse(body=b"a fresh pdf")])
        with mock.patch.object(po, "extract_text", return_value=load_fixture("synthetic-wellformed.txt")):
            result = po.check_da_order({}, force=False, session=session)
        self.assertEqual(result["kind"], "da-rate-change")
        self.assertEqual(result["change"].new_rate, 63)

    def test_new_content_that_does_not_parse_is_manual_review(self):
        session = FakeSession([FakeResponse(body=b"a fresh scanned pdf")])
        with mock.patch.object(po, "extract_text", return_value=""):
            result = po.check_da_order({}, force=False, session=session)
        self.assertEqual(result["kind"], "manual-review")
        self.assertEqual(result["url"], po.DA_ORDER_URL)

    def test_force_re_reports_unchanged_content(self):
        body = b"same bytes"
        seen = {"da-order": {"url": po.DA_ORDER_URL, "sha256": hashlib.sha256(body).hexdigest()}}
        session = FakeSession([FakeResponse(body=body)])
        with mock.patch.object(po, "extract_text", return_value=""):
            result = po.check_da_order(seen, force=True, session=session)
        self.assertIsNotNone(result)

    def test_a_fetch_failure_is_reported_and_not_raised(self):
        import requests

        session = FakeSession([requests.exceptions.ConnectionError("down")] * 3)
        result = po.check_da_order({}, force=False, session=session)
        self.assertIsNone(result)

    def test_a_200_response_that_is_not_actually_a_pdf_is_manual_review_not_a_crash(self):
        # The REAL `extract_text` runs here, deliberately not mocked: a 200
        # response with an accurate Content-Length that simply is not a PDF
        # — an HTML error page, a WAF challenge — passes `fetch()` (which
        # only checks the HTTP status and the transfer's own byte count)
        # and reaches `pdfplumber.open()`, which raises on it. Confirmed
        # to crash the whole run before this test existed, by feeding
        # `pdfplumber.open()` exactly this kind of body directly.
        html_error_page = b"<html><body>503 Service Unavailable</body></html>"
        session = FakeSession([FakeResponse(body=html_error_page)])
        result = po.check_da_order({}, force=False, session=session)
        self.assertEqual(result["kind"], "manual-review")
        self.assertEqual(result["url"], po.DA_ORDER_URL)
        self.assertIn("did not parse as a PDF", result["reason"])

    def test_an_empty_body_is_manual_review_not_a_crash(self):
        session = FakeSession([FakeResponse(body=b"")])
        result = po.check_da_order({}, force=False, session=session)
        self.assertEqual(result["kind"], "manual-review")


class CheckAllowancesIndex(unittest.TestCase):
    """Against ``doe-index.html`` — a real, complete `<table>` fetched from
    ALLOWANCES_INDEX_URL this session (see SOURCES.md). A first version of
    this parser matched the `<a>` tag's own text and silently found nothing:
    every download link on the real page just says "Download"; the real
    title lives in a sibling `<td class="views-field-title">` of the same
    `<tr>`. A hand-written HTML fixture would not have caught that — it
    would have had the title in the link, because that is the "obvious" way
    to write one."""

    HTML = load_fixture("doe-index.html")

    def test_new_keyword_matching_links_are_reported_with_their_real_titles(self):
        session = FakeSession([FakeResponse(body=self.HTML.encode())])
        actions = po.check_allowances_index({}, force=False, session=session)
        by_url = {a["url"]: a for a in actions}

        hra_url = "https://doe.gov.in/files/cenetral-pay_document/HRA_Eng_1.pdf"
        self.assertIn(hra_url, by_url)
        self.assertIn("House Rent Allowance", by_url[hra_url]["title"])

        ta_url = "https://doe.gov.in/files/cenetral-pay_document/TPTA_Eng.pdf"
        self.assertIn(ta_url, by_url)
        self.assertIn("Transport Allowance", by_url[ta_url]["title"])

        # "Rule 10 of CCS(RP) Rules 2016-Clarifications" is on the same real
        # page and matches none of the keyword groups.
        unrelated_url = "https://doe.gov.in/files/cenetral-pay_document/Rule_10_Clarification.pdf"
        self.assertNotIn(unrelated_url, by_url)

    def test_a_previously_seen_link_is_not_reported_again(self):
        hra_url = "https://doe.gov.in/files/cenetral-pay_document/HRA_Eng_1.pdf"
        seen = {"allowancesSeenUrls": [hra_url]}
        session = FakeSession([FakeResponse(body=self.HTML.encode())])
        actions = po.check_allowances_index(seen, force=False, session=session)
        urls = {a["url"] for a in actions}
        self.assertNotIn(hra_url, urls)
        self.assertIn("https://doe.gov.in/files/cenetral-pay_document/TPTA_Eng.pdf", urls)

    def test_force_re_reports_a_previously_seen_link(self):
        hra_url = "https://doe.gov.in/files/cenetral-pay_document/HRA_Eng_1.pdf"
        seen = {"allowancesSeenUrls": [hra_url]}
        session = FakeSession([FakeResponse(body=self.HTML.encode())])
        actions = po.check_allowances_index(seen, force=True, session=session)
        urls = {a["url"] for a in actions}
        self.assertIn(hra_url, urls)


class PrBody(unittest.TestCase):
    def test_a_rate_change_body_names_the_numbers_and_the_order(self):
        body = po_body.render(
            {
                "daHistoryChanged": True,
                "daOrder": {
                    "url": "https://doe.gov.in/x.pdf",
                    "oldRate": 60,
                    "newRate": 63,
                    "effectiveFrom": "2027-07-01",
                    "snippet": "enhanced from the existing rate of 60% to 63%",
                    "warnings": [],
                },
                "manualReview": [],
            }
        )
        self.assertIn("60% → 63%", body)
        self.assertIn("2027-07-01", body)
        self.assertIn("https://doe.gov.in/x.pdf", body)
        self.assertNotIn("Before merging:", body)

    def test_warnings_are_surfaced(self):
        body = po_body.render(
            {
                "daHistoryChanged": True,
                "daOrder": {
                    "url": "https://doe.gov.in/x.pdf",
                    "oldRate": 60,
                    "newRate": 63,
                    "effectiveFrom": "2027-07-01",
                    "snippet": "...",
                    "warnings": ["previous rate disagreement"],
                },
                "manualReview": [],
            }
        )
        self.assertIn("Before merging:", body)
        self.assertIn("previous rate disagreement", body)

    def test_a_seen_list_only_change_says_no_data_changed(self):
        body = po_body.render({"daHistoryChanged": False, "daOrder": None, "manualReview": []})
        self.assertIn("No data changed", body)

    def test_manual_review_count_is_mentioned(self):
        body = po_body.render(
            {
                "daHistoryChanged": False,
                "daOrder": None,
                "manualReview": [{"title": "a", "url": "u", "reason": "r"}, {"title": "b", "url": "u2", "reason": "r2"}],
            }
        )
        self.assertIn("2", body)
        self.assertIn("Issues tab", body)


if __name__ == "__main__":
    unittest.main()
