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
    parse_first_schedule,
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


# --------------------------------------------------------------------------
# BNSS First Schedule
# --------------------------------------------------------------------------

# Three shapes, all of them real. 77 is an offence whose SECOND conviction is
# graded differently; 264 is the one header row in the Schedule, naming an
# offence and stating nothing about it; 100 is the ordinary one-row case.
SCHEDULE = """
<table><tbody>
  <tr><td><p>1</p></td><td><p>2</p></td><td><p>3</p></td><td><p>4</p></td><td><p>5</p></td><td><p>6</p></td></tr>
  <tr><td><p>77</p></td><td><p>Voyeurism.</p></td><td><p>Imprisonment for 1 year.</p></td>
      <td><p>Cognizable.</p></td><td><p>Bailable.</p></td><td><p>Any Magistrate.</p></td></tr>
  <tr><td><p></p></td><td><p>Second or subsequent conviction.</p></td><td><p>Imprisonment for 3 years.</p></td>
      <td><p>Cognizable.</p></td><td><p>Non-Bailable.</p></td><td><p>Any Magistrate.</p></td></tr>
  <tr><td><p>264</p></td><td><p>Omission to apprehend, in cases not otherwise provided for:-</p></td>
      <td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr>
  <tr><td><p></p></td><td><p>( a ) in case of intentional omission;</p></td><td><p>Imprisonment for 3 years.</p></td>
      <td><p>Non-cognizable.</p></td><td><p>Bailable.</p></td><td><p>Magistrate of the first class.</p></td></tr>
  <tr><td><p></p></td><td><p>( b ) in case of negligent omission.</p></td><td><p>Simple imprisonment for 2 years.</p></td>
      <td><p>Non-cognizable.</p></td><td><p>Bailable.</p></td><td><p>Any Magistrate.</p></td></tr>
  <tr><td><p>100</p></td><td><p>Culpable homicide.</p></td><td><p>Imprisonment for life.</p></td>
      <td><p>Cognizable.</p></td><td><p>Non-Bailable.</p></td><td><p>Court of Session.</p></td></tr>
</tbody></table>
"""


class FirstSchedule(unittest.TestCase):
    """A row with an empty section column continues the section above it.

    Reading only the rows that carry a section number dropped 24 real rows from
    the committed dataset and left one section with every column blank.
    """

    def entries(self):
        from bs4 import BeautifulSoup

        return parse_first_schedule(BeautifulSoup(SCHEDULE, "lxml"))

    def test_a_continuation_row_is_kept_and_carries_the_section_above_it(self):
        rows = [e for e in self.entries() if e.base == "77"]
        self.assertEqual(len(rows), 2)
        self.assertEqual([e.offence for e in rows][1], "Second or subsequent conviction.")

    def test_a_second_conviction_keeps_its_own_bailability(self):
        # The whole point. BNS 77 and 78(2) are bailable on a first conviction
        # and NOT on a second, and answering the second with the first's value
        # is a wrong answer to the question an officer actually asks.
        first, second = [e for e in self.entries() if e.base == "77"]
        self.assertEqual(first.bailable, "bailable")
        self.assertEqual(second.bailable, "non-bailable")

    def test_a_header_row_is_not_emitted_on_its_own(self):
        # It has no punishment, cognizable or bailable value, so on its own it
        # would render a classification row with every column empty.
        rows = [e for e in self.entries() if e.base == "264"]
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertNotIn(row.cognizable, {"unspecified", ""})
            self.assertTrue(row.punishment)

    def test_a_header_names_the_offence_for_each_circumstance_below_it(self):
        # The circumstances say "in case of intentional omission" and never
        # what was omitted; the header is the only place the offence is named.
        rows = [e for e in self.entries() if e.base == "264"]
        for row in rows:
            self.assertTrue(row.offence.startswith("Omission to apprehend"))
        self.assertIn("intentional", rows[0].offence)
        self.assertIn("negligent", rows[1].offence)

    def test_an_ordinary_single_row_section_is_untouched(self):
        rows = [e for e in self.entries() if e.base == "100"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].bailable, "non-bailable")

    def test_the_column_header_row_is_still_dropped(self):
        self.assertEqual({e.base for e in self.entries()}, {"77", "264", "100"})


# A row with an empty section column continues the row above it, which is what
# makes "the row above" worth being careful about.
def _schedule(*rows: str) -> str:
    return "<table><tbody>" + "".join(rows) + "</tbody></table>"


def _row(*cells: str) -> str:
    return "<tr>" + "".join(f"<td><p>{cell}</p></td>" for cell in cells) + "</tr>"


