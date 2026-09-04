"""Tests for exams_seed.py's pure helpers and its self-check.

Stdlib unittest, like every other test beside an ingest script:

    scripts/ingest/.venv/bin/python -m unittest discover -s scripts/ingest -t scripts/ingest
"""

from __future__ import annotations

import copy
import unittest

import exams_seed as seed


class TestApportion(unittest.TestCase):
    def test_equal_shares_sum_to_exactly_one(self) -> None:
        # 1/7 rounded seven times is 0.9997. The last unit takes the remainder,
        # which is the whole reason `apportion` exists rather than a `round`.
        for count in range(1, 21):
            units = [{"id": f"u{i}"} for i in range(count)]
            weights = [u["weight"] for u in seed.apportion(units)]
            self.assertEqual(round(sum(weights), 6), 1.0, f"{count} units")

    def test_every_weight_is_inside_the_schema_range(self) -> None:
        for count in range(1, 21):
            for u in seed.apportion([{"id": f"u{i}"} for i in range(count)]):
                self.assertGreater(u["weight"], 0)
                self.assertLessEqual(u["weight"], 1)

    def test_a_single_unit_takes_the_whole_paper(self) -> None:
        self.assertEqual(seed.apportion([{"id": "only"}])[0]["weight"], 1.0)

    def test_it_keeps_the_units_it_was_given_in_order(self) -> None:
        units = seed.apportion([{"id": "a"}, {"id": "b"}, {"id": "c"}])
        self.assertEqual([u["id"] for u in units], ["a", "b", "c"])


class TestBuild(unittest.TestCase):
    def setUp(self) -> None:
        self.profiles = seed.build_profiles()

    def test_the_committed_profiles_pass_their_own_self_check(self) -> None:
        self.assertEqual(seed.self_check(self.profiles), 0)

    def test_every_profile_has_the_three_papers_the_notification_prescribes(self) -> None:
        for profile_id, payload in self.profiles.items():
            ids = [paper["id"] for paper in payload["papers"]]
            self.assertEqual(ids, ["paper-1", "paper-2", "paper-3"], profile_id)
            self.assertEqual(sum(p["marks"] for p in payload["papers"]), 500, profile_id)

    def test_the_objective_papers_carry_the_one_third_penalty_and_the_subjective_one_does_not(self) -> None:
        for profile_id, payload in self.profiles.items():
            for paper in payload["papers"]:
                if paper["objective"]:
                    self.assertEqual(paper["negativeMarking"], seed.ONE_THIRD, profile_id)
                else:
                    self.assertNotIn("negativeMarking", paper, profile_id)

    def test_no_paper_claims_a_qualifying_mark_the_notification_does_not_fix(self) -> None:
        # The Appendix reserves the right to fix minimum qualifying standards
        # rather than fixing them, so guessing one would be inventing a pass mark.
        for payload in self.profiles.values():
            for paper in payload["papers"]:
                self.assertNotIn("qualifyingMarks", paper)

    def test_every_external_unit_says_what_to_study_instead(self) -> None:
        for profile_id, payload in self.profiles.items():
            for paper in payload["papers"]:
                for unit in paper["units"]:
                    if isinstance(unit["coverage"], dict):
                        self.assertTrue(unit["coverage"]["note"]["en"], f"{profile_id}/{unit['id']}")
                        self.assertTrue(unit["coverage"]["note"]["hi"], f"{profile_id}/{unit['id']}")

    def test_the_intelligence_bureau_standing_orders_unit_holds_nothing(self) -> None:
        # The boundary, as data. The unit is NAMED because a candidate who does
        # not know it is on the syllabus is worse off; it is EMPTY because this
        # app holds no departmental material.
        ib = self.profiles["ib-so-ldce"]
        paper_two = next(p for p in ib["papers"] if p["id"] == "paper-2")
        unit = next(u for u in paper_two["units"] if u["id"] == "intelligence-bureau-standing-orders")
        self.assertEqual(unit["coverage"]["external"], True)
        self.assertNotIn("act", unit["coverage"])

    def test_the_official_secrets_act_is_not_a_unit_of_any_profile(self) -> None:
        # It is not in the notification's reference list for any of the three
        # categories, so it is not on any syllabus here. Enabling OSA cards for
        # an IB officer is `actHints.ts`'s guess about their WORK, which is a
        # different and much weaker claim than a syllabus.
        for profile_id, payload in self.profiles.items():
            for paper in payload["papers"]:
                for unit in paper["units"]:
                    if isinstance(unit["coverage"], list):
                        for ref in unit["coverage"]:
                            self.assertNotEqual(ref["act"], "osa", f"{profile_id}/{unit['id']}")

    def test_the_railway_profile_does_not_map_railway_rules_on_to_the_ccs_ones(self) -> None:
        # The Railway Services (Conduct) Rules 1966 and the Railway Servants
        # (D&A) Rules 1968 are close in shape to the CCS rules and different in
        # text. Mapping one on to the other would send a candidate to study the
        # wrong rule book with the app telling them it was the right one.
        railway = self.profiles["railway-so-ldce"]
        paper_two = next(p for p in railway["papers"] if p["id"] == "paper-2")
        for unit_id in ("railway-services-conduct-rules", "railway-servants-discipline-and-appeal-rules"):
            unit = next(u for u in paper_two["units"] if u["id"] == unit_id)
            self.assertEqual(unit["coverage"], {"external": True, "note": unit["coverage"]["note"]})

    def test_the_hindi_handbook_is_on_the_css_syllabus_and_not_the_ib_one(self) -> None:
        # The Schedule marks that reference book "(for Category I & IV only)".
        # Category VIII is neither, so a profile that carried it would be adding
        # a syllabus head the notification does not give that category.
        def unit_ids(profile_id: str) -> set[str]:
            paper_two = next(p for p in self.profiles[profile_id]["papers"] if p["id"] == "paper-2")
            return {u["id"] for u in paper_two["units"]}

        self.assertIn("official-language-handbook", unit_ids("css-so-ldce"))
        self.assertNotIn("official-language-handbook", unit_ids("ib-so-ldce"))


