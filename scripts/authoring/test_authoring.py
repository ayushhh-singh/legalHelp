"""Unit tests for the rules-authoring pipeline.

    scripts/ingest/.venv/bin/python -m unittest discover -s scripts/authoring -t scripts/authoring

Run with Python's own ``unittest``, not with ``pnpm test`` — same arrangement as
``scripts/ingest/test_ingest.py``. ``pnpm check`` does not run these; CI does.

Every test here was written against a defect the pipeline actually had. The
parser ones in particular: each names the document that broke it and what the
wrong output looked like, because "the sequence walk handles footnotes" is not a
claim anyone can check and "Rule 11 of the Conduct rules is printed 3911." is.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import authoring_common as common  # noqa: E402
import extract_rules as extract  # noqa: E402
import make_cards as cards  # noqa: E402
import qa_pipeline as qa  # noqa: E402


class TestActRegistry(unittest.TestCase):
    def test_every_act_has_an_english_document(self) -> None:
        for act in common.ACTS:
            with self.subTest(act=act.id):
                self.assertTrue(any(doc.lang == "en" for doc in act.documents))

    def test_act_ids_are_unique_and_slugged(self) -> None:
        ids = [act.id for act in common.ACTS]
        self.assertEqual(len(ids), len(set(ids)))
        for act_id in ids:
            self.assertRegex(act_id, r"^[a-z0-9-]+$")

    def test_every_document_url_is_https_or_a_stated_http_fallback(self) -> None:
        for act, doc in common.iter_documents():
            for url in doc.urls:
                with self.subTest(file=doc.filename):
                    self.assertTrue(url.startswith("https://"), f"{act.id}: {url}")

    def test_every_act_names_both_languages_of_its_unit(self) -> None:
        for act in common.ACTS:
            with self.subTest(act=act.id):
                self.assertTrue(act.unit_en and act.unit_hi)
                self.assertTrue(act.name_hi and act.short_hi)


class TestNoInferenceApi(unittest.TestCase):
    """The working agreement: zero paid services, and no model call anywhere.

    The questions in ``authored/`` were written in session and committed as
    data. Nothing in this directory may reach an inference endpoint, and this is
    the check that says so rather than the README.
    """

    FORBIDDEN = (
        "api.anthropic.com",
        "api.openai.com",
        "generativelanguage.googleapis.com",
        "openai",
        "anthropic",
        "huggingface",
        "transformers",
    )

    def test_no_module_here_names_an_inference_endpoint(self) -> None:
        # This file is skipped: it is the only one that has to spell the names
        # out, and a check that fails on its own allowlist checks nothing.
        for path in sorted(Path(__file__).parent.glob("*.py")):
            if path.name == Path(__file__).name:
                continue
            body = path.read_text(encoding="utf-8").lower()
            for needle in self.FORBIDDEN:
                with self.subTest(file=path.name, needle=needle):
                    self.assertNotIn(needle, body)

    def test_certificate_verification_is_never_disabled(self) -> None:
        """No call in this directory passes ``verify=False``.

        Checked by parsing rather than by grepping: the module docstrings say
        the words "verify=False appears nowhere", and a substring check fails on
        the sentence that promises it.
        """
        import ast

        for path in sorted(Path(__file__).parent.glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                for keyword in node.keywords:
                    if keyword.arg != "verify":
                        continue
                    with self.subTest(file=path.name, line=node.lineno):
                        self.assertNotEqual(
                            getattr(keyword.value, "value", None),
                            False,
                            f"{path.name}:{node.lineno} disables certificate verification",
                        )


class TestFurniture(unittest.TestCase):
    def test_a_rule_marker_is_not_furniture(self) -> None:
        """"1." appears on 24 pages of the Conduct rules and is a rule marker.

        Dropping it as a repeated line cost that rule book fourteen of its
        twenty-five rules, and the parse that survived was of the amendment
        history at the back.
        """
        for marker in ("1.", "11.", "3A.", "5.2.", "(i)", "(b)"):
            with self.subTest(marker=marker):
                self.assertFalse(extract.is_furniture_eligible(marker))

    def test_a_running_head_is_furniture(self) -> None:
        for head in (
            "CENTRAL CIVIL SERVICES (CONDUCT) RULES, 1964",
            "THE GAZETTE OF INDIA : EXTRAORDINARY",
        ):
            with self.subTest(head=head):
                self.assertTrue(extract.is_furniture_eligible(head))

    def test_a_bare_page_number_is_dropped_but_a_rule_marker_is_kept(self) -> None:
        pages = ["7\n1.\nShort title\nbody text here", "8\n2.\nDefinitions\nmore body text"]
        text, _ = extract.strip_furniture(pages)
        self.assertIn("1.", text)
        self.assertIn("2.", text)
        self.assertNotIn("\n7\n", f"\n{text}\n")


class TestReadings(unittest.TestCase):
    def test_a_footnote_prefix_is_offered_as_a_trim(self) -> None:
        # Rule 11 of the Conduct rules is printed "3911." — footnote 39, then 11.
        self.assertIn("11", extract.readings("3911"))
        self.assertIn("3C", extract.readings("433C"))

    def test_a_two_digit_number_is_never_trimmed(self) -> None:
        # "31. Repeal." on the RTI arrangement-of-sections page trimmed to "1"
        # and became a Section 1 headed "Repeal" whose text was the contents.
        self.assertEqual(extract.readings("31"), ("31",))

    def test_a_number_alone_on_its_line_is_never_trimmed(self) -> None:
        # The Leave rules end a sentence with the bare line "1972.", which
        # trimmed to "2" and swallowed Rule 1's second sub-rule.
        self.assertEqual(extract.readings("1972", line_continues=False), ("1972",))

    def test_a_suffixed_number_is_left_alone(self) -> None:
        self.assertEqual(extract.readings("3A"), ("3A",))


class TestHeadings(unittest.TestCase):
    def test_a_heading_that_wrapped_is_joined(self) -> None:
        heading, body = extract.split_heading(
            "Short title, extent and",
            "\n\napplication. (1) This Act may be called the Official Secrets Act, 1923.",
        )
        self.assertEqual(heading, "Short title, extent and application")
        self.assertTrue(body.startswith("(1) This Act"))

    def test_a_complete_heading_is_not_joined_to_the_next_line(self) -> None:
        # The DoPT books print the heading on its own line and the text on the
        # next; joining unconditionally left the rule with no heading at all.
        heading, body = extract.split_heading(
            "Short title and commencement",
            "\n(1) These rules may be called the Central Civil Services (Leave) Rules, 1972.",
        )
        self.assertEqual(heading, "Short title and commencement")
        self.assertTrue(body.startswith("(1) These rules"))

    def test_a_hyphen_inside_a_word_does_not_end_a_heading(self) -> None:
        heading, _ = extract.split_heading("Canvassing of non-official or other outside influence", "")
        self.assertEqual(heading, "Canvassing of non-official or other outside influence")

    def test_a_dash_followed_by_a_space_does_end_a_heading(self) -> None:
        heading, body = extract.split_heading(
            "Short title and Commencement- (1) This Act may be called the Official Languages Act, 1963.",
            "",
        )
        self.assertEqual(heading, "Short title and Commencement")
        self.assertTrue(body.startswith("(1) This Act"))

    def test_a_fused_footnote_is_stripped_from_a_heading(self) -> None:
        heading, _ = extract.split_heading("12Restriction regarding marriage-", "")
        self.assertEqual(heading, "Restriction regarding marriage")


class TestSequenceWalk(unittest.TestCase):
    def _candidates(self, spec: list[tuple[int, str]]) -> list[extract.Candidate]:
        return [
            extract.Candidate(offset=offset, end=offset + 4, numbers=extract.readings(number), rest="x")
            for offset, number in spec
        ]

    def test_the_longest_substantive_chain_wins(self) -> None:
        """A table of one-liners must not beat the rule book.

        The Conduct rules end with twenty-five numbered amendment entries. They
        form a perfectly increasing sequence and outnumbered the rules the
        parser managed to chain, so the parse that "succeeded" was of the table.
        """
        body = [(0, "1"), (400, "2"), (800, "3")]  # spaced out: real rules
        table = [(2000 + i * 30, str(i + 1)) for i in range(6)]  # one-liners
        chain = extract.walk_sequence(
            self._candidates(body + table), first="1", max_rule=25, end_of_text=2400
        )
        self.assertEqual([number for _, number in chain][:3], ["1", "2", "3"])
        self.assertEqual(chain[0][0].offset, 0)

    def test_a_major_jump_is_refused_when_capped(self) -> None:
        # CSMOP prints a per-chapter contents block inside the body; its entries
        # run 1.7 -> 5.1 -> 7.6, which is not how a manual is paragraphed.
        candidates = self._candidates([(0, "1.1"), (500, "5.1"), (1000, "2.1"), (1500, "2.2")])
        chain = extract.walk_sequence(
            candidates, first="1.1", max_rule=140, major_jump=1, end_of_text=2000
        )
        self.assertEqual([number for _, number in chain], ["1.1", "2.1", "2.2"])


class TestSubRules(unittest.TestCase):
    def test_only_the_numeric_level_is_split(self) -> None:
        text = "(1) The first thing. (a) one way (b) another way (2) The second thing."
        parts = extract.split_sub_rules("11", text)
        self.assertEqual([p["number"] for p in parts], ["11(1)", "11(2)"])

    def test_a_single_marker_is_not_a_sub_rule_list(self) -> None:
        self.assertEqual(extract.split_sub_rules("11", "(1) The only thing."), [])


class TestClozeSpans(unittest.TestCase):
    def test_a_compound_duration_is_not_cut_in_half(self) -> None:
        spans = cards.find_spans("publish within one hundred and twenty days from the enactment", [])
        durations = [s.text for s in spans if s.kind == "duration"]
        self.assertIn("one hundred and twenty days", durations)
        self.assertNotIn("twenty days", durations)

    def test_rs_does_not_match_inside_a_word(self) -> None:
        # "press releases, circulars, orders" produced a card whose answer was
        # "rs," and whose stem read "circular____orders".
        spans = cards.find_spans("press releases, circulars, orders, logbooks", [])
        self.assertEqual([s.text for s in spans if s.kind == "amount"], [])

    def test_an_amount_with_digits_is_found(self) -> None:
        spans = cards.find_spans("a pay which does not exceed Rs.500 per mensem", [])
        self.assertIn("Rs.500", [s.text for s in spans if s.kind == "amount"])

    def test_a_bare_sub_rule_reference_is_not_a_cross_reference(self) -> None:
        # "sub-rule (1)" was the commonest span in the corpus and makes a card
        # nobody can answer: half the rules in these books contain the phrase.
        spans = cards.find_spans("Nothing in sub-rule (1) shall apply", [])
        self.assertEqual([s.text for s in spans if s.kind == "crossReference"], [])

    def test_a_numbered_rule_reference_is_a_cross_reference(self) -> None:
        spans = cards.find_spans("as laid down in Rule 26 of these rules", [])
        self.assertIn("Rule 26", [s.text for s in spans if s.kind == "crossReference"])

    def test_a_span_made_only_of_connectives_is_dropped(self) -> None:
        spans = cards.find_spans("and or the", ["and or the"])
        self.assertEqual(spans, [])

    def test_a_span_keeps_its_real_offsets(self) -> None:
        """A stripped span must report where the stripped text actually is.

        Deriving the end from the match start plus the stripped length shifted
        the blank left by whatever whitespace the match had picked up, so the
        blank ate the tail of the previous word: "payable under R____shall".
        """
        text = "the benefit payable under  Rule 39 shall be modified"
        span = next(s for s in cards.find_spans(text, []) if s.kind == "crossReference")
        self.assertEqual(text[span.start : span.end], span.text)


class TestExcerpt(unittest.TestCase):
    def test_a_stem_never_opens_mid_word(self) -> None:
        text = "a" * 40 + " falling within its territory, the State Government nominated under Rule 7 more"
        span = next(s for s in cards.find_spans(text, []) if s.kind == "crossReference")
        window = cards.excerpt_around(text, span)
        self.assertIsNotNone(window)
        stem, start, _ = window  # type: ignore[misc]
        self.assertTrue(start == 0 or not text[start - 1].isalnum())


class TestOptionRotation(unittest.TestCase):
    def test_rotation_is_deterministic(self) -> None:
        options = ["a", "b", "c", "d"]
        first = cards.rotate_options("rti-q-012", list(options), 0)
        second = cards.rotate_options("rti-q-012", list(options), 0)
        self.assertEqual(first, second)

    def test_rotation_keeps_the_key_on_the_same_option(self) -> None:
        options = ["correct", "b", "c", "d"]
        rotated, index = cards.rotate_options("rti-q-012", list(options), 0)
        self.assertEqual(rotated[index], "correct")

    def test_rotation_spreads_the_answer_across_positions(self) -> None:
        """Stage A put the key at index 0 in 91% of its questions."""
        positions = {
            cards.rotate_options(f"act-q-{n:03d}", ["a", "b", "c", "d"], 0)[1] for n in range(40)
        }
        self.assertGreaterEqual(len(positions), 3)


class TestDatasets(unittest.TestCase):
    """The committed files, not a fixture."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.index = common.read_json(common.RULES_DIR / "index.json")

    def test_index_lists_every_text_and_card_file(self) -> None:
        for entry in self.index["acts"]:
            with self.subTest(act=entry["id"]):
                self.assertTrue((common.RULES_DIR / entry["text"]).exists())
                self.assertTrue((common.RULES_DIR / entry["cards"]).exists())

    def test_no_rule_text_claims_extractable_hindi(self) -> None:
        for entry in self.index["acts"]:
            with self.subTest(act=entry["id"]):
                self.assertFalse(entry["hindiTextExtractable"])

    def test_every_authored_question_is_bilingual_before_the_pipeline_runs(self) -> None:
        for path in sorted(common.AUTHORED_DIR.glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            for card in payload["cards"]:
                with self.subTest(card=card["id"]):
                    self.assertTrue(card["front"]["hi"].strip())
                    self.assertTrue(card["back"]["hi"].strip())
                    for option in card.get("options", []):
                        self.assertTrue(option["hi"].strip())

    def test_every_authored_question_has_a_critic_verdict(self) -> None:
        for path in sorted(common.AUTHORED_DIR.glob("*.json")):
            act_id = path.stem
            critic = common.read_json(common.REVIEW_DIR / f"critic-{act_id}.json", default={})
            payload = json.loads(path.read_text(encoding="utf-8"))
            for card in payload["cards"]:
                with self.subTest(card=card["id"]):
                    self.assertIn(card["id"], critic)

    def test_every_mcq_and_true_false_has_a_blind_answer(self) -> None:
        for path in sorted(common.AUTHORED_DIR.glob("*.json")):
            act_id = path.stem
            blind = common.read_json(common.REVIEW_DIR / f"blind-{act_id}.json", default={})
            payload = json.loads(path.read_text(encoding="utf-8"))
            for card in payload["cards"]:
                if card["kind"] not in {"mcq", "trueFalse"}:
                    continue
                with self.subTest(card=card["id"]):
                    self.assertIn(card["id"], blind)


class TestDedup(unittest.TestCase):
    def test_the_threshold_is_the_one_the_brief_names(self) -> None:
        self.assertEqual(qa.DEDUP_THRESHOLD, 90.0)
        self.assertEqual(cards.DEDUP_THRESHOLD, qa.DEDUP_THRESHOLD)


class TestTextHelpers(unittest.TestCase):
    def test_clean_text_keeps_devanagari_digits(self) -> None:
        """NFC, not NFKC.

        NFKC folds ०-९ into ASCII, which would silently rewrite a Hindi rule
        citing नियम ११ as "11" — and the Law Converter's search deliberately
        supports Devanagari digits.
        """
        self.assertIn("११", common.clean_text("नियम ११"))

    def test_devanagari_ratio(self) -> None:
        self.assertAlmostEqual(common.devanagari_ratio("नियम"), 1.0)
        self.assertAlmostEqual(common.devanagari_ratio("rule"), 0.0)
        self.assertAlmostEqual(common.devanagari_ratio(""), 0.0)

    def test_rule_number_normalisation(self) -> None:
        self.assertEqual(common.normalise_rule_number("13-A"), "13A")
        self.assertEqual(common.normalise_rule_number("11 ."), "11")
        self.assertEqual(common.normalise_rule_number("3 ( 1 )"), "3(1)")

    def test_rule_sort_key_orders_suffixes_after_their_parent(self) -> None:
        numbers = ["11", "3", "3A", "2", "103"]
        self.assertEqual(
            sorted(numbers, key=common.rule_sort_key), ["2", "3", "3A", "11", "103"]
        )


if __name__ == "__main__":
    unittest.main()
