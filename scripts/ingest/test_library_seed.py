"""Tests for the Library seed.

Run with the rest of the ingest suite:

    scripts/ingest/.venv/bin/python -m unittest discover -s scripts/ingest -t scripts/ingest

The Vitest side (``tests/library-data.test.ts``) reads the committed JSON and
checks what it says. This side checks the thing that produces it — in
particular that ``self_check`` actually rejects the broken works it claims to,
because every one of those failures reaches a reader as a table of contents
whose rows open onto nothing.
"""

from __future__ import annotations

import copy
import unittest

import library_seed as seed


def a_work() -> dict:
    """A real work, built from the committed corpus, to be broken in peace."""
    return copy.deepcopy(seed.build_rules_work(next(m for m in seed.RULE_WORKS if m["id"] == "rti")))


class WordCount(unittest.TestCase):
    def test_separates_the_two_scripts(self) -> None:
        latin, devanagari = seed.word_count("two English words और दो हिंदी शब्द")
        self.assertEqual(latin, 3)
        self.assertEqual(devanagari, 4)

    def test_counts_nothing_in_an_empty_string(self) -> None:
        self.assertEqual(seed.word_count("   "), (0, 0))


class Minutes(unittest.TestCase):
    def test_uses_a_different_rate_per_script(self) -> None:
        # 180 English words is one minute; 140 Devanagari words is also one.
        self.assertEqual(seed.minutes_for(180, 0), 1)
        self.assertEqual(seed.minutes_for(0, 140), 1)
        self.assertEqual(seed.minutes_for(180, 140), 2)

    def test_never_reports_less_than_a_minute(self) -> None:
        # A two-line rule still takes a moment to read.
        self.assertEqual(seed.minutes_for(0, 0), 1)
        self.assertEqual(seed.minutes_for(3, 0), 1)


class Excerpts(unittest.TestCase):
    def test_caps_a_long_opening_on_a_word_boundary(self) -> None:
        text = {"en": " ".join(["word"] * 60), "hi": ""}
        excerpt = seed.excerpt_of(text)
        self.assertLessEqual(len(excerpt["en"]), seed.EXCERPT_CHARS + 1)
        self.assertTrue(excerpt["en"].endswith("…"))
        self.assertFalse(excerpt["en"].endswith("wo…"))

    def test_leaves_a_short_opening_alone_and_adds_no_ellipsis(self) -> None:
        self.assertEqual(seed.excerpt_of({"en": "Short rule.", "hi": ""})["en"], "Short rule.")

    def test_collapses_whitespace_rather_than_carrying_a_line_break(self) -> None:
        self.assertEqual(seed.excerpt_of({"en": "a\n  b", "hi": ""})["en"], "a b")


class Leaves(unittest.TestCase):
    def test_emits_an_excerpt_only_where_a_heading_is_missing(self) -> None:
        text = {"en": "Some text.", "hi": ""}
        complete = seed.leaf("n-1", "1", {"en": "A", "hi": "क"}, "u-1", text)
        self.assertNotIn("excerpt", complete)

        partial = seed.leaf("n-2", "2", {"en": "", "hi": "क"}, "u-2", text)
        self.assertIn("excerpt", partial)


class CardCounts(unittest.TestCase):
    def test_counts_only_approved_cards(self) -> None:
        counts = seed.served_card_counts("ccs-conduct")
        self.assertGreater(len(counts), 0)
        self.assertTrue(all(value > 0 for value in counts.values()))
        # Every key resolves into the rule text the cards cite.
        self.assertTrue(all(key.startswith("ccs-conduct-") for key in counts))

    def test_is_empty_for_an_act_with_no_card_file(self) -> None:
        self.assertEqual(seed.served_card_counts("no-such-act"), {})