class TestSelfCheck(unittest.TestCase):
    """Each way a broken profile is refused. Written from the negative side."""

    def setUp(self) -> None:
        self.profiles = seed.build_profiles()

    def broken(self, mutate) -> int:
        profiles = copy.deepcopy(self.profiles)
        mutate(profiles["css-so-ldce"])
        return seed.self_check(profiles)

    def test_it_refuses_weights_that_do_not_sum_to_one(self) -> None:
        def mutate(profile):
            profile["papers"][0]["units"][0]["weight"] = 0.5

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_coverage_naming_an_act_the_corpus_does_not_have(self) -> None:
        def mutate(profile):
            profile["papers"][1]["units"][0]["coverage"] = [{"act": "not-a-rule-book"}]

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_an_external_unit_with_no_note(self) -> None:
        def mutate(profile):
            profile["papers"][0]["units"][0]["coverage"] = {"external": True}

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_a_duplicate_unit_id_inside_one_paper(self) -> None:
        def mutate(profile):
            profile["papers"][1]["units"][1]["id"] = profile["papers"][1]["units"][0]["id"]

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_a_subjective_paper_that_carries_a_negative_marking_rate(self) -> None:
        def mutate(profile):
            profile["papers"][2]["negativeMarking"] = 0.25

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_a_profile_with_no_objective_paper(self) -> None:
        def mutate(profile):
            for paper in profile["papers"]:
                paper["objective"] = False
                paper.pop("negativeMarking", None)

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_verify_false_on_a_source_that_was_never_fetched(self) -> None:
        def mutate(profile):
            profile["patternSource"] = {"name": "somewhere", "url": "https://example.gov.in"}

        self.assertGreater(self.broken(mutate), 0)

    def test_it_refuses_an_id_that_disagrees_with_its_own_file_name(self) -> None:
        def mutate(profile):
            profile["id"] = "something-else"

        self.assertGreater(self.broken(mutate), 0)


class TestIndex(unittest.TestCase):
    def test_the_index_counts_agree_with_the_profiles_it_indexes(self) -> None:
        profiles = seed.build_profiles()
        index = seed.build_index(profiles)
        for entry in index["profiles"]:
            payload = profiles[entry["id"]]
            mapped, external = seed.count_units(payload)
            self.assertEqual(entry["mappedUnits"], mapped, entry["id"])
            self.assertEqual(entry["externalUnits"], external, entry["id"])
            self.assertEqual(entry["paperCount"], len(payload["papers"]), entry["id"])
            self.assertEqual(entry["file"], f"profiles/{entry['id']}.json")

    def test_the_railway_profile_is_honest_about_holding_almost_nothing(self) -> None:
        # Two mapped units against eleven external ones. The picker renders both
        # numbers so a reader sees the ratio BEFORE choosing, not after.
        index = seed.build_index(seed.build_profiles())
        railway = next(e for e in index["profiles"] if e["id"] == "railway-so-ldce")
        self.assertLess(railway["mappedUnits"], railway["externalUnits"])


if __name__ == "__main__":
    unittest.main()
