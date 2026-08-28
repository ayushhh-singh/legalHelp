"""Unit tests for the ingest pipeline. `python -m unittest discover -s scripts/ingest`.

Stdlib `unittest`, so the test dependency list stays empty. Every test here was
written against a defect that existed in the committed code and was verified to
fail before the fix, which is why several of them look oddly specific: the
specificity is the source's, not ours.

The network is never touched. `fetch` is driven through a fake session and a
fake clock; everything else is a pure function over strings and dicts.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ingest_common as common  # noqa: E402
from indiacode_seed import RateLimiter, has_hindi, hindi_share, is_spa_shell  # noqa: E402
from ncrb_sankalan import (  # noqa: E402
    RawRow,
    parse_correspondence,
    render_table,
    sentence_case,
    split_heading,
)


# --------------------------------------------------------------------------
# Section references
# --------------------------------------------------------------------------


class SectionReferences(unittest.TestCase):
    def test_normalises_the_three_spellings_the_source_uses(self):
        for raw, expected in [("103 (1)", "103(1)"), ("350( 1 )", "350(1)"), ("61(2) (a)", "61(2)(a)")]:
            self.assertEqual(common.parse_section_ref(raw).section, expected, raw)

    def test_a_capital_starting_the_heading_is_not_a_section_suffix(self):
        # "151 Arrest to prevent commission of cognizable offences." used to
        # parse as section 151A, which does not exist in the CrPC.
        ref = common.parse_section_ref("151 Arrest to prevent commission of cognizable offences.")
        self.assertEqual(ref.section, "151")
        self.assertEqual(ref.heading, "Arrest to prevent commission of cognizable offences.")

    def test_a_real_suffix_survives_with_or_without_a_space(self):
        for raw in ("498A. Cruelty", "498 A. Cruelty"):
            self.assertEqual(common.parse_section_ref(raw).section, "498A", raw)
        self.assertEqual(common.parse_section_ref("65B").section, "65B")
        self.assertEqual(common.parse_section_ref("376AB. Punishment").section, "376AB")

    def test_markers_and_chapter_rows_are_not_references(self):
        for raw in ("New Section", "New Sub-Section", "Deleted", "", "CHAPTER I - PRELIMINARY"):
            self.assertIsNone(common.parse_section_ref(raw), raw)

    def test_a_space_after_a_bracket_is_a_word_boundary_not_a_reference(self):
        ref = common.parse_section_ref("2(f) India")
        self.assertEqual(ref.section, "2(f)")
        self.assertEqual(ref.heading, "India")

    def test_sorts_the_way_a_reader_expects(self):
        given = ["103", "2(10)", "52A", "2", "2(2)", "1"]
        self.assertEqual(
            sorted(given, key=common.section_sort_key), ["1", "2", "2(2)", "2(10)", "52A", "103"]
        )


# --------------------------------------------------------------------------
# Determinism: the property the weekly cron depends on
# --------------------------------------------------------------------------


class QuietWeeks(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "dataset.json"

    def test_a_new_timestamp_alone_does_not_rewrite_a_dataset(self):
        first = {"fetchedAt": "2026-08-28T00:00:00Z", "sections": {"1": {"heading": "x"}}}
        common.write_if_content_changed(self.path, first)
        later = {"fetchedAt": "2026-09-04T00:00:00Z", "sections": {"1": {"heading": "x"}}}
        changed, _ = common.write_if_content_changed(self.path, later)
        self.assertFalse(changed)
        self.assertEqual(json.loads(self.path.read_text())["fetchedAt"], "2026-08-28T00:00:00Z")

    def test_a_real_change_is_written(self):
        common.write_if_content_changed(self.path, {"fetchedAt": "a", "sections": {"1": {"heading": "x"}}})
        changed, _ = common.write_if_content_changed(
            self.path, {"fetchedAt": "a", "sections": {"1": {"heading": "y"}}}
        )
        self.assertTrue(changed)

    def test_strip_volatile_reaches_nested_source_stamps(self):
        payload = {"sources": [{"url": "u", "fetchedAt": "t", "sha256": "d", "bytes": 1}]}
        self.assertEqual(common.strip_volatile(payload), {"sources": [{"url": "u"}]})

    def test_versions_generated_at_does_not_advance_on_its_own(self):
        # This is the whole reason the cron can be trusted to stay quiet: the
        # date used to be stamped before the comparison, so every week produced
        # a pull request containing nothing but a new date.
        original = common.VERSIONS_FILE
        try:
            common.VERSIONS_FILE = Path(self.dir.name) / "versions.json"
            entry = {"version": "1.0.0", "updated": "2026-08-28", "sha256": "a" * 64}
            self.assertTrue(common.update_versions({"law-bns": entry}, generated_at="2026-08-28T00:00:00Z"))
            self.assertFalse(common.update_versions({"law-bns": entry}, generated_at="2026-09-04T00:00:00Z"))
            self.assertEqual(json.loads(common.VERSIONS_FILE.read_text())["generatedAt"], "2026-08-28")
        finally:
            common.VERSIONS_FILE = original


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------


class FakeResponse:
    def __init__(self, status: int = 200, body: bytes = b"ok", headers: dict[str, str] | None = None):
        self.status_code = status
        self.content = body
        self.headers = headers or {}


class FakeSession:
    """Replays a scripted sequence of responses or exceptions."""

    def __init__(self, script):
        self.script = list(script)
        self.calls: list[str] = []

    def get(self, url, **_kwargs):
        self.calls.append(url)
        item = self.script.pop(0) if self.script else FakeResponse()
        if isinstance(item, Exception):
            raise item
        return item


class Fetching(unittest.TestCase):
    def setUp(self):
        self.slept: list[float] = []

    def fetch(self, urls, script, **kwargs):
        session = FakeSession(script)
        self.session = session
        return common.fetch(urls, session=session, sleep=self.slept.append, **kwargs)

    def test_retries_a_dropped_connection(self):
        # NCRB truncated the BSA PDF on a real run; without a retry the whole
        # weekly refresh failed and no pull request opened.
        import requests

        result = self.fetch(
            ["https://a/x.pdf"],
            [requests.exceptions.ChunkedEncodingError("Connection broken"), FakeResponse(body=b"pdf")],
        )
        self.assertEqual(result.content, b"pdf")
        self.assertEqual(len(self.session.calls), 2)
        self.assertTrue(self.slept)

    def test_retries_a_server_error_but_not_a_client_error(self):
        with self.assertRaises(common.FetchError):
            self.fetch(["https://a/x"], [FakeResponse(500)] * 3)
        self.assertEqual(len(self.session.calls), 3)

        with self.assertRaises(common.FetchError):
            self.fetch(["https://a/x"], [FakeResponse(404)] * 3)
        self.assertEqual(len(self.session.calls), 1, "a 404 is an answer, not weather")

    def test_a_403_stops_everything_with_no_retry_and_no_mirror(self):
        with self.assertRaises(common.Forbidden):
            self.fetch(["https://a/x", "https://mirror/x"], [FakeResponse(403), FakeResponse(200)])
        self.assertEqual(self.session.calls, ["https://a/x"])

    def test_a_short_body_is_a_failure_not_a_dataset(self):
        # A truncated document that parsed would be far worse than one that
        # failed: it looks like the source dropped half its sections.
        result = self.fetch(
            ["https://a/x"],
            [
                FakeResponse(body=b"half", headers={"Content-Length": "999"}),
                FakeResponse(body=b"whole", headers={"Content-Length": "5"}),
            ],
        )
        self.assertEqual(result.content, b"whole")

    def test_falls_through_to_the_mirror(self):
        result = self.fetch(["https://a/x", "https://b/x"], [FakeResponse(404), FakeResponse(body=b"m")])
        self.assertEqual(result.mirror_index, 1)


# --------------------------------------------------------------------------
# Chapters page
# --------------------------------------------------------------------------


class Headings(unittest.TestCase):
    def test_a_single_paragraph_section_is_split_into_heading_and_text(self):
        # BSA 25 runs the whole section together in one paragraph. Treating it
        # as a heading put an entire provision into the heading field.
        heading, body = split_heading(
            "25",
            [
                "25. Admissions not conclusive proof, but may estop . - Admissions are not conclusive "
                "proof of the matters admitted but they may operate as estoppels."
            ],
        )
        self.assertEqual(heading, "Admissions not conclusive proof, but may estop.")
        self.assertTrue(body[0].startswith("Admissions are not conclusive proof"))

    def test_a_section_with_no_heading_of_its_own_keeps_its_text(self):
        # BNSS 454 opens straight into the provision.
        heading, body = split_heading("454", ["454. When a sentence of death is passed by the High Court."])
        self.assertEqual(heading, "")
        self.assertEqual(body, ["When a sentence of death is passed by the High Court."])

    def test_the_ordinary_shape_is_untouched(self):
        heading, body = split_heading("103", ["Punishment for murder.", "103.", "(1) Whoever commits murder"])
        self.assertEqual(heading, "Punishment for murder.")
        self.assertEqual(body, ["(1) Whoever commits murder"])

    def test_chapter_titles_are_sentence_case_not_title_case(self):
        self.assertEqual(
            sentence_case("OF CONTEMPTS OF THE LAWFUL AUTHORITY OF PUBLIC SERVANTS"),
            "Of contempts of the lawful authority of public servants",
        )
        self.assertEqual(sentence_case("Already fine"), "Already fine")


# --------------------------------------------------------------------------
# Correspondence table
# --------------------------------------------------------------------------

TABLE = """
<table id="example"><tbody>
  <tr><td><p>CHAPTER I - PRELIMINARY</p></td><td><p>CHAPTER I</p></td></tr>
  <tr><td><p>103. Punishment for murder. (Change)</p><p>103(1)</p></td><td><p>302. Punishment for murder.</p></td></tr>
  <tr><td><p>2(3)</p></td><td><p>New Sub-Section</p></td></tr>
  <tr><td><p>Deleted</p></td><td><p>309. Attempt to commit suicide.</p></td></tr>