class SelfCheck(unittest.TestCase):
    """The cross-references a JSON Schema cannot see."""

    def setUp(self) -> None:
        self.work = a_work()
        self.index = seed.build_index([self.work] * 15)

    def test_accepts_what_the_script_actually_builds(self) -> None:
        works = [seed.build_rules_work(m) for m in seed.RULE_WORKS]
        works += [seed.build_law_work(m) for m in seed.LAW_WORKS]
        self.assertEqual(seed.self_check(works, seed.build_index(works)), 0)

    def test_rejects_a_unit_id_the_corpus_does_not_have(self) -> None:
        # The failure that matters: a table of contents row that opens onto
        # nothing. Nothing else in the pipeline would catch it.
        broken = self.work
        broken["readingOrder"].append("rti-999")
        broken["toc"].append(
            {"id": "n-rti-999", "number": "999", "heading": {"en": "Ghost", "hi": "क"}, "unitIds": ["rti-999"]}
        )
        self.assertGreater(seed.self_check([broken], self.index), 0)

    def test_rejects_a_toc_that_does_not_cover_the_reading_order(self) -> None:
        broken = self.work
        broken["toc"] = broken["toc"][:-1]
        self.assertGreater(seed.self_check([broken], self.index), 0)

    def test_rejects_a_branch_that_lost_its_children(self) -> None:
        law = seed.build_law_work(next(m for m in seed.LAW_WORKS if m["id"] == "bsa"))
        law["toc"][0]["children"] = law["toc"][0]["children"][1:]
        self.assertGreater(seed.self_check([law], self.index), 0)

    def test_rejects_a_repeated_unit_in_the_reading_order(self) -> None:
        broken = self.work
        broken["readingOrder"].append(broken["readingOrder"][0])
        self.assertGreater(seed.self_check([broken], self.index), 0)

    def test_rejects_a_practise_count_against_a_unit_of_another_work(self) -> None:
        broken = self.work
        broken["practiseCounts"]["ccs-conduct-1"] = 3
        self.assertGreater(seed.self_check([broken], self.index), 0)

    def test_rejects_a_work_with_no_hindi_description(self) -> None:
        broken = self.work
        broken["description"]["hi"] = "  "
        self.assertGreater(seed.self_check([broken], self.index), 0)

    def test_rejects_a_shelf_that_is_not_fifteen_works(self) -> None:
        self.assertGreater(seed.self_check([self.work], seed.build_index([self.work])), 0)


class Structure(unittest.TestCase):
    def test_reads_chapters_where_the_corpus_records_them(self) -> None:
        law = seed.build_law_work(next(m for m in seed.LAW_WORKS if m["id"] == "bsa"))
        self.assertEqual(law["tocSource"], "chapters")
        self.assertTrue(all(node.get("children") for node in law["toc"]))

    def test_reads_csmops_own_paragraph_numbering(self) -> None:
        csmop = seed.build_rules_work(next(m for m in seed.RULE_WORKS if m["id"] == "csmop"))
        self.assertEqual(csmop["tocSource"], "numbering")
        self.assertEqual(csmop["toc"][0]["number"], "1")

    def test_invents_nothing_for_a_book_that_publishes_no_division(self) -> None:
        # The session brief's own instruction: where the corpus has no chapter
        # information, produce a FLAT table of contents and record the gap,
        # rather than grouping rules by a rule this repository made up.
        gfr = seed.build_rules_work(next(m for m in seed.RULE_WORKS if m["id"] == "gfr"))
        self.assertEqual(gfr["tocSource"], "flat")
        self.assertTrue(all("children" not in node for node in gfr["toc"]))


class Pointers(unittest.TestCase):
    def test_never_copies_the_text(self) -> None:
        # The whole design: a work is structure over bytes that live elsewhere.
        # A `text` key anywhere in a work file would mean a second copy of a
        # statute that a dataset refresh could not correct.
        work = a_work()
        serialised = repr(work)
        self.assertNotIn("'text'", serialised)
        self.assertEqual(work["corpus"], {"kind": "rules", "file": "rules/text/rti.json"})


if __name__ == "__main__":
    unittest.main()