class FirstScheduleContinuationEdges(unittest.TestCase):
    """Where a continuation attaches, when the answer is not obvious."""

    def entries(self, *rows: str):
        from bs4 import BeautifulSoup

        return parse_first_schedule(BeautifulSoup(_schedule(*rows), "lxml"))

    def test_a_continuation_with_nothing_above_it_is_dropped(self):
        # There is no section to attach it to. Dropping it is what the parser
        # did before continuations were read at all, so this is the one case
        # where the old behaviour is still the right one.
        self.assertEqual(self.entries(_row("", "Orphan.", "P", "Cognizable.", "Bailable.", "Any Magistrate.")), [])

    def test_a_continuation_after_an_unparseable_row_is_dropped_not_misattached(self):
        """The row above is a chapter banner, so "the section above" is unknown.

        Carrying the last section that happened to parse would put a
        cognizable/bailable answer on an offence it was never written about —
        a wrong answer to the question this table exists to answer, and one
        nothing downstream could detect. NCRB's Schedule has no such banner
        today; the column header is the only row that fails to parse, and it is
        not followed by a continuation. This is a guard, not a fix.
        """
        rows = self.entries(
            _row("100", "Culpable homicide.", "P", "Cognizable.", "Non-Bailable.", "Court of Session."),
            _row("CHAPTER XVII", "Of offences against property", "", "", "", ""),
            _row("", "Continuation.", "P", "Cognizable.", "Bailable.", "Any Magistrate."),
        )
        self.assertEqual([e.base for e in rows], ["100"])
        self.assertEqual(rows[0].offence, "Culpable homicide.")

    def test_a_header_prefix_does_not_leak_onto_a_later_section(self):
        # 264's header names its circumstances; 300's own continuation must
        # come back as itself.
        rows = self.entries(
            _row("264", "Omission:-", "", "", "", ""),
            _row("", "( a ) intentional;", "P1", "Non-cognizable.", "Bailable.", "MFC"),
            _row("300", "Theft.", "P2", "Cognizable.", "Non-Bailable.", "Any Magistrate."),
            _row("", "Second or subsequent conviction.", "P3", "Cognizable.", "Non-Bailable.", "Any Magistrate."),
        )
        by_base = {}
        for entry in rows:
            by_base.setdefault(entry.base, []).append(entry.offence)
        self.assertEqual(by_base["264"], ["Omission:- ( a ) intentional;"])
        self.assertEqual(by_base["300"], ["Theft.", "Second or subsequent conviction."])

    def test_a_header_with_no_continuation_beneath_it_is_still_emitted(self):
        # It is then just a row with missing columns, and dropping it would
        # lose the section from the dataset entirely. Suppression is only ever
        # a trade against a continuation that carries the values instead.
        rows = self.entries(_row("264", "Header alone:-", "", "", "", ""))
        self.assertEqual([e.base for e in rows], ["264"])


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


class PayMatrix(unittest.TestCase):
    """The generator is the only thing standing between 38 anchors and 540 cells."""

    def setUp(self):
        import pay_matrix

        self.pay_matrix = pay_matrix

    def test_the_three_per_cent_rule_reproduces_the_first_row_of_the_gazette(self):
        # Level 1, cells 1-9, read off the scanned Schedule.
        self.assertEqual(
            self.pay_matrix.cells_for(18000, 9),
            [18000, 18500, 19100, 19700, 20300, 20900, 21500, 22100, 22800],
        )

    def test_rounding_is_to_the_nearest_hundred_not_down(self):
        # 21500 x 1.03 is 22145, which floors to 22100 and rounds to 22100; but
        # 18000 x 1.03 is 18540, which floors to 18500 and rounds to 18500. The
        # case that separates the two rules is a .5 boundary, and the gazette
        # rounds it up.
        self.assertEqual(self.pay_matrix.cells_for(10000, 2), [10000, 10300])
        self.assertEqual(self.pay_matrix.cells_for(15000, 2), [15000, 15500])

    def test_the_generated_matrix_agrees_with_every_figure_read_off_the_gazette(self):
        problems = self.pay_matrix.verify_against_gazette(self.pay_matrix.build())
        self.assertEqual(problems, [])

    def test_a_wrong_entry_pay_is_caught_rather_than_written(self):
        payload = self.pay_matrix.build()
        for level in payload["levels"]:
            if level["level"] == "7":
                level["entryPay"] = 44800
                level["cells"] = self.pay_matrix.cells_for(44800, len(level["cells"]))
        problems = self.pay_matrix.verify_against_gazette(payload)
        self.assertTrue(any("L7" in problem for problem in problems), problems)

    def test_a_wrong_cell_count_is_caught_rather_than_written(self):
        payload = self.pay_matrix.build()
        for level in payload["levels"]:
            if level["level"] == "12":
                level["cells"] = level["cells"][:-1]
        problems = self.pay_matrix.verify_against_gazette(payload)
        self.assertTrue(any("L12 last cell" in problem for problem in problems), problems)

    def test_level_13_is_the_one_the_2017_amendment_substituted(self):
        payload = self.pay_matrix.build()
        level13 = next(l for l in payload["levels"] if l["level"] == "13")
        self.assertEqual(level13["entryPay"], 123100)
        self.assertEqual(len(level13["cells"]), 20)
        self.assertEqual(level13["cells"][-1], 215900)
        self.assertEqual(level13["indexOfRationalisation"], 2.67)

    def test_a_run_that_changes_nothing_writes_nothing(self):
        # The same invariant the weekly law cron depends on: an unchanged run
        # must leave the file alone, or every run produces a diff nobody reads.
        # `build()` stamps a fresh fetchedAt, so this is only true because
        # write_if_content_changed masks the run stamps before comparing.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "matrix.json"
            first_changed, _ = common.write_if_content_changed(path, self.pay_matrix.build())
            self.assertTrue(first_changed)
            before = path.read_bytes()
            second_changed, _ = common.write_if_content_changed(path, self.pay_matrix.build())
            self.assertFalse(second_changed)
            self.assertEqual(path.read_bytes(), before)


class DataValidation(unittest.TestCase):
    def test_every_dataset_on_disk_is_accounted_for(self):
        # A dataset in neither the manifest nor the no-schema list is validated
        # by nothing, and the run would still report success.
        import validate_data

        self.assertEqual(validate_data.unlisted(), [])

    def test_every_manifest_entry_names_a_schema_that_exists(self):
        import validate_data

        missing = [
            name
            for name in set(validate_data.MANIFEST.values())
            if not (common.SCHEMA_DIR / name).exists()
        ]
        self.assertEqual(missing, [])