</tbody></table>
"""


class Correspondence(unittest.TestCase):
    def rows(self) -> list[RawRow]:
        from bs4 import BeautifulSoup

        return parse_correspondence(BeautifulSoup(TABLE, "lxml"))

    def test_drops_chapter_banners_and_reads_the_rest(self):
        rows = self.rows()
        self.assertEqual(len(rows), 3)

    def test_reads_the_change_marker_and_the_most_specific_reference(self):
        row = self.rows()[0]
        self.assertTrue(row.changed)
        self.assertEqual(row.new_ref.section, "103(1)")
        self.assertEqual(row.new_ref.heading, "Punishment for murder.")
        self.assertEqual([o.section for o in row.old_refs], ["302"])

    def test_recognises_a_new_provision_and_a_deletion(self):
        _, new_provision, deleted = self.rows()
        self.assertTrue(new_provision.is_new_provision)
        self.assertEqual(new_provision.old_refs, [])
        self.assertTrue(deleted.is_deleted)
        self.assertEqual([o.section for o in deleted.old_refs], ["309"])


# --------------------------------------------------------------------------
# Generated Markdown
# --------------------------------------------------------------------------


class GeneratedTable(unittest.TestCase):
    def test_pads_columns_the_way_prettier_does(self):
        # docs/DATA-GAPS.md is Prettier-formatted and this block is rewritten
        # weekly; an unpadded table means `pnpm format` and the cron fight over
        # the file forever. Every column is padded to its widest cell, left
        # columns left-aligned and numeric columns right-aligned with a
        # trailing colon in the separator -- which is exactly what Prettier
        # emits. The end-to-end proof is `pnpm exec prettier --check
        # docs/DATA-GAPS.md` immediately after an ingest run.
        lines = render_table(["Code", "N"], [["BNS", "358"], ["BSA", "1"]], ["left", "right"])
        self.assertEqual(
            lines,
            [
                "| Code |   N |",
                "| ---- | --: |",
                "| BNS  | 358 |",
                "| BSA  |   1 |",
            ],
        )


# --------------------------------------------------------------------------
# India Code seed
# --------------------------------------------------------------------------


class IndiaCodeSeed(unittest.TestCase):
    def test_one_devanagari_character_is_not_a_hindi_page(self):
        english = "Punishment for murder. Whoever commits murder shall be punished. " * 20 + "हिंदी"
        self.assertFalse(has_hindi(english))
        self.assertLess(hindi_share(english), 0.05)

    def test_a_hindi_provision_is_recognised(self):
        self.assertTrue(has_hindi("हत्या के लिए दण्ड। जो कोई हत्या करेगा वह दण्डित किया जाएगा। Section 103"))

    def test_an_empty_page_is_not_hindi(self):
        self.assertEqual(hindi_share(""), 0.0)
        self.assertFalse(has_hindi("12345 !@#"))

    def test_a_client_rendered_shell_is_not_an_empty_result(self):
        # India Code is an Angular app now. Parsing its shell yields nothing,
        # which must read as "cannot be read without a browser" rather than as
        # "this Act is not on India Code".
        self.assertTrue(is_spa_shell('<html><body><app-root></app-root></body></html>'))
        self.assertTrue(is_spa_shell("<html><body><div id='x'></div></body></html>"))
        self.assertFalse(
            is_spa_shell(
                "<html><body>" + "<a href='/1'>The Bharatiya Nyaya Sanhita, 2023</a>" * 4 + "x" * 500 + "</body></html>"
            )
        )

    def test_the_rate_limiter_does_not_stall_the_first_request(self):
        slept: list[float] = []
        limiter = RateLimiter(seconds=3.0)
        limiter.wait()
        self.assertEqual(slept, [])


if __name__ == "__main__":
    unittest.main()


class RawArchive(unittest.TestCase):
    def test_keeps_the_newest_copies_and_drops_the_rest(self):
        with tempfile.TemporaryDirectory() as tmp:
            original = common.RAW_DIR
            try:
                common.RAW_DIR = Path(tmp)
                for stamp in ("20260101T000000Z", "20260201T000000Z", "20260301T000000Z", "20260401T000000Z"):
                    (common.RAW_DIR / f"{stamp}__page.html").write_text("x")
                    (common.RAW_DIR / f"{stamp}__page.html.meta.json").write_text("{}")
                common.prune_raw("page.html", keep=2)
                left = sorted(p.name for p in common.RAW_DIR.glob("*__page.html"))
                self.assertEqual(left, ["20260301T000000Z__page.html", "20260401T000000Z__page.html"])
                self.assertEqual(len(list(common.RAW_DIR.glob("*.meta.json"))), 2)
            finally:
                common.RAW_DIR = original
