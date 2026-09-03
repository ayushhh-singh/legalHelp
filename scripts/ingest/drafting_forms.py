#!/usr/bin/env python3
"""The forms Session 29 added — twenty-nine of the forty-three in the library.

``drafting_seed.py`` owns the fourteen forms CSMOP 2022 gives a specimen for,
the helpers that build a template, and every self-check. This module owns the
rest: the forms an officer writes constantly and the manual prescribes no
format for, plus the four it does name and Session 8 did not build (Office
Order, Order/sanction, Minutes, and the forwarding letter).

**It defines no helper of its own.** ``build(H)`` is handed the same ``field``,
``block``, ``check``, ``template`` and ``ref`` the seed uses, so there is one
definition of what a template is and one self-check over all forty-three. The
split is a reading convenience, not a second pipeline.

Two things every form here carries that the original fourteen did not:

``variables``
    The typed variables of Template Library v2 — a ``key``, a bilingual label, a
    type, whether it is required, an optional profile key it defaults from, and
    an optional validation pattern. A variable is what the ``bodySkeleton``
    interpolates; a ``field`` is what the *layout* interpolates. Most forms here
    have both, and the ids do not overlap.

``bodySkeleton``
    The starting body, in editor JSON, in both languages. Marker paragraphs
    (``{{#if x}}``, ``{{#each xs}}``) are expanded by
    ``src/lib/drafting/skeleton.ts`` when a document is created from the form.

**Every form in this file carries ``verify: true`` and a ``chassis``.** Twenty-five
of the twenty-nine are forms CSMOP prescribes no format for, and the four it
does name are built from the specimen of the form they share a head with rather
than from a specimen of their own. That distinction — *CSMOP says this* against
*this is how it is done* — is the one an officer must never have to guess at,
and ``drafting_seed.py``'s self-check refuses a ``verify: true`` template that
does not name whose chassis it borrows.
"""

from __future__ import annotations

import re
from typing import Any

MARKER = re.compile(r"^\{\{[#/]")


def _node(text: str) -> dict[str, Any]:
    """One paragraph of a skeleton.

    A marker line is a plain ``paragraph`` — control flow is not part of the
    document and must not be numbered. A line opening ``# `` is a heading. Every
    other line is a ``numberedPara``, because the layout block these bodies sit
    in carries ``numbered: true`` and a plain paragraph inside it would render
    without the number the specimen prints.
    """
    if MARKER.match(text.strip()):
        return {"type": "paragraph", "content": [{"type": "text", "text": text.strip()}]}
    if text.startswith("# "):
        return {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": text[2:]}]}
    if text.startswith("> "):
        return {
            "type": "blockquote",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text[2:]}]}],
        }
    return {"type": "numberedPara", "attrs": {"level": 1}, "content": [{"type": "text", "text": text}]}


def doc(paras: list[str]) -> dict[str, Any]:
    return {"type": "doc", "content": [_node(p) for p in paras]}


def skeleton(en: list[str], hi: list[str]) -> dict[str, Any]:
    return {"en": doc(en), "hi": doc(hi)}


PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z@.][\w.]*|\.)\s*\}\}")
IF_OPEN = re.compile(r"^\{\{#if\s+([a-zA-Z][\w.]*)\}\}$")
EACH_OPEN = re.compile(r"^\{\{#each\s+([a-zA-Z][\w.]*)\}\}$")


def derive(paras: list[tuple[str, str]], variables: list[dict[str, Any]],
           builtins: dict[str, tuple[str, str]]) -> tuple[list[str], list[str]]:
    """The worked example, derived from the skeleton rather than authored twice.

    This is the Python half of ``src/lib/drafting/skeleton.ts`` and it is
    deliberately the *simplest* half: it takes the true branch of every
    ``{{#if}}`` whose variable has an example, and one pass of every
    ``{{#each}}``. Its only job is to produce the ``paras`` sample the fourteen
    original templates carry by hand, so that every one of the forty-three
    renders from its own worked example with no placeholder left in it.

    The TypeScript instantiator is the one that runs for a reader. Keeping this
    one small is what stops two implementations of one grammar drifting: the
    only claim made here is "the example substitutes", and
    ``tests/drafting-data.test.ts`` checks that claim against the real
    instantiator over all forty-three skeletons.
    """
    examples: dict[str, tuple[str, str]] = dict(builtins)
    for entry in variables:
        sample = entry.get("sample") or {}
        examples[entry["key"]] = (sample.get("en", ""), sample.get("hi", ""))

    def one(index: int) -> list[str]:
        out: list[str] = []
        skip_depth = 0
        for pair in paras:
            text = pair[index].strip()
            open_if = IF_OPEN.match(text)
            open_each = EACH_OPEN.match(text)
            if open_if or open_each:
                key = (open_if or open_each).group(1)  # type: ignore[union-attr]
                got = examples.get(key, ("", ""))[index]
                if skip_depth or not got.strip():
                    skip_depth += 1
                continue
            if text in ("{{/if}}", "{{/each}}"):
                if skip_depth:
                    skip_depth -= 1
                continue
            if skip_depth:
                continue
            out.append(PLACEHOLDER.sub(lambda m: examples.get(m.group(1), ("", ""))[index], pair[index]))
        return [line for line in out if line.strip()]

    return one(0), one(1)


def var(
    key: str,
    label: dict[str, str],
    vtype: str,
    required: bool,
    *,
    ex: tuple[str, str] | None = None,
    hint: dict[str, str] | None = None,
    options: list[dict[str, Any]] | None = None,
    default_from: str | None = None,
    pattern: str | None = None,
    pattern_hint: dict[str, str] | None = None,
) -> dict[str, Any]:
    record: dict[str, Any] = {"key": key, "label": label, "type": vtype, "required": required}
    # Every variable carries a worked example, and it is not decoration: the
    # template's `paras` SAMPLE is derived from the skeleton by substituting
    # these. Without them the sample would still contain `{{key}}`, and
    # `tests/drafting-data.test.ts` renders every template from its own samples
    # and runs its own checklist over the result — where `noPlaceholders` is a
    # `must`. So a variable with no example fails the build rather than shipping
    # a form whose worked example does not pass its own checklist.
    record["sample"] = {"en": (ex or ("", ""))[0], "hi": (ex or ("", ""))[1]}
    if hint:
        record["hint"] = hint
    if options:
        record["options"] = options
    if default_from:
        record["defaultFrom"] = default_from
    if pattern:
        record["pattern"] = pattern
        if pattern_hint:
            record["patternHint"] = pattern_hint
    return record


# --------------------------------------------------------------------------- #
# Chassis — the four page shapes every form in this file borrows.
#
# A chassis is a layout, not a document type. The engine knows block roles and
# nothing else (ADR-020), so "an Office Order looks like an Office Memorandum
# with a different centred title" is expressible as data and needs no code.
# --------------------------------------------------------------------------- #


def build(H: Any) -> list[dict[str, Any]]:  # noqa: C901 - one form per branch, read as a list
    """The twenty-nine forms, built with the seed's own helpers."""
    bl, field, block, check, template, ref = H.bl, H.field, H.block, H.check, H.template, H.ref
    out: list[dict[str, Any]] = []

    # ---- shared field sets ------------------------------------------------

    def std_fields(*, urgency: bool = True, addressee: bool = True, copy_to: bool = True,
                   subject: bool = True, header: bool = True, file_no: bool = True,
                   paras_en: list[str] | None = None, paras_hi: list[str] | None = None,
                   addressee_en: list[str] | None = None, addressee_hi: list[str] | None = None,
                   copy_en: list[str] | None = None, copy_hi: list[str] | None = None,
                   encl: tuple[list[str], list[str]] | None = None,
                   designation_en: str = "Under Secretary to the Govt. of India",
                   designation_hi: str = "अवर सचिव, भारत सरकार",
                   ) -> list[dict[str, Any]]:
        fields: list[dict[str, Any]] = []
        if urgency:
            fields.append(H.f_urgency())
        if file_no:
            fields.append(H.f_file_number())
        if header:
            fields += [H.f_ministry(), H.f_department()]
        fields += [H.f_place(), H.f_date()]
        if addressee:
            fields.append(
                field(
                    "addressee",
                    bl("Addressee", "प्रेषिती"),
                    "list",
                    True,
                    {"en": addressee_en or ["The Under Secretary", "Department of Expenditure", "North Block, New Delhi"],
                     "hi": addressee_hi or ["अवर सचिव", "व्यय विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]},
                    hint=bl(
                        "One line each: designation, organisation, address.",
                        "एक-एक पंक्ति में : पदनाम, संगठन, पता।",
                    ),
                )
            )
        if subject:
            fields.append(H.f_subject())
        fields.append(H.f_paras(paras_en or [], paras_hi or []))
        fields += H.f_signatory(designation_en, designation_hi)
        fields.append(H.f_enclosures(*(encl or (None, None))))
        if copy_to:
            fields.append(H.f_copy_to(copy_en or ["The office order file."], copy_hi or ["कार्यालय आदेश फाइल।"]))
        return fields

    # ---- chassis layouts --------------------------------------------------

    def lay_order(title_en: str, title_hi: str, *, urgency: bool = False, copy_to: bool = True,
                  addressee: bool = False, subject: bool = True) -> tuple[list, list]:
        en = [*H.head_en(urgency=urgency),
              block("title", align="center", emphasis="title", lines=[title_en])]
        hi = [*H.head_hi(urgency=urgency),
              block("title", align="center", emphasis="title", lines=[title_hi])]
        if subject:
            en.append(block("subject", align="left", lines=["Subject: {{subject}}"]))
            hi.append(block("subject", align="left", lines=["विषय : {{subject}}"]))
        en += [H.BODY_EN, H.SIGN_EN]
        hi += [H.BODY_HI, H.SIGN_HI]
        if addressee:
            en.append(block("addressee", align="left", source="addressee", lead="To"))
            hi.append(block("addressee", align="left", source="addressee", lead="सेवा में,"))
        en.append(H.ENCL_EN)
        hi.append(H.ENCL_HI)
        if copy_to:
            en.append(H.COPY_EN)
            hi.append(H.COPY_HI)
        return en, hi

    def lay_letter(*, urgency: bool = True, salutation_en: str = "Sir / Madam,",
                   salutation_hi: str = "महोदय / महोदया,", closing_en: str = "Yours faithfully,",
                   closing_hi: str = "भवदीय,", copy_to: bool = True, header: bool = True,
                   file_no: bool = True, subject: bool = True) -> tuple[list, list]:
        en: list[dict[str, Any]] = []
        hi: list[dict[str, Any]] = []
        if urgency:
            en.append(H.URGENCY_EN)
            hi.append(H.URGENCY_HI)
        if file_no:
            en.append(block("fileNumber", align="left", lines=["No. {{fileNumber}}"]))
            hi.append(block("fileNumber", align="left", lines=["संख्या {{fileNumber}}"]))
        if header:
            en.append(block("header", align="center", lines=["Government of India", "{{ministry}}", "{{department}}"]))
            hi.append(block("header", align="center", lines=["भारत सरकार", "{{ministry}}", "{{department}}"]))
        en.append(block("dateLine", align="right", lines=["{{place}}, the {{date}}"]))
        hi.append(block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]))
        en.append(block("addressee", align="left", source="addressee", lead="To,"))
        hi.append(block("addressee", align="left", source="addressee", lead="सेवा में,"))
        if subject:
            en.append(block("subject", align="left", lines=["Subject: {{subject}}"]))
            hi.append(block("subject", align="left", lines=["विषय : {{subject}}"]))
        en += [
            block("salutation", align="left", lines=[salutation_en]),
            H.BODY_EN,
            block("closing", align="right", lines=[closing_en]),
            H.SIGN_EN,
            H.ENCL_EN,
        ]
        hi += [
            block("salutation", align="left", lines=[salutation_hi]),
            H.BODY_HI,
            block("closing", align="right", lines=[closing_hi]),
            H.SIGN_HI,
            H.ENCL_HI,
        ]
        if copy_to:
            en.append(H.COPY_EN)
            hi.append(H.COPY_HI)
        return en, hi

    SIGN_LEFT_EN = block(
        "signature",
        align="left",
        lines=["({{signatoryName}})", "{{signatoryDesignation}}", "Tele. No.: {{phone}}", "Email: {{email}}"],
    )
    SIGN_LEFT_HI = block(
        "signature",
        align="left",
        lines=["({{signatoryName}})", "{{signatoryDesignation}}", "दूरभाष संख्या : {{phone}}", "ई-मेल : {{email}}"],
    )

    def lay_application(*, subject: bool = True) -> tuple[list, list]:
        """A personal application: no file number of one's own, signed at the left.

        An officer applying for leave has no communication number to give — the
        establishment section allots one when it issues the sanction — so this
        chassis carries none. That is the difference between a form an office
        issues and a form an individual submits, and it is the reason the two
        are separate chassis rather than one with a flag.
        """
        en = [
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("addressee", align="left", source="addressee", lead="To,"),
        ]
        hi = [
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("addressee", align="left", source="addressee", lead="सेवा में,"),
        ]
        if subject:
            en.append(block("subject", align="left", lines=["Subject: {{subject}}"]))
            hi.append(block("subject", align="left", lines=["विषय : {{subject}}"]))
        en += [
            block("salutation", align="left", lines=["Sir / Madam,"]),
            H.BODY_EN,
            block("closing", align="right", lines=["Yours faithfully,"]),
            SIGN_LEFT_EN,
            H.ENCL_EN,
        ]
        hi += [
            block("salutation", align="left", lines=["महोदय / महोदया,"]),
            H.BODY_HI,
            block("closing", align="right", lines=["भवदीय,"]),
            SIGN_LEFT_HI,
            H.ENCL_HI,
        ]
        return en, hi

    def app_fields(designation_en: str, designation_hi: str, *, addressee_en: list[str],
                   addressee_hi: list[str], paras_en: list[str], paras_hi: list[str],
                   subject_en: str, subject_hi: str,
                   encl: tuple[list[str], list[str]] | None = None) -> list[dict[str, Any]]:
        return [
            H.f_place(),
            H.f_date(),
            field("addressee", bl("Addressee", "प्रेषिती"), "list", True,
                  {"en": addressee_en, "hi": addressee_hi}),
            field("subject", bl("Subject", "विषय"), "text", True, bl(subject_en, subject_hi)),
            H.f_paras(paras_en, paras_hi),
            field("signatoryName", bl("Your name", "आपका नाम"), "text", True, bl("A.B.C.", "ए.बी.सी.")),
            field("signatoryDesignation", bl("Your designation", "आपका पदनाम"), "text", True,
                  bl(designation_en, designation_hi)),
            field("phone", bl("Telephone number", "दूरभाष संख्या"), "text", True, bl("011-2309 2590", "011-2309 2590")),
            field("email", bl("Email", "ई-मेल"), "text", True, bl("abc@nic.in", "abc@nic.in")),
            H.f_enclosures(*(encl or (None, None))),
        ]

    CHECKS_COMMON = [H.CHECK_NO_PLACEHOLDERS]

    def lay_om(title_en: str, title_hi: str, *, urgency: bool = True, copy_to: bool = True,
               ref_line: bool = False) -> tuple[list, list]:
        """The Office Memorandum page: centred title, **addressee at the foot**.

        The addressee below the signature is the single thing officers most
        often get wrong about an O.M., and it is why every form that shares its
        head shares its chassis rather than being re-laid out by hand.
        """
        en = [*H.head_en(urgency=urgency),
              block("title", align="center", emphasis="title", lines=[title_en]),
              block("subject", align="left", lines=["Subject: {{subject}}"])]
        hi = [*H.head_hi(urgency=urgency),
              block("title", align="center", emphasis="title", lines=[title_hi]),
              block("subject", align="left", lines=["विषय : {{subject}}"])]
        if ref_line:
            en.append(block("refLine", align="left", lines=["Reference: {{reference}}"], omitWhenEmpty=True))
            hi.append(block("refLine", align="left", lines=["संदर्भ : {{reference}}"], omitWhenEmpty=True))
        en += [H.BODY_EN, H.SIGN_EN, block("addressee", align="left", source="addressee", lead="To"), H.ENCL_EN]
        hi += [H.BODY_HI, H.SIGN_HI, block("addressee", align="left", source="addressee", lead="सेवा में,"), H.ENCL_HI]
        if copy_to:
            en.append(H.COPY_EN)
            hi.append(H.COPY_HI)
        return en, hi

    def lay_do() -> tuple[list, list]:
        """The demi-official page: personal stationery at the top left, the
        addressee at the FOOT below the signature (CSMOP 8.4(2), page 88)."""
        en = [
            block("header", align="left", lines=["{{signatoryName}}", "{{signatoryDesignation}}", "Tele.: {{phone}}"]),
            block("fileNumber", align="right", lines=["D.O. No. {{fileNumber}}"]),
            block("header", align="center", lines=["Government of India", "{{ministry}}", "{{department}}"]),
            block("dateLine", align="right", lines=["{{place}}, the {{date}}"]),
            block("salutation", align="left", lines=["My dear {{addresseeName}},"]),
            H.BODY_EN,
            block("closing", align="right", lines=["With regards,"]),
            block("closing", align="right", lines=["Yours sincerely,"]),
            block("signature", align="right", lines=["({{signatoryName}})"]),
            block("addressee", align="left", source="addressee"),
        ]
        hi = [
            block("header", align="left", lines=["{{signatoryName}}", "{{signatoryDesignation}}", "दूरभाष : {{phone}}"]),
            block("fileNumber", align="right", lines=["अर्ध-सरकारी पत्र संख्या {{fileNumber}}"]),
            block("header", align="center", lines=["भारत सरकार", "{{ministry}}", "{{department}}"]),
            block("dateLine", align="right", lines=["{{place}}, दिनांक {{date}}"]),
            block("salutation", align="left", lines=["प्रिय {{addresseeName}},"]),
            H.BODY_HI,
            block("closing", align="right", lines=["शुभकामनाओं सहित,"]),
            block("closing", align="right", lines=["भवदीय,"]),
            block("signature", align="right", lines=["({{signatoryName}})"]),
            block("addressee", align="left", source="addressee"),
        ]
        return en, hi

    def mk(tid: str, *, group: str, chassis: str, name: tuple[str, str], short: tuple[str, str],
           use_when: tuple[str, str], when: tuple[str, str], used_by: tuple[str, str],
           subject: tuple[str, str], paras: list[tuple[str, str]], sk: list[tuple[str, str]] | None = None,
           person: str = "third", title: tuple[str, str] | None = None,
           addressee: tuple[list[str], list[str]] | None = None,
           copy: tuple[list[str], list[str]] | None = None,
           designation: tuple[str, str] = ("Under Secretary to the Govt. of India", "अवर सचिव, भारत सरकार"),
           variables: list[dict[str, Any]] | None = None,
           extra_fields: list[dict[str, Any]] | None = None,
           extra_checks: list[dict[str, Any]] | None = None,
           csmop_paras: list[str], base: str, note: tuple[str, str] | None = None,
           encl: tuple[list[str], list[str]] | None = None,
           urgency: bool = True, copy_to: bool = True, salutation: tuple[str, str] | None = None,
           subscription: tuple[str, str] | None = None, ref_line: bool = False,
           notes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """One form. Everything a form differs in is an argument; everything it
        shares is the chassis."""
        addr_en, addr_hi = addressee or (
            ["The Under Secretary", "Department of Expenditure", "North Block, New Delhi"],
            ["अवर सचिव", "व्यय विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"],
        )
        copy_en, copy_hi = copy or (["The office order file."], ["कार्यालय आदेश फाइल।"])
        skel = skeleton([p[0] for p in paras], [p[1] for p in paras])
        # The BODY sample is derived from the skeleton, never authored beside
        # it — see `derive`. `sk` overrides the skeleton for the handful of
        # forms whose worked example is better prose than their skeleton.
        if sk is not None:
            skel = skeleton([p[0] for p in sk], [p[1] for p in sk])
        builtins = {
            "subject": subject,
            "fileNumber": ("A-11011/2/2026-Estt.", "\u090f-11011/2/2026-\u0938\u094d\u0925\u093e\u092a\u0928\u093e"),
            "date": ("28.08.2026", "28.08.2026"),
            "senderName": ("A.B.C.", "\u090f.\u092c\u0940.\u0938\u0940."),
            "signatoryName": ("A.B.C.", "\u090f.\u092c\u0940.\u0938\u0940."),
            "signatoryDesignation": designation,
            "reference": ("this Department's O.M. of even number dated 12.05.2026",
                          "\u0907\u0938 \u0935\u093f\u092d\u093e\u0917 \u0915\u093e \u0938\u092e\u0938\u0902\u0916\u094d\u092f\u0915 \u0915\u093e\u0930\u094d\u092f\u093e\u0932\u092f \u091c\u094d\u091e\u093e\u092a\u0928 \u0926\u093f\u0928\u093e\u0902\u0915 12.05.2026"),
        }
        paras_en, paras_hi = derive(paras, variables or [], builtins)

        if chassis == "order":
            assert title is not None
            layout_en, layout_hi = lay_order(title[0], title[1], urgency=urgency, copy_to=copy_to,
                                             addressee=addressee is not None)
        elif chassis == "om":
            assert title is not None
            layout_en, layout_hi = lay_om(title[0], title[1], urgency=urgency, copy_to=copy_to, ref_line=ref_line)
        elif chassis == "letter":
            layout_en, layout_hi = lay_letter(
                urgency=urgency, copy_to=copy_to,
                salutation_en=(salutation or ("Sir / Madam,", "महोदय / महोदया,"))[0],
                salutation_hi=(salutation or ("Sir / Madam,", "महोदय / महोदया,"))[1],
                closing_en=(subscription or ("Yours faithfully,", "भवदीय,"))[0],
                closing_hi=(subscription or ("Yours faithfully,", "भवदीय,"))[1],
            )
        elif chassis == "do":
            layout_en, layout_hi = lay_do()
        else:
            layout_en, layout_hi = lay_application()

        if chassis == "application":
            fields = app_fields(designation[0], designation[1], addressee_en=addr_en, addressee_hi=addr_hi,
                                paras_en=paras_en, paras_hi=paras_hi, subject_en=subject[0], subject_hi=subject[1],
                                encl=encl)
        elif chassis == "do":
            fields = [
                H.f_file_number(), H.f_ministry(), H.f_department(), H.f_place(), H.f_date(),
                field("addresseeName", bl("Addressee's name", "प्रेषिती का नाम"), "text", True,
                      bl("Shri R.K. Sharma", "श्री आर.के. शर्मा")),
                field("addressee", bl("Addressee's designation and address", "प्रेषिती का पदनाम और पता"), "list", True,
                      {"en": addr_en, "hi": addr_hi}),
                H.f_paras(paras_en, paras_hi),
                field("signatoryName", bl("Name of the signatory", "हस्ताक्षरकर्ता का नाम"), "text", True,
                      bl("A.B.C.", "ए.बी.सी.")),
                field("signatoryDesignation", bl("Designation", "पदनाम"), "text", True,
                      bl(designation[0], designation[1])),
                field("phone", bl("Telephone number", "दूरभाष संख्या"), "text", True,
                      bl("011-2309 2590", "011-2309 2590")),
            ]
        else:
            fields = std_fields(
                urgency=urgency, addressee=(chassis != "order" or addressee is not None), copy_to=copy_to,
                paras_en=paras_en, paras_hi=paras_hi, addressee_en=addr_en, addressee_hi=addr_hi,
                copy_en=copy_en, copy_hi=copy_hi, designation_en=designation[0], designation_hi=designation[1],
                encl=encl,
            )
            for f in fields:
                if f["id"] == "subject":
                    f["sample"] = bl(subject[0], subject[1])
        for f in fields:
            if f["id"] == "subject":
                f["sample"] = bl(subject[0], subject[1])

        if ref_line:
            fields.insert(
                len(fields) - 1,
                field("reference", bl("Reference", "संदर्भ"), "text", False,
                      bl("this Department's O.M. of even number dated 12.05.2026",
                         "इस विभाग का समसंख्यक कार्यालय ज्ञापन दिनांक 12.05.2026")),
            )
        fields += extra_fields or []

        checks = list(extra_checks or []) + CHECKS_COMMON
        record = template(
            tid,
            group=group,
            name=bl(name[0], name[1]),
            short=bl(short[0], short[1]),
            person=person,
            used_by=bl(used_by[0], used_by[1]),
            when=bl(when[0], when[1]),
            use_when=bl(use_when[0], use_when[1]),
            csmop=ref(csmop_paras, chassis=base,
                      note=bl(note[0], note[1]) if note else bl(
                          f"CSMOP prescribes no format for this form. It is built on the {base.replace('-', ' ')} chassis.",
                          f"सीएसएमओपी इस प्ररूप का कोई प्रारूप निर्धारित नहीं करता। यह {base.replace('-', ' ')} ढाँचे पर बना है।",
                      )),
            fields=fields,
            layout_en=layout_en,
            layout_hi=layout_hi,
            checklist=checks,
            salutation=bl(*salutation) if salutation else None,
            subscription=bl(*subscription) if subscription else None,
            verify=True,
            urgency_allowed=urgency,
            notes=notes,
        )
        record["variables"] = variables or []
        record["bodySkeleton"] = skel
        return record

    # ----------------------------------------------------------- order chassis

    out.append(mk(
        "office-order",
        group="internal", chassis="order", base="office-memorandum", urgency=False,
        name=("Office Order", "कार्यालय आदेश"), short=("Office Order", "कार्यालय आदेश"),
        title=("OFFICE ORDER", "कार्यालय आदेश"),
        use_when=("Routine internal administration — leave, distribution of work, internal postings and transfers.",
                  "नियमित आंतरिक प्रशासन — छुट्टी, कार्य-विभाजन, आंतरिक तैनाती और स्थानांतरण।"),
        used_by=("A Department, for its own establishment.", "एक विभाग, अपने स्वयं के स्थापना कार्य के लिए।"),
        when=("CSMOP 8.4(4): an Office Order is normally used for issuing instructions on routine internal "
              "administration — grant of leave, distribution of work among sections and officers, and internal "
              "postings and transfers. It is written in the third person and carries no salutation.",
              "सीएसएमओपी 8.4(4) : कार्यालय आदेश सामान्यतः नियमित आंतरिक प्रशासन संबंधी अनुदेश जारी करने के लिए "
              "प्रयुक्त होता है — छुट्टी की स्वीकृति, अनुभागों और अधिकारियों के बीच कार्य-विभाजन, तथा आंतरिक तैनाती "
              "और स्थानांतरण। यह अन्य पुरुष में लिखा जाता है और इसमें कोई अभिवादन नहीं होता।"),
        subject=("Grant of earned leave to Shri A.B.C., Assistant Section Officer.",
                 "श्री ए.बी.सी., सहायक अनुभाग अधिकारी को अर्जित अवकाश की स्वीकृति।"),
        csmop_paras=["8.4(4)", "Appendix 8.1"],
        note=("CSMOP 8.4(4) names the Office Order and Appendix 8.1 page 90 gives its specimen, which shares its "
              "head with the Office Memorandum. This template borrows that head.",
              "सीएसएमओपी 8.4(4) कार्यालय आदेश का उल्लेख करता है और परिशिष्ट 8.1 पृष्ठ 90 उसका नमूना देता है, जिसका "
              "शीर्ष कार्यालय ज्ञापन जैसा ही है। यह टेम्पलेट वही शीर्ष लेता है।"),
        paras=[
            ("Earned leave for {{days}} days from {{fromDate}} to {{toDate}} is sanctioned in favour of "
             "{{officerName}}, {{officerDesignation}}, under rule 26 of the CCS (Leave) Rules, 1972.",
             "{{officerName}}, {{officerDesignation}} के पक्ष में {{fromDate}} से {{toDate}} तक {{days}} दिन का "
             "अर्जित अवकाश केंद्रीय सिविल सेवा (अवकाश) नियम, 1972 के नियम 26 के अंतर्गत स्वीकृत किया जाता है।"),
            ("The officer will hand over charge to {{chargeTo}} before proceeding on leave and will resume duty on "
             "the forenoon of the day following the expiry of the leave.",
             "अधिकारी अवकाश पर जाने से पूर्व {{chargeTo}} को कार्यभार सौंपेंगे और अवकाश समाप्त होने के अगले दिन "
             "पूर्वाह्न में कार्यभार ग्रहण करेंगे।"),
        ],
        copy=(["The officer concerned.", "The Cashier.", "The Section concerned.", "The office order file."],
              ["संबंधित अधिकारी।", "रोकड़िया।", "संबंधित अनुभाग।", "कार्यालय आदेश फाइल।"]),
        variables=[
            var("officerName", bl("Officer's name", "अधिकारी का नाम"), "text", True, ex=("Shri A.B.C.", "श्री ए.बी.सी.")),
            var("officerDesignation", bl("Officer's designation", "अधिकारी का पदनाम"), "text", True, ex=("Assistant Section Officer", "सहायक अनुभाग अधिकारी")),
            var("days", bl("Number of days", "दिनों की संख्या"), "number", True, ex=("10", "10")),
            var("fromDate", bl("From", "से"), "date", True, ex=("01.09.2026", "01.09.2026")),
            var("toDate", bl("To", "तक"), "date", True, ex=("10.09.2026", "10.09.2026")),
            var("chargeTo", bl("Charge handed over to", "कार्यभार किसे सौंपा गया"), "text", False, ex=("Shri P.Q.R., Assistant Section Officer", "श्री पी.क्यू.आर., सहायक अनुभाग अधिकारी")),
        ],
        extra_checks=[H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
                      check("authority", bl("The rule or delegation under which it is issued is cited",
                                            "जिस नियम या प्रत्यायोजन के अंतर्गत जारी है वह उद्धृत है"),
                            bl("An order that grants something must say what empowers it — the leave rule, the "
                               "delegation of financial powers, or the transfer policy.",
                               "जो आदेश कुछ स्वीकृत करता है उसे यह बताना चाहिए कि उसे क्या शक्ति देता है — अवकाश नियम, "
                               "वित्तीय शक्तियों का प्रत्यायोजन, या स्थानांतरण नीति।"),
                            "should", {"kind": "regex", "role": "body",
                                       "pattern": "(rule|regulation|order dated|delegation|नियम|विनियम|प्रत्यायोजन)"})],
    ))

    out.append(mk(
        "sanction-order",
        group="internal", chassis="order", base="office-memorandum", urgency=False, copy_to=True,
        name=("Sanction order", "स्वीकृति आदेश"), short=("Sanction", "स्वीकृति"),
        title=("ORDER", "आदेश"),
        use_when=("Conveying a financial sanction of the President under the delegated financial powers.",
                  "प्रत्यायोजित वित्तीय शक्तियों के अंतर्गत राष्ट्रपति की वित्तीय स्वीकृति संप्रेषित करने के लिए।"),
        used_by=("A Department, exercising delegated financial powers.",
                 "एक विभाग, प्रत्यायोजित वित्तीय शक्तियों का प्रयोग करते हुए।"),
        when=("CSMOP 8.4(5): an Order is used for issuing financial sanctions and for making final orders in "
              "disciplinary cases. It is addressed to nobody. CSMOP 9.3(i): an instrument made in the name of the "
              "President is expressed to be so made and is signed by an officer of or above the rank of Under Secretary.",
              "सीएसएमओपी 8.4(5) : आदेश का प्रयोग वित्तीय स्वीकृतियाँ जारी करने और अनुशासनिक मामलों में अंतिम आदेश "
              "देने के लिए होता है। यह किसी को संबोधित नहीं होता। सीएसएमओपी 9.3(i) : राष्ट्रपति के नाम से किया गया "
              "लिखत ऐसा कहकर व्यक्त किया जाता है और उस पर अवर सचिव या उससे ऊपर के अधिकारी हस्ताक्षर करते हैं।"),
        subject=("Sanction for the purchase of office furniture for the Establishment Section.",
                 "स्थापना अनुभाग हेतु कार्यालय फर्नीचर की खरीद के लिए स्वीकृति।"),
        csmop_paras=["8.4(5)", "9.3(i)", "Appendix 8.1"],
        note=("CSMOP 8.4(5) names the Order and Appendix 8.1 page 91 gives its specimen — a financial sanction "
              "written on the Office Memorandum head. This template borrows that head.",
              "सीएसएमओपी 8.4(5) आदेश का उल्लेख करता है और परिशिष्ट 8.1 पृष्ठ 91 उसका नमूना देता है — कार्यालय ज्ञापन "
              "के शीर्ष पर लिखी एक वित्तीय स्वीकृति। यह टेम्पलेट वही शीर्ष लेता है।"),
        paras=[
            ("Sanction of the President is hereby accorded under {{authority}} to the incurring of an expenditure "
             "of Rs. {{amount}} ({{amountWords}}) on {{purpose}}.",
             "एतद्द्वारा {{authority}} के अंतर्गत {{purpose}} पर {{amount}} रुपये ({{amountWords}}) के व्यय के "
             "उपगमन हेतु राष्ट्रपति की स्वीकृति प्रदान की जाती है।"),
            ("The expenditure is debitable to the head of account {{headOfAccount}} for the financial year "
             "{{financialYear}} and is within the sanctioned budget provision.",
             "यह व्यय वित्तीय वर्ष {{financialYear}} के लिए लेखा शीर्ष {{headOfAccount}} में नामे होगा और स्वीकृत "
             "बजट प्रावधान के भीतर है।"),
            ("{{#if ifdNumber}}", "{{#if ifdNumber}}"),
            ("This issues with the concurrence of the Integrated Finance Division vide their Dy. No. {{ifdNumber}} "
             "dated {{ifdDate}}.",
             "यह एकीकृत वित्त प्रभाग की सहमति से जारी है, उनका डायरी क्रमांक {{ifdNumber}} दिनांक {{ifdDate}}।"),
            ("{{/if}}", "{{/if}}"),
        ],
        copy=(["The Pay and Accounts Officer.", "The Integrated Finance Division.", "The sanction file."],
              ["वेतन एवं लेखा अधिकारी।", "एकीकृत वित्त प्रभाग।", "स्वीकृति फाइल।"]),
        variables=[
            var("authority", bl("Rule or delegation relied on", "जिस नियम या प्रत्यायोजन का आश्रय लिया गया"), "text", True, ex=("rule 10 of the Delegation of Financial Powers Rules, 1978", "वित्तीय शक्ति प्रत्यायोजन नियम, 1978 का नियम 10"),
                hint=bl("For example: rule 10 of the Delegation of Financial Powers Rules, 1978.",
                        "उदाहरण : वित्तीय शक्ति प्रत्यायोजन नियम, 1978 का नियम 10।")),
            var("amount", bl("Amount in figures", "राशि अंकों में"), "text", True, ex=("1,25,000", "1,25,000"),
                pattern=r"^[0-9][0-9,]*(\.[0-9]{1,2})?$",
                pattern_hint=bl("Figures only — 1,25,000 or 1,25,000.00.", "केवल अंक — 1,25,000 या 1,25,000.00।")),
            var("amountWords", bl("Amount in words", "राशि शब्दों में"), "text", True, ex=("Rupees one lakh twenty-five thousand only", "एक लाख पच्चीस हज़ार रुपये मात्र")),
            var("purpose", bl("Purpose of the expenditure", "व्यय का प्रयोजन"), "text", True, ex=("the purchase of office furniture for the Establishment Section", "स्थापना अनुभाग हेतु कार्यालय फर्नीचर की खरीद")),
            var("headOfAccount", bl("Head of account", "लेखा शीर्ष"), "text", True, ex=("2052.00.090.01.13 — Office Expenses", "2052.00.090.01.13 — कार्यालय व्यय")),
            var("financialYear", bl("Financial year", "वित्तीय वर्ष"), "text", True, ex=("2026-27", "2026-27")),
            var("ifdNumber", bl("IFD diary number", "एकीकृत वित्त प्रभाग डायरी संख्या"), "text", False, ex=("IFD/2026/431", "आईएफडी/2026/431")),
            var("ifdDate", bl("IFD concurrence date", "एकीकृत वित्त प्रभाग सहमति दिनांक"), "date", False, ex=("20.08.2026", "20.08.2026")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("presidents-sanction",
                  bl("The sanction is expressed to be the President's", "स्वीकृति राष्ट्रपति की कहकर व्यक्त की गई है"),
                  bl("An instrument made in the name of the President must be expressed to be so made; a sanction "
                     "that merely says 'sanction is accorded' names no authority at all.",
                     "राष्ट्रपति के नाम से किया गया लिखत ऐसा कहकर व्यक्त किया जाना चाहिए; जो स्वीकृति केवल "
                     "'स्वीकृति दी जाती है' कहती है वह किसी प्राधिकार का नाम ही नहीं लेती।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(President|राष्ट्रपति)"}, "9.3(i)"),
            check("amount-in-words",
                  bl("The amount is given in figures and in words", "राशि अंकों और शब्दों दोनों में दी गई है"),
                  bl("A sanction carrying a figure alone is a sanction one keystroke can multiply by ten.",
                     "केवल अंक वाली स्वीकृति ऐसी है जिसे एक कुंजी-दबाव दस गुना कर सकता है।"),
                  "must", {"kind": "regex", "role": "body", "pattern": r"\([A-Za-zऀ-ॿ][^)]{3,}\)"}),
        ],
    ))

    out.append(mk(
        "relieving-order",
        group="internal", chassis="order", base="office-memorandum", urgency=False,
        name=("Relieving order", "कार्यमुक्ति आदेश"), short=("Relieving order", "कार्यमुक्ति"),
        title=("OFFICE ORDER", "कार्यालय आदेश"),
        use_when=("Relieving an officer of their duties on transfer, deputation, retirement or resignation.",
                  "स्थानांतरण, प्रतिनियुक्ति, सेवानिवृत्ति या त्यागपत्र पर अधिकारी को कर्तव्यों से कार्यमुक्त करने हेतु।"),
        used_by=("An establishment section.", "एक स्थापना अनुभाग।"),
        when=("Issued on the Office Order chassis when an officer is to be relieved. It states the date and time "
              "of relief, to whom charge is handed over, and whether the officer is relieved with or without "
              "any dues outstanding — because the receiving office will ask for exactly those three facts.",
              "कार्यालय आदेश ढाँचे पर जारी, जब किसी अधिकारी को कार्यमुक्त किया जाना हो। इसमें कार्यमुक्ति का दिनांक "
              "और समय, कार्यभार किसे सौंपा गया, तथा क्या अधिकारी पर कोई देय बकाया है — क्योंकि प्राप्तकर्ता कार्यालय "
              "यही तीन तथ्य पूछेगा।"),
        subject=("Relieving of Shri A.B.C., Section Officer, on transfer.",
                 "स्थानांतरण पर श्री ए.बी.सी., अनुभाग अधिकारी की कार्यमुक्ति।"),
        csmop_paras=["8.4(4)"],
        paras=[
            ("Consequent upon the transfer of {{officerName}}, {{officerDesignation}}, to {{newOffice}} vide "
             "order No. {{transferOrder}} dated {{transferDate}}, the officer is relieved of the duties of this "
             "office with effect from the {{reliefTime}} of {{reliefDate}}.",
             "आदेश संख्या {{transferOrder}} दिनांक {{transferDate}} द्वारा {{officerName}}, {{officerDesignation}} "
             "के {{newOffice}} में स्थानांतरण के फलस्वरूप, अधिकारी को {{reliefDate}} के {{reliefTime}} से इस "
             "कार्यालय के कर्तव्यों से कार्यमुक्त किया जाता है।"),
            ("The officer has handed over charge to {{chargeTo}} and there are no dues outstanding against the "
             "officer in this office as on the date of relief.",
             "अधिकारी ने {{chargeTo}} को कार्यभार सौंप दिया है और कार्यमुक्ति की तिथि तक इस कार्यालय में अधिकारी पर "
             "कोई देय बकाया नहीं है।"),
        ],
        copy=(["The officer concerned.", "The office to which the officer is transferred.", "The Cashier.",
               "The Pay and Accounts Officer.", "The personal file."],
              ["संबंधित अधिकारी।", "जिस कार्यालय में स्थानांतरण हुआ है।", "रोकड़िया।", "वेतन एवं लेखा अधिकारी।",
               "वैयक्तिक फाइल।"]),
        variables=[
            var("officerName", bl("Officer's name", "अधिकारी का नाम"), "text", True, ex=("Shri A.B.C.", "श्री ए.बी.सी.")),
            var("officerDesignation", bl("Officer's designation", "अधिकारी का पदनाम"), "text", True, ex=("Assistant Section Officer", "सहायक अनुभाग अधिकारी")),
            var("newOffice", bl("Office transferred to", "जिस कार्यालय में स्थानांतरण"), "text", True, ex=("the Department of Expenditure", "व्यय विभाग")),
            var("transferOrder", bl("Transfer order number", "स्थानांतरण आदेश संख्या"), "text", True, ex=("A-32011/4/2026-Estt.", "ए-32011/4/2026-स्थापना")),
            var("transferDate", bl("Transfer order date", "स्थानांतरण आदेश दिनांक"), "date", True, ex=("12.08.2026", "12.08.2026")),
            var("reliefDate", bl("Date of relief", "कार्यमुक्ति दिनांक"), "date", True, ex=("31.08.2026", "31.08.2026")),
            var("reliefTime", bl("Forenoon or afternoon", "पूर्वाह्न या अपराह्न"), "select", True, ex=("afternoon", "अपराह्न"),
                options=[{"value": "forenoon", "label": bl("forenoon", "पूर्वाह्न")},
                         {"value": "afternoon", "label": bl("afternoon", "अपराह्न")}],
                hint=bl("The half-day matters: pay and allowances follow it.",
                        "आधा दिन महत्वपूर्ण है : वेतन और भत्ते उसी के अनुसार चलते हैं।")),
            var("chargeTo", bl("Charge handed over to", "कार्यभार किसे सौंपा गया"), "text", True, ex=("Shri P.Q.R., Assistant Section Officer", "श्री पी.क्यू.आर., सहायक अनुभाग अधिकारी")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("forenoon-afternoon",
                  bl("The forenoon or afternoon of relief is stated", "कार्यमुक्ति का पूर्वाह्न या अपराह्न लिखा है"),
                  bl("Pay, allowances and the joining time all run from the half-day of relief. An order that "
                     "gives only a date leaves the receiving office to guess.",
                     "वेतन, भत्ते और कार्यग्रहण काल सभी कार्यमुक्ति के आधे दिन से चलते हैं। जो आदेश केवल दिनांक "
                     "देता है वह प्राप्तकर्ता कार्यालय को अनुमान लगाने पर छोड़ देता है।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(forenoon|afternoon|पूर्वाह्न|अपराह्न)"}),
        ],
    ))

    out.append(mk(
        "speaking-order",
        group="statutory", chassis="order", base="office-memorandum", urgency=False,
        name=("Speaking order", "सकारण आदेश"), short=("Speaking order", "सकारण आदेश"),
        title=("ORDER", "आदेश"),
        use_when=("Deciding a representation, appeal or claim where reasons must be recorded on the order itself.",
                  "ऐसे अभ्यावेदन, अपील या दावे का निर्णय जहाँ आदेश पर ही कारण अभिलिखित करने आवश्यक हों।"),
        used_by=("A competent authority deciding a matter that affects a person's rights.",
                 "किसी व्यक्ति के अधिकारों को प्रभावित करने वाले मामले का निर्णय करने वाला सक्षम प्राधिकारी।"),
        when=("An order that decides something against a person must give the reasons for the decision on the "
              "face of the order. It sets out what was claimed, what was considered, what the rule provides, "
              "the finding on each point, and the operative decision — in that order, so the reader can follow "
              "the reasoning without the file.",
              "जो आदेश किसी व्यक्ति के विरुद्ध कुछ तय करता है उसमें निर्णय के कारण आदेश पर ही देने होते हैं। इसमें "
              "क्या दावा किया गया, क्या विचार किया गया, नियम क्या कहता है, प्रत्येक बिंदु पर निष्कर्ष, और प्रवर्तनीय "
              "निर्णय — इसी क्रम में — ताकि पाठक फाइल के बिना तर्क का अनुसरण कर सके।"),
        subject=("Order on the representation of Shri A.B.C. against the fixation of his pay.",
                 "श्री ए.बी.सी. के वेतन निर्धारण के विरुद्ध उनके अभ्यावेदन पर आदेश।"),
        csmop_paras=["8.4(5)"],
        note=("CSMOP names the Order form (8.4(5)) but prescribes no structure for a reasoned decision. The "
              "requirement to record reasons comes from administrative law and from CCS (CCA) Rules 1965 rule 27, "
              "not from the manual.",
              "सीएसएमओपी आदेश प्ररूप (8.4(5)) का उल्लेख करता है पर सकारण निर्णय की कोई संरचना निर्धारित नहीं करता। "
              "कारण अभिलिखित करने की अपेक्षा प्रशासनिक विधि और केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) "
              "नियम 1965 के नियम 27 से आती है, नियमावली से नहीं।"),
        paras=[
            ("{{applicantName}}, {{applicantDesignation}}, has made a representation dated {{representationDate}} "
             "praying that {{prayer}}.",
             "{{applicantName}}, {{applicantDesignation}} ने दिनांक {{representationDate}} का अभ्यावेदन प्रस्तुत "
             "किया है जिसमें यह प्रार्थना की गई है कि {{prayer}}।"),
            ("The representation has been examined with reference to {{provision}} and to the records of the case.",
             "अभ्यावेदन की जाँच {{provision}} तथा मामले के अभिलेखों के संदर्भ में की गई है।"),
            ("On the facts, {{finding}}.", "तथ्यों पर, {{finding}}।"),
            ("In view of the foregoing, the representation is {{decision}}. {{reasons}}",
             "उपर्युक्त को देखते हुए, अभ्यावेदन {{decision}} किया जाता है। {{reasons}}"),
            ("The applicant may, if aggrieved, prefer an appeal to {{appellateAuthority}} within {{appealDays}} "
             "days of the receipt of this order.",
             "यदि आवेदक व्यथित हो तो वह इस आदेश की प्राप्ति के {{appealDays}} दिन के भीतर {{appellateAuthority}} को "
             "अपील प्रस्तुत कर सकता है।"),
        ],
        variables=[
            var("applicantName", bl("Applicant's name", "आवेदक का नाम"), "text", True, ex=("Shri A.B.C.", "श्री ए.बी.सी.")),
            var("applicantDesignation", bl("Applicant's designation", "आवेदक का पदनाम"), "text", True, ex=("Section Officer", "अनुभाग अधिकारी")),
            var("representationDate", bl("Date of the representation", "अभ्यावेदन का दिनांक"), "date", True, ex=("05.06.2026", "05.06.2026")),
            var("prayer", bl("What was prayed for", "क्या प्रार्थना की गई"), "textarea", True, ex=("his pay on promotion be re-fixed with effect from 01.07.2025", "पदोन्नति पर उनका वेतन 01.07.2025 से पुनर्निर्धारित किया जाए")),
            var("provision", bl("Rule or order examined against", "जिस नियम या आदेश के विरुद्ध जाँच की गई"), "text", True, ex=("FR 22(I)(a)(1) and the Department of Expenditure O.M. dated 27.07.2017", "मूल नियम 22(I)(क)(1) तथा व्यय विभाग का कार्यालय ज्ञापन दिनांक 27.07.2017")),
            var("finding", bl("Finding on the facts", "तथ्यों पर निष्कर्ष"), "textarea", True, ex=("the option for re-fixation was exercised beyond the period prescribed in the said O.M.", "पुनर्निर्धारण का विकल्प उक्त कार्यालय ज्ञापन में निर्धारित अवधि के बाद प्रयोग किया गया")),
            var("decision", bl("Decision", "निर्णय"), "select", True, ex=("rejected", "अस्वीकार"),
                options=[{"value": "allowed", "label": bl("allowed", "स्वीकार")},
                         {"value": "partly allowed", "label": bl("partly allowed", "अंशतः स्वीकार")},
                         {"value": "rejected", "label": bl("rejected", "अस्वीकार")}]),
            var("reasons", bl("Reasons for the decision", "निर्णय के कारण"), "textarea", True, ex=("The option is required to be exercised within one month of the date of promotion, and no ground has been shown for condoning the delay of eleven months.", "विकल्प पदोन्नति की तिथि से एक माह के भीतर प्रयोग किया जाना अपेक्षित है, और ग्यारह माह के विलंब को क्षमा करने का कोई आधार नहीं दर्शाया गया है।"),
                hint=bl("This is what makes the order a speaking one. A decision with no reasons is set aside on appeal.",
                        "यही आदेश को सकारण बनाता है। बिना कारण का निर्णय अपील में अपास्त हो जाता है।")),
            var("appellateAuthority", bl("Appellate authority", "अपीलीय प्राधिकारी"), "text", True, ex=("the Joint Secretary (Administration)", "संयुक्त सचिव (प्रशासन)")),
            var("appealDays", bl("Days to appeal", "अपील के लिए दिन"), "number", True, ex=("45", "45")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.CHECK_SIGNATURE,
            check("reasons-recorded", bl("Reasons for the decision are recorded", "निर्णय के कारण अभिलिखित हैं"),
                  bl("An order that decides a claim without giving reasons is not a speaking order and is liable "
                     "to be set aside on appeal for that reason alone.",
                     "जो आदेश बिना कारण दिए किसी दावे का निर्णय करता है वह सकारण आदेश नहीं है और केवल इसी कारण "
                     "अपील में अपास्त हो सकता है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(because|since|in view of|for the reason|reasons|क्योंकि|कारण|के दृष्टिगत|देखते हुए)"}),
            check("appeal-remedy", bl("The appellate remedy is stated", "अपीलीय उपचार बताया गया है"),
                  bl("A person told what has been decided must also be told to whom and within what time they may "
                     "appeal, or the remedy is one they have to discover.",
                     "जिस व्यक्ति को निर्णय बताया जाए उसे यह भी बताया जाना चाहिए कि वह किसे और कितने समय में अपील "
                     "कर सकता है, अन्यथा उपचार उसे स्वयं खोजना पड़ता है।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(appeal|अपील)"}),
        ],
    ))

    # -------------------------------------------------------------- om chassis

    out.append(mk(
        "forwarding-letter",
        encl=(["The representation dated 05.06.2026 of Shri A.B.C., in original."],
              ["श्री ए.बी.सी. का दिनांक 05.06.2026 का अभ्यावेदन, मूल रूप में।"]),
        group="communication", chassis="letter", base="letter",
        name=("Forwarding letter", "अग्रेषण पत्र"), short=("Forwarding", "अग्रेषण"),
        use_when=("Sending papers on to the office that has to act on them, with a line on what is expected.",
                  "कागज़ात उस कार्यालय को भेजना जिसे उन पर कार्रवाई करनी है, अपेक्षा की एक पंक्ति सहित।"),
        used_by=("Any section forwarding a representation, bill, application or reference.",
                 "कोई भी अनुभाग जो अभ्यावेदन, बिल, आवेदन या संदर्भ अग्रेषित कर रहा हो।"),
        when=("Used when papers are sent on to the office competent to deal with them. It differs from an "
              "endorsement (8.4(9)) in that an endorsement merely passes a paper on, while a forwarding letter "
              "says what the receiving office is expected to do and by when. CSMOP 8.9(iii) requires a wrongly "
              "addressed communication to be transferred within five working days and the party told.",
              "तब प्रयुक्त होता है जब कागज़ात उस कार्यालय को भेजे जाएँ जो उन पर कार्रवाई के लिए सक्षम है। यह "
              "पृष्ठांकन (8.4(9)) से इस प्रकार भिन्न है कि पृष्ठांकन केवल कागज़ आगे बढ़ाता है, जबकि अग्रेषण पत्र यह "
              "बताता है कि प्राप्तकर्ता कार्यालय से क्या और कब तक अपेक्षित है। सीएसएमओपी 8.9(iii) के अनुसार गलत "
              "पते पर भेजा गया पत्र पाँच कार्य दिवसों में अंतरित किया जाए और पक्षकार को सूचित किया जाए।"),
        subject=("Forwarding of the representation of Shri A.B.C. regarding fixation of pay.",
                 "वेतन निर्धारण के संबंध में श्री ए.बी.सी. का अभ्यावेदन अग्रेषित करना।"),
        csmop_paras=["8.4(1)", "8.9(iii)", "9.2(vii)"],
        person="first",
        paras=[
            ("I am directed to forward herewith {{papers}} received in this Department from {{receivedFrom}} on "
             "{{receivedOn}}, which relates to a matter within the competence of your office.",
             "मुझे निदेश हुआ है कि {{receivedFrom}} से {{receivedOn}} को इस विभाग में प्राप्त {{papers}} एतद्द्वारा "
             "अग्रेषित करूँ, जो आपके कार्यालय की सक्षमता के भीतर के विषय से संबंधित है।"),
            ("It is requested that the matter may be examined and a reply sent directly to the applicant, under "
             "intimation to this Department, by {{replyBy}}.",
             "अनुरोध है कि मामले की जाँच कर आवेदक को सीधे उत्तर {{replyBy}} तक भेज दिया जाए, तथा इस विभाग को "
             "इसकी सूचना दी जाए।"),
            ("{{#if applicantInformed}}", "{{#if applicantInformed}}"),
            ("The applicant has been informed of this transfer.", "आवेदक को इस अंतरण की सूचना दे दी गई है।"),
            ("{{/if}}", "{{/if}}"),
        ],
        variables=[
            var("papers", bl("What is being forwarded", "क्या अग्रेषित किया जा रहा है"), "text", True,
                ex=("the representation dated 05.06.2026 of Shri A.B.C., Section Officer",
                    "श्री ए.बी.सी., अनुभाग अधिकारी का दिनांक 05.06.2026 का अभ्यावेदन")),
            var("receivedFrom", bl("Received from", "किससे प्राप्त"), "text", True,
                ex=("Shri A.B.C., Section Officer", "श्री ए.बी.सी., अनुभाग अधिकारी")),
            var("receivedOn", bl("Received on", "प्राप्ति दिनांक"), "date", True, ex=("10.06.2026", "10.06.2026")),
            var("replyBy", bl("Reply expected by", "उत्तर कब तक अपेक्षित"), "date", True,
                ex=("15.07.2026", "15.07.2026"),
                hint=bl("Name the date. CSMOP 9.2(v) refuses 'immediately'.",
                        "तारीख दें। सीएसएमओपी 9.2(v) 'तुरंत' को स्वीकार नहीं करता।")),
            var("applicantInformed", bl("The applicant has been told", "आवेदक को सूचित कर दिया गया"), "select", False,
                ex=("yes", "हाँ"),
                options=[{"value": "yes", "label": bl("yes", "हाँ")}, {"value": "", "label": bl("not yet", "अभी नहीं")}]),
        ],
        extra_checks=[H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.CHECK_ENCLOSURES, H.CHECK_REPLY_DATE,
                      H.CHECK_SIGNATURE, H.CHECK_PARA_NUMBERING],
    ))

    out.append(mk(
        "reminder",
        group="communication", chassis="letter", base="letter",
        name=("Reminder", "अनुस्मारक"), short=("Reminder", "अनुस्मारक"),
        use_when=("Chasing a reply that has not come — first, second or final reminder on one series.",
                  "जो उत्तर नहीं आया उसका अनुसरण — एक ही शृंखला पर पहला, दूसरा या अंतिम अनुस्मारक।"),
        used_by=("Any section awaiting a reply.", "कोई भी अनुभाग जो उत्तर की प्रतीक्षा कर रहा हो।"),
        when=("CSMOP 8.10: time limits for replies are ordinarily specified, and on their expiry orders are taken "
              "on whether to allow more time or to proceed without the reply. A reminder quotes the number and "
              "date of the communication it is chasing (9.2(iv)), says which reminder it is, and names a fresh date.",
              "सीएसएमओपी 8.10 : उत्तर के लिए समय-सीमा सामान्यतः निर्दिष्ट की जाती है, और उसकी समाप्ति पर यह आदेश "
              "लिया जाता है कि और समय दिया जाए या उत्तर के बिना आगे बढ़ा जाए। अनुस्मारक में जिस पत्र का अनुसरण हो "
              "रहा है उसकी संख्या और दिनांक (9.2(iv)), यह कौन-सा अनुस्मारक है, तथा एक नई तारीख दी जाती है।"),
        subject=("Reminder — information called for on the revision of the Recruitment Rules.",
                 "अनुस्मारक — भर्ती नियमों के पुनरीक्षण पर माँगी गई सूचना।"),
        csmop_paras=["8.10", "9.2(iv)", "9.2(v)"],
        person="first",
        paras=[
            ("I am directed to invite a reference to this Department's {{originalForm}} No. {{originalNumber}} "
             "dated {{originalDate}} on the subject cited above, to which a reply is still awaited.",
             "मुझे निदेश हुआ है कि उपर्युक्त विषय पर इस विभाग के {{originalForm}} संख्या {{originalNumber}} दिनांक "
             "{{originalDate}} का संदर्भ आमंत्रित करूँ, जिसका उत्तर अब तक प्रतीक्षित है।"),
            ("{{#if previousReminder}}", "{{#if previousReminder}}"),
            ("A reminder was also issued vide No. {{previousReminder}} dated {{previousReminderDate}}.",
             "संख्या {{previousReminder}} दिनांक {{previousReminderDate}} द्वारा एक अनुस्मारक भी जारी किया गया था।"),
            ("{{/if}}", "{{/if}}"),
            ("It is requested that the information may be furnished by {{replyBy}}, so that the matter can be "
             "placed before the competent authority.",
             "अनुरोध है कि सूचना {{replyBy}} तक उपलब्ध करा दी जाए, ताकि मामला सक्षम प्राधिकारी के समक्ष रखा जा सके।"),
        ],
        variables=[
            var("stage", bl("Which reminder", "कौन-सा अनुस्मारक"), "select", True, ex=("first", "पहला"),
                options=[{"value": "first", "label": bl("First reminder", "पहला अनुस्मारक")},
                         {"value": "second", "label": bl("Second reminder", "दूसरा अनुस्मारक")},
                         {"value": "final", "label": bl("Final reminder", "अंतिम अनुस्मारक")}],
                hint=bl("A second or final reminder is normally issued at a level above the first.",
                        "दूसरा या अंतिम अनुस्मारक सामान्यतः पहले से ऊपर के स्तर पर जारी किया जाता है।")),
            var("originalForm", bl("Form of the original", "मूल पत्र का प्ररूप"), "text", True,
                ex=("Office Memorandum", "कार्यालय ज्ञापन")),
            var("originalNumber", bl("Number of the original", "मूल पत्र की संख्या"), "text", True,
                ex=("A-11011/2/2026-Estt.", "ए-11011/2/2026-स्थापना")),
            var("originalDate", bl("Date of the original", "मूल पत्र का दिनांक"), "date", True, ex=("12.05.2026", "12.05.2026")),
            var("previousReminder", bl("Previous reminder number", "पिछले अनुस्मारक की संख्या"), "text", False,
                ex=("A-11011/2/2026-Estt.(i)", "ए-11011/2/2026-स्थापना(i)")),
            var("previousReminderDate", bl("Previous reminder date", "पिछले अनुस्मारक का दिनांक"), "date", False,
                ex=("20.06.2026", "20.06.2026")),
            var("replyBy", bl("Reply expected by", "उत्तर कब तक अपेक्षित"), "date", True, ex=("31.07.2026", "31.07.2026")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.CHECK_REPLY_DATE, H.CHECK_SIGNATURE, H.CHECK_PARA_NUMBERING,
            check("quotes-original", bl("The communication being chased is quoted",
                                        "जिस पत्र का अनुसरण हो रहा है वह उद्धृत है"),
                  bl("A reminder that does not quote the number and date of what it is reminding about is a "
                     "reminder the receiving section cannot connect to anything.",
                     "जो अनुस्मारक यह नहीं बताता कि वह किस संख्या और दिनांक के पत्र की याद दिला रहा है, उसे "
                     "प्राप्तकर्ता अनुभाग किसी से जोड़ ही नहीं सकता।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": r"(No\.|संख्या).{0,60}(dated|दिनांक)"}, "9.2(iv)"),
        ],
    ))

    out.append(mk(
        "acknowledgement",
        group="communication", chassis="om", base="office-memorandum",
        name=("Acknowledgement", "पावती"), short=("Acknowledgement", "पावती"),
        title=("OFFICE MEMORANDUM", "कार्यालय ज्ञापन"),
        use_when=("Acknowledging a communication within 15 days, as CSMOP 8.9(i) requires.",
                  "सीएसएमओपी 8.9(i) के अनुसार 15 दिन के भीतर किसी पत्र की पावती देना।"),
        used_by=("Any section that has received a communication from outside Government.",
                 "कोई भी अनुभाग जिसे सरकार के बाहर से कोई पत्र प्राप्त हुआ हो।"),
        when=("CSMOP 8.9(i): a communication from a Member of Parliament, a member of the public, a recognised "
              "association or a public body is acknowledged within 15 days and replied to within the next 15 days. "
              "An acknowledgement says what was received, on what date, and by when a reply will come.",
              "सीएसएमओपी 8.9(i) : संसद सदस्य, जनता के किसी सदस्य, मान्यता प्राप्त संघ या लोक निकाय से प्राप्त पत्र "
              "की पावती 15 दिन के भीतर दी जाती है और अगले 15 दिन में उत्तर दिया जाता है। पावती में यह बताया जाता है "
              "कि क्या, किस दिनांक को प्राप्त हुआ, और उत्तर कब तक आएगा।"),
        subject=("Acknowledgement of your representation dated 05.06.2026.",
                 "आपके दिनांक 05.06.2026 के अभ्यावेदन की पावती।"),
        csmop_paras=["8.9(i)"],
        paras=[
            ("The undersigned is directed to acknowledge the receipt of {{papers}} dated {{receivedDate}}, "
             "received in this Department on {{receiptDate}} and registered as diary number {{diaryNumber}}.",
             "अधोहस्ताक्षरी को निदेश हुआ है कि दिनांक {{receivedDate}} के {{papers}} की प्राप्ति स्वीकार करें, जो "
             "इस विभाग में {{receiptDate}} को प्राप्त हुआ और डायरी संख्या {{diaryNumber}} पर पंजीकृत है।"),
            ("The matter is under examination and a reply will be sent by {{replyBy}}.",
             "मामला जाँचाधीन है और उत्तर {{replyBy}} तक भेज दिया जाएगा।"),
        ],
        variables=[
            var("papers", bl("What was received", "क्या प्राप्त हुआ"), "text", True,
                ex=("your representation regarding the fixation of pay",
                    "वेतन निर्धारण के संबंध में आपका अभ्यावेदन")),
            var("receivedDate", bl("Dated", "पत्र का दिनांक"), "date", True, ex=("05.06.2026", "05.06.2026")),
            var("receiptDate", bl("Received in this office on", "इस कार्यालय में प्राप्ति दिनांक"), "date", True,
                ex=("10.06.2026", "10.06.2026")),
            var("diaryNumber", bl("Diary number", "डायरी संख्या"), "text", True, ex=("DY/2026/1187", "डीवाई/2026/1187")),
            var("replyBy", bl("Reply will be sent by", "उत्तर कब तक भेजा जाएगा"), "date", True,
                ex=("25.06.2026", "25.06.2026"),
                hint=bl("Within 15 days of the acknowledgement — CSMOP 8.9(i).",
                        "पावती से 15 दिन के भीतर — सीएसएमओपी 8.9(i)।")),
        ],
        copy=(["The section dealing with the case.", "The file."], ["मामले से संबंधित अनुभाग।", "फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("reply-by-date", bl("The date a reply will be sent by is named",
                                      "उत्तर भेजे जाने की तारीख दी गई है"),
                  bl("An acknowledgement that does not say when a reply will come is a receipt, not an "
                     "acknowledgement — CSMOP 8.9(ii) wants the date named.",
                     "जो पावती यह नहीं बताती कि उत्तर कब आएगा वह रसीद है, पावती नहीं — सीएसएमओपी 8.9(ii) तारीख "
                     "बताने को कहता है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": r"(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}|[०-९]{1,2}[.\-/][०-९]{1,2}[.\-/][०-९]{4})"},
                  "8.9(ii)"),
        ],
    ))

    out.append(mk(
        "interim-reply",
        group="communication", chassis="om", base="office-memorandum", ref_line=True,
        name=("Interim reply", "अंतरिम उत्तर"), short=("Interim reply", "अंतरिम उत्तर"),
        title=("OFFICE MEMORANDUM", "कार्यालय ज्ञापन"),
        use_when=("Where a final reply will be delayed because information must be obtained from elsewhere.",
                  "जहाँ अंतिम उत्तर में विलंब होगा क्योंकि सूचना अन्यत्र से प्राप्त करनी है।"),
        used_by=("Any section that cannot reply finally within the time limit.",
                 "कोई भी अनुभाग जो समय-सीमा में अंतिम उत्तर नहीं दे सकता।"),
        when=("CSMOP 8.9(ii): where a final reply will be delayed, or information has to be obtained from another "
              "office, an interim reply goes within 15 days of receipt, naming the date by which a final reply "
              "will come. An interim reply that names no date is the thing 8.9(ii) exists to prevent.",
              "सीएसएमओपी 8.9(ii) : जहाँ अंतिम उत्तर में विलंब हो, या सूचना किसी अन्य कार्यालय से लेनी हो, वहाँ "
              "प्राप्ति के 15 दिन के भीतर अंतरिम उत्तर भेजा जाता है, जिसमें अंतिम उत्तर की तारीख दी जाती है। बिना "
              "तारीख का अंतरिम उत्तर वही है जिसे रोकने के लिए 8.9(ii) है।"),
        subject=("Interim reply — grant of Children Education Allowance for the academic year 2025-26.",
                 "अंतरिम उत्तर — शैक्षणिक वर्ष 2025-26 हेतु बाल शिक्षा भत्ते की स्वीकृति।"),
        csmop_paras=["8.9(ii)", "8.10"],
        paras=[
            ("The undersigned is directed to refer to the communication cited above and to say that the matter "
             "requires {{whatIsAwaited}}, which has been called for from {{awaitedFrom}}.",
             "अधोहस्ताक्षरी को निदेश हुआ है कि उपर्युक्त पत्र का संदर्भ लेते हुए यह कहें कि मामले में "
             "{{whatIsAwaited}} अपेक्षित है, जो {{awaitedFrom}} से माँगा गया है।"),
            ("A final reply will be sent by {{finalReplyBy}}.", "अंतिम उत्तर {{finalReplyBy}} तक भेजा जाएगा।"),
        ],
        variables=[
            var("whatIsAwaited", bl("What is being awaited", "किसकी प्रतीक्षा है"), "text", True,
                ex=("the comments of the Integrated Finance Division", "एकीकृत वित्त प्रभाग की टिप्पणियाँ")),
            var("awaitedFrom", bl("Awaited from", "किससे अपेक्षित"), "text", True,
                ex=("the Integrated Finance Division", "एकीकृत वित्त प्रभाग")),
            var("finalReplyBy", bl("Final reply by", "अंतिम उत्तर कब तक"), "date", True, ex=("31.07.2026", "31.07.2026")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("final-reply-date", bl("The date of the final reply is named",
                                         "अंतिम उत्तर की तारीख दी गई है"),
                  bl("An interim reply exists to give the party a date. Without one it says only that nothing "
                     "has happened, which the party already knows.",
                     "अंतरिम उत्तर इसलिए है कि पक्षकार को एक तारीख मिले। तारीख के बिना वह केवल यह कहता है कि कुछ "
                     "नहीं हुआ, जो पक्षकार पहले से जानता है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": r"(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4}|[०-९]{1,2}[.\-/][०-९]{1,2}[.\-/][०-९]{4})"},
                  "8.9(ii)"),
        ],
    ))

    out.append(mk(
        "advisory",
        group="communication", chassis="om", base="office-memorandum",
        name=("Advisory", "परामर्शी"), short=("Advisory", "परामर्शी"),
        title=("OFFICE MEMORANDUM", "कार्यालय ज्ञापन"),
        use_when=("Drawing attention to existing instructions without issuing new ones.",
                  "नए अनुदेश जारी किए बिना विद्यमान अनुदेशों की ओर ध्यान आकर्षित करना।"),
        used_by=("A Department, to its own offices and attached and subordinate offices.",
                 "एक विभाग, अपने कार्यालयों तथा संलग्न और अधीनस्थ कार्यालयों को।"),
        when=("An advisory reminds offices of instructions already in force and of what is expected under them. "
              "It is not a circular: a circular conveys a decision to a wide audience, an advisory says 'the rule "
              "already says this, and it is not being followed'. It must cite the instruction it is about, or it "
              "creates the impression of a new requirement.",
              "परामर्शी कार्यालयों को पहले से लागू अनुदेशों और उनके अंतर्गत अपेक्षाओं की याद दिलाती है। यह परिपत्र "
              "नहीं है : परिपत्र किसी निर्णय को व्यापक रूप से संप्रेषित करता है, परामर्शी कहती है 'नियम पहले से यह "
              "कहता है और उसका पालन नहीं हो रहा'। इसमें उस अनुदेश का उल्लेख होना चाहिए जिसके बारे में वह है, "
              "अन्यथा किसी नई अपेक्षा का आभास होता है।"),
        subject=("Timely submission of Annual Performance Appraisal Reports — advisory.",
                 "वार्षिक निष्पादन मूल्यांकन रिपोर्टों का समय पर प्रस्तुतीकरण — परामर्शी।"),
        csmop_paras=["8.4(3)", "9.2(iii)"],
        paras=[
            ("The undersigned is directed to invite attention to {{instruction}}, which prescribes {{whatItSays}}.",
             "अधोहस्ताक्षरी को निदेश हुआ है कि {{instruction}} की ओर ध्यान आकर्षित करें, जो {{whatItSays}} निर्धारित करता है।"),
            ("It has been observed that {{observation}}.", "यह देखा गया है कि {{observation}}।"),
            ("All concerned are advised to ensure compliance with the said instructions with effect from "
             "{{effectiveFrom}}. This issues with the approval of {{approvedBy}}.",
             "सभी संबंधितों को सलाह दी जाती है कि {{effectiveFrom}} से उक्त अनुदेशों का अनुपालन सुनिश्चित करें। "
             "यह {{approvedBy}} के अनुमोदन से जारी है।"),
        ],
        variables=[
            var("instruction", bl("Instruction being recalled", "जिस अनुदेश की याद दिलाई जा रही है"), "text", True,
                ex=("the Department of Personnel and Training O.M. No. 21011/1/2005-Estt.(A) dated 14.05.2009",
                    "कार्मिक और प्रशिक्षण विभाग का कार्यालय ज्ञापन संख्या 21011/1/2005-स्था.(क) दिनांक 14.05.2009")),
            var("whatItSays", bl("What it prescribes", "वह क्या निर्धारित करता है"), "textarea", True,
                ex=("the time schedule for the completion of Annual Performance Appraisal Reports",
                    "वार्षिक निष्पादन मूल्यांकन रिपोर्टों को पूरा करने की समय-सारणी")),
            var("observation", bl("What has been observed", "क्या देखा गया है"), "textarea", True,
                ex=("reports for a number of officers are being submitted well beyond the prescribed dates",
                    "अनेक अधिकारियों की रिपोर्टें निर्धारित तिथियों के काफी बाद प्रस्तुत की जा रही हैं")),
            var("effectiveFrom", bl("With effect from", "किस दिनांक से"), "date", True, ex=("01.10.2026", "01.10.2026")),
            var("approvedBy", bl("Approved by", "किसके अनुमोदन से"), "text", True,
                ex=("the Joint Secretary (Administration)", "संयुक्त सचिव (प्रशासन)")),
        ],
        copy=(["All Divisions and Sections in the Department.", "All attached and subordinate offices.",
               "The Department's website, for publication."],
              ["विभाग के सभी प्रभाग और अनुभाग।", "सभी संलग्न और अधीनस्थ कार्यालय।", "प्रकाशन हेतु विभाग की वेबसाइट।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("cites-instruction", bl("The instruction being recalled is cited",
                                          "जिस अनुदेश की याद दिलाई जा रही है वह उद्धृत है"),
                  bl("An advisory that cites nothing reads as a new requirement, which is exactly what an "
                     "advisory is not.",
                     "जो परामर्शी कुछ उद्धृत नहीं करती वह नई अपेक्षा जैसी पढ़ी जाती है, जो परामर्शी कदापि नहीं है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": r"(O\.M\.|Office Memorandum|rule|circular|instructions?|कार्यालय ज्ञापन|नियम|परिपत्र|अनुदेश)"},
                  "9.2(iv)"),
        ],
    ))

    out.append(mk(
        "minutes-of-meeting",
        encl=(["The agenda circulated for the meeting."],
              ["बैठक हेतु परिचालित कार्यसूची।"]),
        group="internal", chassis="om", base="office-memorandum", urgency=False,
        name=("Minutes of meeting", "बैठक का कार्यवृत्त"), short=("Minutes", "कार्यवृत्त"),
        title=("MINUTES OF THE MEETING", "बैठक का कार्यवृत्त"),
        use_when=("Recording a meeting: who chaired, who attended, what was decided and who acts on each item.",
                  "बैठक का अभिलेख : अध्यक्षता किसने की, कौन उपस्थित रहे, क्या निर्णय हुए और प्रत्येक मद पर कौन कार्रवाई करेगा।"),
        used_by=("The section that convened the meeting.", "बैठक बुलाने वाला अनुभाग।"),
        when=("CSMOP 8.4(10): minutes record the date, time and venue of a meeting, who presided, who "
              "participated, the conclusions reached and who is to act on each. The last of those is the one "
              "most often left out, and it is what makes minutes usable a month later.",
              "सीएसएमओपी 8.4(10) : कार्यवृत्त में बैठक का दिनांक, समय और स्थान, अध्यक्षता, प्रतिभागी, निकाले गए "
              "निष्कर्ष तथा प्रत्येक पर कौन कार्रवाई करेगा, अभिलिखित होते हैं। अंतिम बात ही सबसे अधिक छूटती है, और "
              "वही कार्यवृत्त को एक माह बाद उपयोगी बनाती है।"),
        subject=("Minutes of the meeting held on 20.08.2026 on the revision of the Recruitment Rules.",
                 "भर्ती नियमों के पुनरीक्षण पर दिनांक 20.08.2026 को हुई बैठक का कार्यवृत्त।"),
        csmop_paras=["8.4(10)"],
        note=("CSMOP 8.4(10) names Minutes as a form of written communication and says what they record, but "
              "Appendix 8.1 carries no specimen for one. This template is built on the Office Memorandum head.",
              "सीएसएमओपी 8.4(10) कार्यवृत्त को लिखित संचार के एक प्ररूप के रूप में नामित करता है और बताता है कि "
              "उसमें क्या अभिलिखित होता है, पर परिशिष्ट 8.1 में उसका कोई नमूना नहीं है। यह टेम्पलेट कार्यालय ज्ञापन "
              "के शीर्ष पर बना है।"),
        paras=[
            ("A meeting was held on {{meetingDate}} at {{meetingTime}} in {{venue}} under the chairmanship of "
             "{{chairperson}} to consider {{agenda}}.",
             "{{agenda}} पर विचार करने हेतु {{meetingDate}} को {{meetingTime}} बजे {{venue}} में {{chairperson}} "
             "की अध्यक्षता में एक बैठक हुई।"),
            ("# Participants", "# प्रतिभागी"),
            ("{{#each participants}}", "{{#each participants}}"),
            ("{{@index}}. {{.}}", "{{@index}}. {{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("# Discussion and decisions", "# चर्चा और निर्णय"),
            ("{{#each decisions}}", "{{#each decisions}}"),
            ("{{.}}", "{{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("The meeting ended with a vote of thanks to the Chair. Action on each decision above rests with the "
             "office named against it, and a compliance report is to reach this Section by {{complianceBy}}.",
             "बैठक अध्यक्ष महोदय के प्रति धन्यवाद ज्ञापन के साथ समाप्त हुई। उपर्युक्त प्रत्येक निर्णय पर कार्रवाई "
             "उसके सामने नामित कार्यालय की है, और अनुपालन रिपोर्ट {{complianceBy}} तक इस अनुभाग में पहुँचनी चाहिए।"),
        ],
        variables=[
            var("meetingDate", bl("Date of the meeting", "बैठक का दिनांक"), "date", True, ex=("20.08.2026", "20.08.2026")),
            var("meetingTime", bl("Time", "समय"), "text", True, ex=("11.00 a.m.", "पूर्वाह्न 11.00")),
            var("venue", bl("Venue", "स्थान"), "text", True,
                ex=("Room No. 108, North Block, New Delhi", "कक्ष संख्या 108, नॉर्थ ब्लॉक, नई दिल्ली")),
            var("chairperson", bl("Who presided", "अध्यक्षता किसने की"), "text", True,
                ex=("Shri R.K. Sharma, Joint Secretary (Administration)",
                    "श्री आर.के. शर्मा, संयुक्त सचिव (प्रशासन)")),
            var("agenda", bl("What was considered", "किस पर विचार हुआ"), "text", True,
                ex=("the revision of the Recruitment Rules for the post of Assistant Section Officer",
                    "सहायक अनुभाग अधिकारी पद के भर्ती नियमों का पुनरीक्षण")),
            var("participants", bl("Participants", "प्रतिभागी"), "enclosures", True,
                ex=("Shri A.B.C., Director (Establishment)", "श्री ए.बी.सी., निदेशक (स्थापना)"),
                hint=bl("One per line, with designation.", "प्रति पंक्ति एक, पदनाम सहित।")),
            var("decisions", bl("Decisions, one per line", "निर्णय, प्रति पंक्ति एक"), "enclosures", True,
                ex=("The draft Recruitment Rules will be circulated to all Divisions for comments by 05.09.2026 — "
                    "Establishment Section.",
                    "भर्ती नियमों का मसौदा टिप्पणियों हेतु सभी प्रभागों को 05.09.2026 तक परिचालित किया जाएगा — "
                    "स्थापना अनुभाग।"),
                hint=bl("End each with the office that has to act on it.",
                        "प्रत्येक के अंत में वह कार्यालय लिखें जिसे कार्रवाई करनी है।")),
            var("complianceBy", bl("Compliance report by", "अनुपालन रिपोर्ट कब तक"), "date", True,
                ex=("30.09.2026", "30.09.2026")),
        ],
        copy=(["All participants.", "The meeting file."], ["सभी प्रतिभागी।", "बैठक फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("who-presided", bl("Date, venue and who presided are recorded",
                                     "दिनांक, स्थान और अध्यक्षता अभिलिखित हैं"),
                  bl("Minutes record the date, time and venue of the meeting and who presided over it.",
                     "कार्यवृत्त में बैठक का दिनांक, समय और स्थान तथा अध्यक्षता अभिलिखित होती है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(chairmanship|presided|chaired|अध्यक्षता)"}, "8.4(10)"),
            check("action-owner", bl("Each decision names who acts on it",
                                     "प्रत्येक निर्णय पर कार्रवाई करने वाला नामित है"),
                  bl("Minutes that record what was decided but not who does it are minutes nobody can follow up.",
                     "जो कार्यवृत्त यह अभिलिखित करता है कि क्या तय हुआ पर यह नहीं कि कौन करेगा, उसका अनुसरण कोई "
                     "नहीं कर सकता।"),
                  "should", {"kind": "regex", "role": "body",
                             "pattern": "(Section|Division|Officer|अनुभाग|प्रभाग|अधिकारी)"}, "8.4(10)"),
        ],
    ))

    out.append(mk(
        "agenda-note",
        encl=(["The draft Recruitment Rules, 2026."],
              ["भर्ती नियम, 2026 का मसौदा।"]),
        group="internal", chassis="om", base="office-memorandum",
        name=("Agenda note", "कार्यसूची टिप्पणी"), short=("Agenda note", "कार्यसूची"),
        title=("AGENDA NOTE", "कार्यसूची टिप्पणी"),
        use_when=("Putting an item before a committee or a meeting, with the background and the decision sought.",
                  "किसी समिति या बैठक के समक्ष मद रखना, पृष्ठभूमि और अपेक्षित निर्णय सहित।"),
        used_by=("The section that services the committee.", "समिति का कार्य देखने वाला अनुभाग।"),
        when=("An agenda note is a self-contained note for people who have not seen the file. CSMOP 7.2(viii) "
              "requires a self-contained note with every case going to the Secretary or the Minister, and the same "
              "discipline applies to a committee: the background, the issue, what the rules provide, the options, "
              "and the specific decision sought — in that order.",
              "कार्यसूची टिप्पणी उन लोगों के लिए स्वतःपूर्ण टिप्पणी है जिन्होंने फाइल नहीं देखी। सीएसएमओपी 7.2(viii) "
              "सचिव या मंत्री को जाने वाले प्रत्येक मामले के साथ स्वतःपूर्ण टिप्पणी की अपेक्षा करता है, और वही "
              "अनुशासन समिति पर भी लागू होता है : पृष्ठभूमि, मुद्दा, नियम क्या कहते हैं, विकल्प, और अपेक्षित "
              "विशिष्ट निर्णय — इसी क्रम में।"),
        subject=("Agenda item 3 — revision of the Recruitment Rules for the post of Assistant Section Officer.",
                 "कार्यसूची मद 3 — सहायक अनुभाग अधिकारी पद के भर्ती नियमों का पुनरीक्षण।"),
        csmop_paras=["7.2(viii)", "7.14"],
        paras=[
            ("The item is placed before {{committee}} at its meeting to be held on {{meetingDate}}.",
             "यह मद {{committee}} के समक्ष उसकी {{meetingDate}} को होने वाली बैठक में रखी जा रही है।"),
            ("# Background", "# पृष्ठभूमि"),
            ("{{background}}", "{{background}}"),
            ("# The issue", "# मुद्दा"),
            ("{{issue}}", "{{issue}}"),
            ("# What the rules provide", "# नियम क्या कहते हैं"),
            ("{{provision}}", "{{provision}}"),
            ("# Decision sought", "# अपेक्षित निर्णय"),
            ("{{decisionSought}}", "{{decisionSought}}"),
        ],
        variables=[
            var("committee", bl("Committee or forum", "समिति या मंच"), "text", True,
                ex=("the Departmental Promotion Committee", "विभागीय पदोन्नति समिति")),
            var("meetingDate", bl("Meeting date", "बैठक का दिनांक"), "date", True, ex=("20.09.2026", "20.09.2026")),
            var("background", bl("Background", "पृष्ठभूमि"), "textarea", True,
                ex=("The Recruitment Rules for the post were last notified in 2011 and do not reflect the "
                    "restructuring of the Section carried out in 2024.",
                    "इस पद के भर्ती नियम अंतिम बार 2011 में अधिसूचित हुए थे और उनमें 2024 में किए गए अनुभाग "
                    "पुनर्गठन का प्रतिबिंब नहीं है।")),
            var("issue", bl("The issue for decision", "निर्णय के लिए मुद्दा"), "textarea", True,
                ex=("Whether the qualifying service for promotion should be reduced from eight years to five.",
                    "क्या पदोन्नति हेतु अर्हक सेवा आठ वर्ष से घटाकर पाँच वर्ष की जानी चाहिए।")),
            var("provision", bl("What the rules provide", "नियम क्या कहते हैं"), "textarea", True,
                ex=("The Department of Personnel and Training's model Recruitment Rules provide for five years' "
                    "qualifying service at this level.",
                    "कार्मिक और प्रशिक्षण विभाग के आदर्श भर्ती नियम इस स्तर पर पाँच वर्ष की अर्हक सेवा का प्रावधान "
                    "करते हैं।")),
            var("decisionSought", bl("Decision sought", "अपेक्षित निर्णय"), "textarea", True,
                ex=("The Committee may approve the reduction of the qualifying service to five years and the "
                    "issue of the revised Rules.",
                    "समिति अर्हक सेवा घटाकर पाँच वर्ष करने तथा पुनरीक्षित नियम जारी करने का अनुमोदन कर सकती है।")),
        ],
        copy=(["All members of the Committee.", "The agenda file."], ["समिति के सभी सदस्य।", "कार्यसूची फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.CHECK_SIGNATURE,
            check("decision-sought", bl("The decision sought is stated", "अपेक्षित निर्णय बताया गया है"),
                  bl("A note that describes a problem without saying what is being asked for leaves the committee "
                     "to draft the proposal itself.",
                     "जो टिप्पणी समस्या का वर्णन करती है पर यह नहीं बताती कि क्या माँगा जा रहा है, वह समिति को "
                     "स्वयं प्रस्ताव बनाने पर छोड़ देती है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(may approve|is sought|for a decision|may consider|अनुमोदन|अपेक्षित निर्णय|विचार कर)"},
                  "7.3(ix)"),
        ],
    ))

    out.append(mk(
        "tour-report",
        encl=(["Boarding passes and hotel bills for the journey."],
              ["यात्रा के बोर्डिंग पास तथा होटल बिल।"]),
        group="internal", chassis="om", base="tour-programme", urgency=False,
        name=("Tour report", "दौरा रिपोर्ट"), short=("Tour report", "दौरा रिपोर्ट"),
        title=("TOUR REPORT", "दौरा रिपोर्ट"),
        use_when=("Reporting on an official tour after return — where, why, what was seen and what follows.",
                  "लौटने के बाद सरकारी दौरे की रिपोर्ट — कहाँ, क्यों, क्या देखा और आगे क्या।"),
        used_by=("The officer who undertook the tour.", "दौरा करने वाला अधिकारी।"),
        when=("Submitted after an approved tour and before the T.A. bill, because the bill is settled against it. "
              "It names the approval, the places and dates actually visited, what was inspected or discussed, and "
              "the action now proposed — the last being the part that makes a tour report worth filing.",
              "अनुमोदित दौरे के बाद और यात्रा भत्ता बिल से पहले प्रस्तुत, क्योंकि बिल का निपटान इसी के विरुद्ध होता "
              "है। इसमें अनुमोदन, वास्तव में देखे गए स्थान और तिथियाँ, क्या निरीक्षण या चर्चा हुई, तथा अब प्रस्तावित "
              "कार्रवाई दी जाती है — अंतिम बात ही दौरा रिपोर्ट को फाइल करने योग्य बनाती है।"),
        subject=("Tour report — inspection of the Regional Office, Lucknow, from 12.08.2026 to 14.08.2026.",
                 "दौरा रिपोर्ट — क्षेत्रीय कार्यालय, लखनऊ का 12.08.2026 से 14.08.2026 तक निरीक्षण।"),
        csmop_paras=["8.4(3)"],
        paras=[
            ("The tour was undertaken with the approval of {{approvingAuthority}} conveyed vide "
             "{{approvalReference}}, for the purpose of {{purpose}}.",
             "यह दौरा {{approvalReference}} द्वारा संप्रेषित {{approvingAuthority}} के अनुमोदन से, {{purpose}} के "
             "प्रयोजन हेतु किया गया।"),
            ("# Places visited", "# देखे गए स्थान"),
            ("{{#each places}}", "{{#each places}}"),
            ("{{@index}}. {{.}}", "{{@index}}. {{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("# Observations", "# प्रेक्षण"),
            ("{{observations}}", "{{observations}}"),
            ("# Action proposed", "# प्रस्तावित कार्रवाई"),
            ("{{actionProposed}}", "{{actionProposed}}"),
            ("No free transport or hospitality was availed of during the tour except as stated above.",
             "दौरे के दौरान उपर्युक्त के अतिरिक्त कोई नि:शुल्क परिवहन या आतिथ्य नहीं लिया गया।"),
        ],
        variables=[
            var("approvingAuthority", bl("Who approved the tour", "दौरे का अनुमोदन किसने किया"), "text", True,
                ex=("the Joint Secretary (Administration)", "संयुक्त सचिव (प्रशासन)")),
            var("approvalReference", bl("Approval number and date", "अनुमोदन संख्या और दिनांक"), "text", True,
                ex=("O.M. No. A-19011/3/2026-Estt. dated 05.08.2026",
                    "कार्यालय ज्ञापन संख्या ए-19011/3/2026-स्थापना दिनांक 05.08.2026")),
            var("purpose", bl("Purpose of the tour", "दौरे का प्रयोजन"), "text", True,
                ex=("the annual inspection of the Regional Office, Lucknow",
                    "क्षेत्रीय कार्यालय, लखनऊ का वार्षिक निरीक्षण")),
            var("places", bl("Places and dates", "स्थान और तिथियाँ"), "enclosures", True,
                ex=("Regional Office, Lucknow — 12.08.2026 to 14.08.2026",
                    "क्षेत्रीय कार्यालय, लखनऊ — 12.08.2026 से 14.08.2026"),
                hint=bl("One per line, with the dates actually spent there.",
                        "प्रति पंक्ति एक, वहाँ वास्तव में बिताई गई तिथियों सहित।")),
            var("observations", bl("Observations", "प्रेक्षण"), "textarea", True,
                ex=("The Office is functioning with four posts vacant against a sanctioned strength of eleven, "
                    "and disposal of pension cases has slipped to an average of 62 days.",
                    "कार्यालय स्वीकृत ग्यारह पदों में से चार रिक्त रहते हुए कार्य कर रहा है, और पेंशन मामलों का "
                    "निपटान औसतन 62 दिन तक पहुँच गया है।")),
            var("actionProposed", bl("Action proposed", "प्रस्तावित कार्रवाई"), "textarea", True,
                ex=("The vacancies may be filled on priority and a monthly disposal statement called for from "
                    "the Regional Office.",
                    "रिक्तियाँ प्राथमिकता से भरी जाएँ और क्षेत्रीय कार्यालय से मासिक निपटान विवरण माँगा जाए।")),
        ],
        copy=(["The Establishment Section, for the T.A. bill.", "The tour file."],
              ["यात्रा भत्ता बिल हेतु स्थापना अनुभाग।", "दौरा फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.CHECK_SIGNATURE,
            check("approval-cited", bl("The tour approval is cited", "दौरा अनुमोदन उद्धृत है"),
                  bl("The T.A. bill is settled against the approved programme; a report that does not cite the "
                     "approval cannot be matched to it.",
                     "यात्रा भत्ता बिल का निपटान अनुमोदित कार्यक्रम के विरुद्ध होता है; जो रिपोर्ट अनुमोदन उद्धृत "
                     "नहीं करती उसे उससे मिलाया नहीं जा सकता।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": r"(approval|sanction|अनुमोदन|स्वीकृति)"}, "9.2(iv)"),
        ],
    ))

    out.append(mk(
        "joining-report",
        encl=(["A copy of the relieving order dated 31.08.2026."],
              ["दिनांक 31.08.2026 के कार्यमुक्ति आदेश की प्रति।"]),
        group="personal", chassis="application", base="letter", urgency=False,
        name=("Joining report", "कार्यग्रहण रिपोर्ट"), short=("Joining report", "कार्यग्रहण"),
        use_when=("Reporting that you have joined a post, on transfer, promotion, or return from leave.",
                  "यह सूचित करना कि आपने स्थानांतरण, पदोन्नति या अवकाश से लौटकर पद ग्रहण कर लिया है।"),
        used_by=("An officer joining a post.", "पद ग्रहण करने वाला अधिकारी।"),
        when=("Submitted on the day of joining. It must state the date and the forenoon or afternoon, because "
              "pay, allowances and the joining time are all counted from that half-day. Where joining follows "
              "a transfer, the relieving order is cited so the two offices' records agree.",
              "कार्यग्रहण के दिन प्रस्तुत। इसमें दिनांक और पूर्वाह्न या अपराह्न अवश्य लिखा जाना चाहिए, क्योंकि वेतन, "
              "भत्ते और कार्यग्रहण काल सभी उसी आधे दिन से गिने जाते हैं। जहाँ कार्यग्रहण स्थानांतरण के बाद हो, वहाँ "
              "कार्यमुक्ति आदेश उद्धृत किया जाता है ताकि दोनों कार्यालयों के अभिलेख मेल खाएँ।"),
        subject=("Joining report on transfer to the Department of Expenditure.",
                 "व्यय विभाग में स्थानांतरण पर कार्यग्रहण रिपोर्ट।"),
        csmop_paras=["8.4(1)"],
        addressee=(["The Under Secretary (Establishment)", "Department of Expenditure", "North Block, New Delhi"],
                   ["अवर सचिव (स्थापना)", "व्यय विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]),
        designation=("Section Officer", "अनुभाग अधिकारी"),
        paras=[
            ("I have to report that I have joined the post of {{post}} in this Department on the {{joiningTime}} "
             "of {{joiningDate}}, in pursuance of {{orderReference}}.",
             "मुझे यह सूचित करना है कि मैंने {{orderReference}} के अनुसरण में {{joiningDate}} के {{joiningTime}} में "
             "इस विभाग में {{post}} का पद ग्रहण कर लिया है।"),
            ("I was relieved from {{previousOffice}} on the {{reliefTime}} of {{reliefDate}} vide their order "
             "No. {{relievingOrder}}.",
             "मुझे {{previousOffice}} से उनके आदेश संख्या {{relievingOrder}} द्वारा {{reliefDate}} के "
             "{{reliefTime}} में कार्यमुक्त किया गया था।"),
            ("It is requested that my joining may kindly be taken on record and the necessary entries made in "
             "the service book.",
             "अनुरोध है कि मेरे कार्यग्रहण को अभिलेख में लिया जाए और सेवा पुस्तिका में आवश्यक प्रविष्टियाँ की जाएँ।"),
        ],
        variables=[
            var("post", bl("Post joined", "ग्रहण किया गया पद"), "text", True, ex=("Section Officer", "अनुभाग अधिकारी")),
            var("joiningDate", bl("Date of joining", "कार्यग्रहण दिनांक"), "date", True, ex=("01.09.2026", "01.09.2026")),
            var("joiningTime", bl("Forenoon or afternoon", "पूर्वाह्न या अपराह्न"), "select", True,
                ex=("forenoon", "पूर्वाह्न"),
                options=[{"value": "forenoon", "label": bl("forenoon", "पूर्वाह्न")},
                         {"value": "afternoon", "label": bl("afternoon", "अपराह्न")}]),
            var("orderReference", bl("Order under which you joined", "जिस आदेश के अंतर्गत कार्यग्रहण"), "text", True,
                ex=("order No. A-32011/4/2026-Estt. dated 12.08.2026",
                    "आदेश संख्या ए-32011/4/2026-स्थापना दिनांक 12.08.2026")),
            var("previousOffice", bl("Office relieved from", "जिस कार्यालय से कार्यमुक्त"), "text", True,
                ex=("the Department of Personnel and Training", "कार्मिक और प्रशिक्षण विभाग")),
            var("reliefDate", bl("Date of relief", "कार्यमुक्ति दिनांक"), "date", True, ex=("31.08.2026", "31.08.2026")),
            var("reliefTime", bl("Forenoon or afternoon of relief", "कार्यमुक्ति का पूर्वाह्न या अपराह्न"), "select", True,
                ex=("afternoon", "अपराह्न"),
                options=[{"value": "forenoon", "label": bl("forenoon", "पूर्वाह्न")},
                         {"value": "afternoon", "label": bl("afternoon", "अपराह्न")}]),
            var("relievingOrder", bl("Relieving order number", "कार्यमुक्ति आदेश संख्या"), "text", True,
                ex=("A-32011/4/2026-Estt.", "ए-32011/4/2026-स्थापना")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_PARA_NUMBERING,
            check("half-day", bl("The forenoon or afternoon of joining is stated",
                                 "कार्यग्रहण का पूर्वाह्न या अपराह्न लिखा है"),
                  bl("Pay and the joining time run from the half-day. A report giving only a date will come back.",
                     "वेतन और कार्यग्रहण काल आधे दिन से चलते हैं। केवल दिनांक देने वाली रिपोर्ट लौट आएगी।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(forenoon|afternoon|पूर्वाह्न|अपराह्न)"}),
        ],
    ))

    out.append(mk(
        "charge-report",
        encl=(["The cash book and the permanent advance register."],
              ["रोकड़ बही तथा स्थायी अग्रिम रजिस्टर।"]),
        group="personal", chassis="application", base="letter", urgency=False,
        name=("Handing over / taking over charge report", "कार्यभार हस्तांतरण / ग्रहण रिपोर्ट"),
        short=("Charge report", "कार्यभार रिपोर्ट"),
        use_when=("Recording that charge of a post, its cash, stores and pending files has changed hands.",
                  "यह अभिलिखित करना कि किसी पद, उसकी नकदी, भंडार और लंबित फाइलों का कार्यभार बदल गया है।"),
        used_by=("The officer handing over and the officer taking over, jointly.",
                 "कार्यभार सौंपने वाला और ग्रहण करने वाला अधिकारी, संयुक्त रूप से।"),
        when=("Signed by both officers on the day charge changes hands. What makes it useful later is the list "
              "of what was actually handed over — cash, stamps, keys, stores, and the files still pending — "
              "because that list is the only record of what the incoming officer inherited.",
              "कार्यभार बदलने के दिन दोनों अधिकारियों द्वारा हस्ताक्षरित। इसे बाद में उपयोगी वह सूची बनाती है कि "
              "वास्तव में क्या सौंपा गया — नकदी, टिकट, चाबियाँ, भंडार, और अब भी लंबित फाइलें — क्योंकि वही एकमात्र "
              "अभिलेख है कि आने वाले अधिकारी को क्या मिला।"),
        subject=("Handing over and taking over of the charge of the post of Section Officer (Establishment).",
                 "अनुभाग अधिकारी (स्थापना) पद के कार्यभार का हस्तांतरण एवं ग्रहण।"),
        csmop_paras=["8.4(1)"],
        addressee=(["The Under Secretary (Establishment)", "Department of Personnel and Training",
                    "North Block, New Delhi"],
                   ["अवर सचिव (स्थापना)", "कार्मिक और प्रशिक्षण विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]),
        designation=("Section Officer", "अनुभाग अधिकारी"),
        paras=[
            ("I, {{outgoingOfficer}}, {{outgoingDesignation}}, have handed over the charge of the post of "
             "{{post}} on the {{time}} of {{chargeDate}} to {{incomingOfficer}}, {{incomingDesignation}}, who "
             "has taken over the same.",
             "मैं, {{outgoingOfficer}}, {{outgoingDesignation}}, ने {{chargeDate}} के {{time}} में {{post}} पद का "
             "कार्यभार {{incomingOfficer}}, {{incomingDesignation}} को सौंप दिया है, जिन्होंने उसे ग्रहण कर लिया है।"),
            ("# Handed over", "# सौंपी गई वस्तुएँ"),
            ("{{#each itemsHandedOver}}", "{{#each itemsHandedOver}}"),
            ("{{@index}}. {{.}}", "{{@index}}. {{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("{{#if pendingItems}}", "{{#if pendingItems}}"),
            ("The following matters were pending on the date of transfer of charge and have been brought to the "
             "notice of the incoming officer: {{pendingItems}}",
             "कार्यभार हस्तांतरण की तिथि को निम्नलिखित मामले लंबित थे और उन्हें आने वाले अधिकारी के संज्ञान में लाया "
             "गया है : {{pendingItems}}"),
            ("{{/if}}", "{{/if}}"),
            ("The charge report is submitted for record and for the necessary entries in the service books of "
             "both officers.",
             "यह कार्यभार रिपोर्ट अभिलेख हेतु तथा दोनों अधिकारियों की सेवा पुस्तिकाओं में आवश्यक प्रविष्टियों हेतु "
             "प्रस्तुत है।"),
        ],
        variables=[
            var("outgoingOfficer", bl("Officer handing over", "कार्यभार सौंपने वाला अधिकारी"), "text", True,
                ex=("A.B.C.", "ए.बी.सी.")),
            var("outgoingDesignation", bl("Their designation", "उनका पदनाम"), "text", True,
                ex=("Section Officer (Establishment)", "अनुभाग अधिकारी (स्थापना)")),
            var("incomingOfficer", bl("Officer taking over", "कार्यभार ग्रहण करने वाला अधिकारी"), "text", True,
                ex=("P.Q.R.", "पी.क्यू.आर.")),
            var("incomingDesignation", bl("Their designation", "उनका पदनाम"), "text", True,
                ex=("Section Officer", "अनुभाग अधिकारी")),
            var("post", bl("Post", "पद"), "text", True, ex=("Section Officer (Establishment)", "अनुभाग अधिकारी (स्थापना)")),
            var("chargeDate", bl("Date charge changed hands", "कार्यभार बदलने का दिनांक"), "date", True,
                ex=("31.08.2026", "31.08.2026")),
            var("time", bl("Forenoon or afternoon", "पूर्वाह्न या अपराह्न"), "select", True, ex=("afternoon", "अपराह्न"),
                options=[{"value": "forenoon", "label": bl("forenoon", "पूर्वाह्न")},
                         {"value": "afternoon", "label": bl("afternoon", "अपराह्न")}]),
            var("itemsHandedOver", bl("What was handed over", "क्या सौंपा गया"), "enclosures", True,
                ex=("Permanent advance of Rs. 5,000 in cash, verified and found correct.",
                    "5,000 रुपये का स्थायी अग्रिम नकद, सत्यापित और सही पाया गया।"),
                hint=bl("Cash, stamps, keys, stores, registers — one per line.",
                        "नकदी, टिकट, चाबियाँ, भंडार, रजिस्टर — प्रति पंक्ति एक।")),
            var("pendingItems", bl("Matters left pending", "लंबित छोड़े गए मामले"), "textarea", False,
                ex=("the revision of the Recruitment Rules, on which comments of three Divisions are awaited",
                    "भर्ती नियमों का पुनरीक्षण, जिस पर तीन प्रभागों की टिप्पणियाँ प्रतीक्षित हैं")),
        ],
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_PARA_NUMBERING,
            check("both-officers", bl("Both officers are named", "दोनों अधिकारी नामित हैं"),
                  bl("A charge report signed by one officer records a handover nobody acknowledged receiving.",
                     "एक ही अधिकारी द्वारा हस्ताक्षरित कार्यभार रिपोर्ट ऐसा हस्तांतरण अभिलिखित करती है जिसकी "
                     "प्राप्ति किसी ने स्वीकार नहीं की।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(taken over|taking over|ग्रहण कर)"}),
        ],
    ))

    out.append(mk(
        "noc-issue",
        group="internal", chassis="om", base="office-memorandum",
        name=("No Objection Certificate", "अनापत्ति प्रमाणपत्र"), short=("NOC (issue)", "अनापत्ति (जारी)"),
        title=("NO OBJECTION CERTIFICATE", "अनापत्ति प्रमाणपत्र"),
        use_when=("Issuing a no-objection certificate to an employee for a passport, a job application or a loan.",
                  "पासपोर्ट, नौकरी के आवेदन या ऋण हेतु किसी कर्मचारी को अनापत्ति प्रमाणपत्र जारी करना।"),
        used_by=("An establishment section, as the employer.", "स्थापना अनुभाग, नियोक्ता के रूप में।"),
        when=("A no-objection certificate states what the office knows and does not object to, and nothing more. "
              "It must name the employee, the post, the purpose it is issued for, and the period of its validity "
              "— an NOC with no purpose written on it is one that will be used for a purpose the office never "
              "considered. Vigilance status is stated only where the certificate is for employment elsewhere.",
              "अनापत्ति प्रमाणपत्र वही बताता है जो कार्यालय जानता है और जिस पर उसे आपत्ति नहीं है, इससे अधिक कुछ "
              "नहीं। इसमें कर्मचारी, पद, जिस प्रयोजन हेतु जारी किया गया, और वैधता अवधि अवश्य होनी चाहिए — बिना "
              "प्रयोजन का अनापत्ति प्रमाणपत्र ऐसे प्रयोजन के लिए प्रयुक्त होगा जिस पर कार्यालय ने विचार ही नहीं "
              "किया। सतर्कता स्थिति केवल तभी बताई जाती है जब प्रमाणपत्र अन्यत्र नियोजन हेतु हो।"),
        subject=("No Objection Certificate for the issue of an ordinary passport.",
                 "साधारण पासपोर्ट जारी करने हेतु अनापत्ति प्रमाणपत्र।"),
        csmop_paras=["8.4(3)"],
        paras=[
            ("This is to certify that {{employeeName}} is employed in this Department as {{employeeDesignation}} "
             "since {{sinceDate}} and that the Department has no objection to {{noObjectionTo}}.",
             "यह प्रमाणित किया जाता है कि {{employeeName}} इस विभाग में {{sinceDate}} से {{employeeDesignation}} के "
             "रूप में कार्यरत हैं और विभाग को {{noObjectionTo}} पर कोई आपत्ति नहीं है।"),
            ("{{#if vigilanceStatus}}", "{{#if vigilanceStatus}}"),
            ("{{vigilanceStatus}}", "{{vigilanceStatus}}"),
            ("{{/if}}", "{{/if}}"),
            ("This certificate is issued at the request of the employee for {{purpose}} and is valid up to "
             "{{validUpto}}. It is not to be used for any other purpose.",
             "यह प्रमाणपत्र कर्मचारी के अनुरोध पर {{purpose}} हेतु जारी किया गया है और {{validUpto}} तक वैध है। "
             "इसका प्रयोग किसी अन्य प्रयोजन हेतु नहीं किया जाना है।"),
        ],
        variables=[
            var("employeeName", bl("Employee's name", "कर्मचारी का नाम"), "text", True, ex=("Shri A.B.C.", "श्री ए.बी.सी.")),
            var("employeeDesignation", bl("Designation", "पदनाम"), "text", True,
                ex=("Assistant Section Officer", "सहायक अनुभाग अधिकारी")),
            var("sinceDate", bl("In service since", "कब से सेवा में"), "date", True, ex=("15.07.2019", "15.07.2019")),
            var("noObjectionTo", bl("What there is no objection to", "किस पर कोई आपत्ति नहीं"), "text", True,
                ex=("the issue of an ordinary passport to the employee",
                    "कर्मचारी को साधारण पासपोर्ट जारी किए जाने")),
            var("vigilanceStatus", bl("Vigilance status, where relevant", "सतर्कता स्थिति, जहाँ प्रासंगिक हो"),
                "textarea", False,
                ex=("No disciplinary or vigilance proceedings are pending or contemplated against the employee.",
                    "कर्मचारी के विरुद्ध कोई अनुशासनिक या सतर्कता कार्यवाही न तो लंबित है और न विचाराधीन है।")),
            var("purpose", bl("Purpose", "प्रयोजन"), "text", True,
                ex=("applying for an ordinary passport", "साधारण पासपोर्ट के लिए आवेदन करने")),
            var("validUpto", bl("Valid up to", "कब तक वैध"), "date", True, ex=("31.12.2026", "31.12.2026")),
        ],
        copy=(["The employee concerned.", "The personal file."], ["संबंधित कर्मचारी।", "वैयक्तिक फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("purpose-named", bl("The purpose and validity are stated", "प्रयोजन और वैधता लिखी गई है"),
                  bl("A no-objection certificate with no purpose and no expiry on it is a certificate the office "
                     "has lost control of.",
                     "जिस अनापत्ति प्रमाणपत्र पर कोई प्रयोजन और कोई समाप्ति तिथि नहीं, वह प्रमाणपत्र कार्यालय के "
                     "नियंत्रण से बाहर है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(valid up to|valid till|purpose|तक वैध|प्रयोजन)"}),
        ],
    ))

    out.append(mk(
        "certificate",
        group="internal", chassis="om", base="office-memorandum", urgency=False,
        name=("Certificate (experience / no dues)", "प्रमाणपत्र (अनुभव / अदेयता)"),
        short=("Certificate", "प्रमाणपत्र"),
        title=("CERTIFICATE", "प्रमाणपत्र"),
        use_when=("Certifying service, experience or that no dues are outstanding against an employee.",
                  "किसी कर्मचारी की सेवा, अनुभव या यह प्रमाणित करना कि उस पर कोई देय बकाया नहीं है।"),
        used_by=("An establishment or accounts section.", "स्थापना या लेखा अनुभाग।"),
        when=("A certificate states facts the office holds on its own record and is signed by the officer "
              "competent to speak for that record. It should say what the record is — the service book, the "
              "cash register, the stores ledger — because a certificate whose basis is not stated is one the "
              "next office has to verify anyway.",
              "प्रमाणपत्र उन तथ्यों को बताता है जो कार्यालय के अपने अभिलेख में हैं और उस पर वह अधिकारी हस्ताक्षर "
              "करता है जो उस अभिलेख के लिए सक्षम है। इसमें यह बताया जाना चाहिए कि अभिलेख क्या है — सेवा पुस्तिका, "
              "रोकड़ रजिस्टर, भंडार बही — क्योंकि जिस प्रमाणपत्र का आधार नहीं बताया गया उसे अगला कार्यालय वैसे भी "
              "सत्यापित करेगा।"),
        subject=("Certificate of service and experience in respect of Shri A.B.C.",
                 "श्री ए.बी.सी. के संबंध में सेवा एवं अनुभव प्रमाणपत्र।"),
        csmop_paras=["8.4(3)"],
        paras=[
            ("This is to certify that, as per {{recordBasis}} maintained in this office, {{employeeName}} "
             "{{certifiedFact}}.",
             "यह प्रमाणित किया जाता है कि इस कार्यालय में रखी गई {{recordBasis}} के अनुसार, {{employeeName}} "
             "{{certifiedFact}}।"),
            ("{{#if period}}", "{{#if period}}"),
            ("The period covered by this certificate is {{period}}.", "इस प्रमाणपत्र की अवधि {{period}} है।"),
            ("{{/if}}", "{{/if}}"),
            ("This certificate is issued at the request of the employee for {{purpose}}.",
             "यह प्रमाणपत्र कर्मचारी के अनुरोध पर {{purpose}} हेतु जारी किया गया है।"),
        ],
        variables=[
            var("recordBasis", bl("Record relied on", "जिस अभिलेख का आश्रय"), "text", True,
                ex=("the service book and the pay bill register", "सेवा पुस्तिका तथा वेतन बिल रजिस्टर")),
            var("employeeName", bl("Employee's name", "कर्मचारी का नाम"), "text", True,
                ex=("Shri A.B.C., Assistant Section Officer", "श्री ए.बी.सी., सहायक अनुभाग अधिकारी")),
            var("certifiedFact", bl("What is certified", "क्या प्रमाणित किया जा रहा है"), "textarea", True,
                ex=("has served in this Department in the Establishment Section, dealing with recruitment rules, "
                    "promotions and pension cases, and that no dues are outstanding against the employee",
                    "इस विभाग के स्थापना अनुभाग में भर्ती नियम, पदोन्नति और पेंशन मामलों का कार्य करते हुए सेवा की "
                    "है, और कर्मचारी पर कोई देय बकाया नहीं है")),
            var("period", bl("Period covered", "अवधि"), "text", False,
                ex=("15.07.2019 to 31.08.2026", "15.07.2019 से 31.08.2026 तक")),
            var("purpose", bl("Purpose", "प्रयोजन"), "text", True,
                ex=("submission to the Department of Expenditure", "व्यय विभाग को प्रस्तुत करने")),
        ],
        copy=(["The employee concerned.", "The personal file."], ["संबंधित कर्मचारी।", "वैयक्तिक फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE,
            check("record-basis", bl("The record the certificate rests on is named",
                                     "जिस अभिलेख पर प्रमाणपत्र आधारित है वह नामित है"),
                  bl("A certificate that does not say what it is based on is an assertion; one that names the "
                     "service book or the register is a record.",
                     "जो प्रमाणपत्र यह नहीं बताता कि वह किस पर आधारित है वह एक कथन है; जो सेवा पुस्तिका या "
                     "रजिस्टर का नाम लेता है वह अभिलेख है।"),
                  "should", {"kind": "regex", "role": "body",
                             "pattern": "(record|register|service book|ledger|अभिलेख|रजिस्टर|सेवा पुस्तिका|बही)"}),
        ],
    ))

    out.append(mk(
        "explanation-letter",
        group="internal", chassis="om", base="office-memorandum",
        name=("Letter calling for an explanation", "स्पष्टीकरण माँगने का पत्र"),
        short=("Call for explanation", "स्पष्टीकरण"),
        title=("OFFICE MEMORANDUM", "कार्यालय ज्ञापन"),
        use_when=("Calling for an explanation before deciding whether any further action is needed.",
                  "यह तय करने से पहले कि आगे कोई कार्रवाई आवश्यक है या नहीं, स्पष्टीकरण माँगना।"),
        used_by=("A controlling officer or an establishment section.",
                 "नियंत्रक अधिकारी या स्थापना अनुभाग।"),
        when=("This is NOT a charge memorandum and must not read like one. It states the fact observed, asks for "
              "the employee's explanation by a named date, and says that the explanation will be considered "
              "before a view is taken. Where a penalty is in contemplation, the CCS (CCA) Rules 1965 procedure "
              "applies and a charge memorandum under rule 14 or 16 is the correct instrument, not this.",
              "यह आरोप ज्ञापन नहीं है और उस जैसा नहीं पढ़ा जाना चाहिए। इसमें देखा गया तथ्य बताया जाता है, नामित "
              "तिथि तक कर्मचारी का स्पष्टीकरण माँगा जाता है, और यह कहा जाता है कि कोई मत बनाने से पहले स्पष्टीकरण "
              "पर विचार किया जाएगा। जहाँ शास्ति विचाराधीन हो वहाँ केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) "
              "नियम, 1965 की प्रक्रिया लागू होती है और नियम 14 या 16 के अंतर्गत आरोप ज्ञापन ही सही लिखत है, यह नहीं।"),
        subject=("Explanation called for — unauthorised absence from duty from 10.08.2026 to 14.08.2026.",
                 "स्पष्टीकरण माँगा गया — 10.08.2026 से 14.08.2026 तक कर्तव्य से अनधिकृत अनुपस्थिति।"),
        csmop_paras=["8.4(3)"],
        note=("CSMOP prescribes no format for calling an explanation. It is built on the Office Memorandum "
              "chassis. The point at which an explanation becomes a disciplinary proceeding is governed by the "
              "CCS (CCA) Rules, 1965, not by the manual.",
              "सीएसएमओपी स्पष्टीकरण माँगने का कोई प्रारूप निर्धारित नहीं करता। यह कार्यालय ज्ञापन ढाँचे पर बना है। "
              "स्पष्टीकरण कब अनुशासनिक कार्यवाही बन जाता है, यह नियमावली से नहीं बल्कि केंद्रीय सिविल सेवा "
              "(वर्गीकरण, नियंत्रण और अपील) नियम, 1965 से शासित होता है।"),
        paras=[
            ("The undersigned is directed to state that {{observedFact}}.",
             "अधोहस्ताक्षरी को निदेश हुआ है कि यह बताएँ कि {{observedFact}}।"),
            ("{{employeeName}}, {{employeeDesignation}}, is requested to furnish an explanation in the matter so "
             "as to reach the undersigned by {{replyBy}}.",
             "{{employeeName}}, {{employeeDesignation}} से अनुरोध है कि इस विषय में अपना स्पष्टीकरण इस प्रकार "
             "प्रस्तुत करें कि वह {{replyBy}} तक अधोहस्ताक्षरी को प्राप्त हो जाए।"),
            ("The explanation will be considered before a view is taken in the matter. No decision has been taken "
             "and nothing in this communication is to be read as a charge.",
             "इस विषय में कोई मत बनाने से पहले स्पष्टीकरण पर विचार किया जाएगा। अभी कोई निर्णय नहीं लिया गया है और "
             "इस पत्र में कुछ भी आरोप के रूप में नहीं पढ़ा जाना है।"),
        ],
        variables=[
            var("observedFact", bl("The fact observed", "देखा गया तथ्य"), "textarea", True,
                ex=("the attendance record of the Section shows that you remained absent from duty from "
                    "10.08.2026 to 14.08.2026 without any application for leave having been received",
                    "अनुभाग के उपस्थिति अभिलेख से पता चलता है कि आप 10.08.2026 से 14.08.2026 तक कर्तव्य से "
                    "अनुपस्थित रहे और अवकाश हेतु कोई आवेदन प्राप्त नहीं हुआ")),
            var("employeeName", bl("Employee's name", "कर्मचारी का नाम"), "text", True, ex=("Shri A.B.C.", "श्री ए.बी.सी.")),
            var("employeeDesignation", bl("Designation", "पदनाम"), "text", True,
                ex=("Assistant Section Officer", "सहायक अनुभाग अधिकारी")),
            var("replyBy", bl("Explanation by", "स्पष्टीकरण कब तक"), "date", True, ex=("10.09.2026", "10.09.2026")),
        ],
        copy=(["The personal file."], ["वैयक्तिक फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.check_third_person(), H.CHECK_SIGNATURE, H.CHECK_REPLY_DATE,
            check("not-a-charge", bl("It is clear that no charge has been framed",
                                     "यह स्पष्ट है कि कोई आरोप नहीं लगाया गया है"),
                  bl("A letter calling for an explanation that reads like a charge memorandum invites the answer "
                     "that the CCS (CCA) Rules procedure was not followed.",
                     "स्पष्टीकरण माँगने का जो पत्र आरोप ज्ञापन जैसा पढ़ा जाता है, वह यह उत्तर आमंत्रित करता है कि "
                     "केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियमों की प्रक्रिया का पालन नहीं हुआ।"),
                  "should", {"kind": "regexAbsent", "role": "body",
                             "pattern": "(articles of charge|major penalty|minor penalty|आरोप के अनुच्छेद|बड़ी शास्ति|लघु शास्ति)"}),
        ],
    ))

    out.append(mk(
        "condolence-do",
        group="communication", chassis="do", base="demi-official", urgency=False,
        name=("Condolence / felicitation D.O. letter", "शोक / बधाई अर्ध-सरकारी पत्र"),
        short=("Condolence / felicitation", "शोक / बधाई"),
        person="first",
        use_when=("A personal D.O. letter of condolence on a bereavement, or of felicitation on an honour.",
                  "किसी शोक पर संवेदना, या किसी सम्मान पर बधाई का व्यक्तिगत अर्ध-सरकारी पत्र।"),
        used_by=("One officer, writing personally to another.",
                 "एक अधिकारी, दूसरे को व्यक्तिगत रूप से लिखते हुए।"),
        when=("CSMOP 8.4(2): a demi-official letter is used where the matter is to be brought to the personal "
              "attention of the officer addressed, and 9.5(i) requires the first person and the active voice. "
              "That register is the whole of this form: a condolence in the third person reads as a circular. "
              "9.5(ii) asks for not more than one page, which for this form is generous.",
              "सीएसएमओपी 8.4(2) : अर्ध-सरकारी पत्र तब प्रयुक्त होता है जब विषय संबोधित अधिकारी के व्यक्तिगत ध्यान "
              "में लाना हो, और 9.5(i) उत्तम पुरुष तथा कर्तृवाच्य की अपेक्षा करता है। यही शैली इस प्ररूप का सर्वस्व "
              "है : अन्य पुरुष में लिखी संवेदना परिपत्र जैसी पढ़ी जाती है। 9.5(ii) एक पृष्ठ से अधिक न लिखने को "
              "कहता है, जो इस प्ररूप के लिए पर्याप्त से अधिक है।"),
        subject=("", ""),
        csmop_paras=["8.4(2)", "9.5(i)", "9.5(ii)"],
        note=("CSMOP prescribes the demi-official form (8.4(2), specimen at Appendix 8.1 page 88) but no wording "
              "for a personal letter of condolence or felicitation. This template borrows the D.O. chassis.",
              "सीएसएमओपी अर्ध-सरकारी प्ररूप (8.4(2), नमूना परिशिष्ट 8.1 पृष्ठ 88) निर्धारित करता है पर संवेदना या "
              "बधाई के व्यक्तिगत पत्र के लिए कोई शब्दावली नहीं। यह टेम्पलेट अर्ध-सरकारी ढाँचा लेता है।"),
        addressee=(["Joint Secretary", "Department of Expenditure", "North Block, New Delhi"],
                   ["संयुक्त सचिव", "व्यय विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]),
        designation=("Joint Secretary to the Govt. of India", "संयुक्त सचिव, भारत सरकार"),
        paras=[
            ("{{opening}}", "{{opening}}"),
            ("{{message}}", "{{message}}"),
            ("{{closing}}", "{{closing}}"),
        ],
        variables=[
            var("opening", bl("Opening line", "आरंभिक पंक्ति"), "textarea", True,
                ex=("I was deeply saddened to learn of the passing of your father.",
                    "आपके पिताजी के निधन का समाचार जानकर मुझे अत्यंत दुःख हुआ।")),
            var("message", bl("The message", "संदेश"), "textarea", True,
                ex=("I had the privilege of meeting him during your posting at Lucknow, and I remember his "
                    "warmth and his interest in the work of this Department. Please convey my condolences to "
                    "your family.",
                    "लखनऊ में आपकी तैनाती के दौरान मुझे उनसे मिलने का सौभाग्य मिला था, और मुझे उनकी आत्मीयता तथा "
                    "इस विभाग के कार्य में उनकी रुचि स्मरण है। कृपया अपने परिवार तक मेरी संवेदनाएँ पहुँचाएँ।")),
            var("closing", bl("Closing line", "समापन पंक्ति"), "textarea", True,
                ex=("Please do let me know if there is anything I can do.",
                    "यदि मैं कुछ कर सकूँ तो कृपया अवश्य बताइएगा।")),
        ],
        extra_checks=[
            check("first-person", bl("Written in the first person", "उत्तम पुरुष में लिखा गया"),
                  bl("A demi-official letter is written in the first person and in a personal, friendly tone. "
                     "A condolence in the third person reads as a circular.",
                     "अर्ध-सरकारी पत्र उत्तम पुरुष में और व्यक्तिगत, आत्मीय शैली में लिखा जाता है। अन्य पुरुष में "
                     "लिखी संवेदना परिपत्र जैसी पढ़ी जाती है।"),
                  "must", {"kind": "person", "value": "first"}, "9.5(i)"),
            check("one-page", bl("It stays within one page", "यह एक पृष्ठ में रहता है"),
                  bl("A demi-official letter should preferably not exceed one page.",
                     "अर्ध-सरकारी पत्र अधिमानतः एक पृष्ठ से अधिक नहीं होना चाहिए।"),
                  "should", {"kind": "maxWords", "role": "body", "count": 300}, "9.5(ii)"),
        ],
    ))

    # ------------------------------------------------- statutory and personal

    out.append(mk(
        "rti-first-appeal-reply",
        group="statutory", chassis="om", base="rti-reply", urgency=False,
        name=("RTI first appeal — order", "आरटीआई प्रथम अपील — आदेश"),
        short=("First appeal order", "प्रथम अपील आदेश"),
        title=("ORDER IN FIRST APPEAL", "प्रथम अपील में आदेश"),
        use_when=("Deciding a first appeal under section 19(1) of the Right to Information Act, 2005.",
                  "सूचना का अधिकार अधिनियम, 2005 की धारा 19(1) के अंतर्गत प्रथम अपील का निर्णय।"),
        used_by=("The First Appellate Authority.", "प्रथम अपीलीय प्राधिकारी।"),
        when=("Section 19(1) of the Right to Information Act, 2005 gives an appeal to an officer senior to the "
              "CPIO, and section 19(6) requires it to be disposed of within thirty days, or forty-five for "
              "reasons recorded in writing. The order records the appeal, what the CPIO said, the finding on "
              "each point, the direction, and the second appeal to the Central Information Commission under "
              "section 19(3) with its ninety-day limit.",
              "सूचना का अधिकार अधिनियम, 2005 की धारा 19(1) केंद्रीय लोक सूचना अधिकारी से वरिष्ठ अधिकारी को अपील "
              "देती है, और धारा 19(6) उसे तीस दिन में, या लिखित रूप में कारण अभिलिखित करके पैंतालीस दिन में "
              "निपटाने की अपेक्षा करती है। आदेश में अपील, केंद्रीय लोक सूचना अधिकारी ने क्या कहा, प्रत्येक बिंदु पर "
              "निष्कर्ष, निदेश, तथा धारा 19(3) के अंतर्गत केंद्रीय सूचना आयोग को नब्बे दिन की द्वितीय अपील "
              "अभिलिखित होती है।"),
        subject=("Order in first appeal under section 19(1) of the RTI Act, 2005 — appeal of Shri A.B.C.",
                 "सूचना का अधिकार अधिनियम, 2005 की धारा 19(1) के अंतर्गत प्रथम अपील में आदेश — श्री ए.बी.सी. की अपील।"),
        csmop_paras=["12.5"],
        note=("The thirty-day limit, the duty to give reasons and the second appeal all come from the Right to "
              "Information Act, 2005 itself, not from CSMOP. The form is built on the RTI reply chassis.",
              "तीस दिन की सीमा, कारण देने का कर्तव्य और द्वितीय अपील — ये सभी सूचना का अधिकार अधिनियम, 2005 से "
              "आते हैं, सीएसएमओपी से नहीं। प्ररूप आरटीआई उत्तर ढाँचे पर बना है।"),
        addressee=(["Shri A.B.C.", "12, Rajendra Nagar", "New Delhi - 110060"],
                   ["श्री ए.बी.सी.", "12, राजेंद्र नगर", "नई दिल्ली - 110060"]),
        designation=("First Appellate Authority", "प्रथम अपीलीय प्राधिकारी"),
        paras=[
            ("The appellant filed an application under the Right to Information Act, 2005 on {{applicationDate}}, "
             "which was replied to by the Central Public Information Officer on {{cpioReplyDate}}. The present "
             "appeal under section 19(1) was received on {{appealDate}}.",
             "अपीलकर्ता ने सूचना का अधिकार अधिनियम, 2005 के अंतर्गत {{applicationDate}} को आवेदन प्रस्तुत किया, "
             "जिसका उत्तर केंद्रीय लोक सूचना अधिकारी द्वारा {{cpioReplyDate}} को दिया गया। धारा 19(1) के अंतर्गत "
             "यह अपील {{appealDate}} को प्राप्त हुई।"),
            ("The appellant's grievance is that {{grievance}}.",
             "अपीलकर्ता की शिकायत यह है कि {{grievance}}।"),
            ("The record and the submissions of the Central Public Information Officer have been examined. "
             "{{finding}}",
             "अभिलेख तथा केंद्रीय लोक सूचना अधिकारी के अभ्यावेदन की जाँच की गई है। {{finding}}"),
            ("Accordingly, the appeal is {{decision}}. {{direction}}",
             "तदनुसार, अपील {{decision}} की जाती है। {{direction}}"),
            ("If the appellant is not satisfied with this order, a second appeal lies to the Central Information "
             "Commission, Baba Gangnath Marg, Munirka, New Delhi - 110067, under section 19(3) of the Act, "
             "within ninety days of the date on which this order is received.",
             "यदि अपीलकर्ता इस आदेश से संतुष्ट नहीं है तो अधिनियम की धारा 19(3) के अंतर्गत इस आदेश की प्राप्ति की "
             "तिथि से नब्बे दिन के भीतर केंद्रीय सूचना आयोग, बाबा गंगनाथ मार्ग, मुनिरका, नई दिल्ली - 110067 को "
             "द्वितीय अपील की जा सकती है।"),
        ],
        variables=[
            var("applicationDate", bl("RTI application dated", "आरटीआई आवेदन का दिनांक"), "date", True,
                ex=("02.05.2026", "02.05.2026")),
            var("cpioReplyDate", bl("CPIO replied on", "केंद्रीय लोक सूचना अधिकारी का उत्तर दिनांक"), "date", True,
                ex=("29.05.2026", "29.05.2026")),
            var("appealDate", bl("Appeal received on", "अपील प्राप्ति दिनांक"), "date", True, ex=("18.06.2026", "18.06.2026")),
            var("grievance", bl("The appellant's grievance", "अपीलकर्ता की शिकायत"), "textarea", True,
                ex=("point 3 of the application, relating to the file notings, was not answered at all",
                    "आवेदन के बिंदु 3, जो फाइल टिप्पणियों से संबंधित है, का उत्तर दिया ही नहीं गया")),
            var("finding", bl("Finding", "निष्कर्ष"), "textarea", True,
                ex=("The reply of the Central Public Information Officer does not deal with point 3, and no "
                    "exemption under section 8 has been claimed in respect of it.",
                    "केंद्रीय लोक सूचना अधिकारी के उत्तर में बिंदु 3 का निपटान नहीं किया गया है, और उसके संबंध में "
                    "धारा 8 के अंतर्गत कोई छूट का दावा नहीं किया गया है।")),
            var("decision", bl("Decision", "निर्णय"), "select", True, ex=("partly allowed", "अंशतः स्वीकार"),
                options=[{"value": "allowed", "label": bl("allowed", "स्वीकार")},
                         {"value": "partly allowed", "label": bl("partly allowed", "अंशतः स्वीकार")},
                         {"value": "dismissed", "label": bl("dismissed", "खारिज")}]),
            var("direction", bl("Direction to the CPIO", "केंद्रीय लोक सूचना अधिकारी को निदेश"), "textarea", True,
                ex=("The Central Public Information Officer is directed to furnish a point-wise reply to point 3 "
                    "free of cost within fifteen days of the receipt of this order.",
                    "केंद्रीय लोक सूचना अधिकारी को निदेश दिया जाता है कि इस आदेश की प्राप्ति के पंद्रह दिन के भीतर "
                    "बिंदु 3 का बिंदुवार उत्तर नि:शुल्क उपलब्ध कराएँ।")),
        ],
        copy=(["The Central Public Information Officer concerned.", "The RTI file."],
              ["संबंधित केंद्रीय लोक सूचना अधिकारी।", "आरटीआई फाइल।"]),
        extra_checks=[
            H.CHECK_SUBJECT, H.CHECK_NUMBER_DATE, H.CHECK_SIGNATURE,
            check("second-appeal", bl("The second appeal to the CIC is stated with its time limit",
                                      "केंद्रीय सूचना आयोग को द्वितीय अपील समय-सीमा सहित बताई गई है"),
                  bl("Section 19(3) gives ninety days for a second appeal to the Central Information Commission. "
                     "An order that does not name the forum and the limit leaves the appellant to find both.",
                     "धारा 19(3) केंद्रीय सूचना आयोग को द्वितीय अपील हेतु नब्बे दिन देती है। जो आदेश मंच और सीमा "
                     "नहीं बताता वह अपीलकर्ता को दोनों स्वयं खोजने पर छोड़ देता है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(19\\(3\\)|Central Information Commission|केंद्रीय सूचना आयोग)"}),
            check("reasons-recorded", bl("Reasons for the decision are recorded", "निर्णय के कारण अभिलिखित हैं"),
                  bl("A first-appeal order is a quasi-judicial order and must give the reasons on its face.",
                     "प्रथम अपील आदेश अर्ध-न्यायिक आदेश है और उसमें कारण उसी पर दिए जाने चाहिए।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(does not|has not|because|since|section 8|नहीं|क्योंकि|धारा 8)"}),
        ],
    ))

    def application(tid: str, *, name: tuple[str, str], short: tuple[str, str], use_when: tuple[str, str],
                    when: tuple[str, str], subject: tuple[str, str], paras: list[tuple[str, str]],
                    variables: list[dict[str, Any]], csmop_paras: list[str],
                    addressee: tuple[list[str], list[str]] | None = None,
                    note: tuple[str, str] | None = None,
                    encl: tuple[list[str], list[str]] | None = None,
                    designation: tuple[str, str] = ("Assistant Section Officer", "सहायक अनुभाग अधिकारी"),
                    extra_checks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """An officer's own application. First person, signed at the left, no
        file number — the establishment section allots one when it acts."""
        return mk(
            tid, group="personal", chassis="application", base="letter", urgency=False, person="first",
            name=name, short=short, use_when=use_when, when=when, subject=subject, paras=paras,
            variables=variables, csmop_paras=csmop_paras, note=note, designation=designation, encl=encl,
            used_by=("An officer, on their own behalf.", "एक अधिकारी, अपनी ओर से।"),
            addressee=addressee or (
                ["The Under Secretary (Establishment)", "Department of Personnel and Training",
                 "North Block, New Delhi"],
                ["अवर सचिव (स्थापना)", "कार्मिक और प्रशिक्षण विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]),
            extra_checks=(extra_checks or []) + [H.CHECK_SUBJECT, H.CHECK_PARA_NUMBERING],
        )

    out.append(application(
        "ltc-application",
        encl=(["A copy of the declaration of my home town."],
              ["मेरे गृह नगर की घोषणा की प्रति।"]),
        name=("LTC application", "अवकाश यात्रा रियायत आवेदन"), short=("LTC", "अवकाश यात्रा रियायत"),
        use_when=("Applying for leave travel concession — home town or any place in India — with an advance if wanted.",
                  "अवकाश यात्रा रियायत हेतु आवेदन — गृह नगर या भारत में कोई स्थान — चाहें तो अग्रिम सहित।"),
        when=("Under the CCS (LTC) Rules, 1988 the concession is availed in a four-year block, and the "
              "declaration of the home town and of the block being availed is what the sanctioning authority "
              "checks first. Where an advance is asked for, the application must say so before the journey, "
              "since an advance cannot be sanctioned afterwards.",
              "केंद्रीय सिविल सेवा (अवकाश यात्रा रियायत) नियम, 1988 के अंतर्गत यह रियायत चार वर्ष के ब्लॉक में ली "
              "जाती है, और गृह नगर तथा जिस ब्लॉक का उपयोग हो रहा है, उसकी घोषणा ही स्वीकृति प्राधिकारी सबसे पहले "
              "जाँचता है। जहाँ अग्रिम माँगा जाए वहाँ आवेदन में यात्रा से पूर्व यह लिखा जाना चाहिए, क्योंकि अग्रिम "
              "बाद में स्वीकृत नहीं हो सकता।"),
        subject=("Application for leave travel concession for the block year 2026-2029.",
                 "ब्लॉक वर्ष 2026-2029 हेतु अवकाश यात्रा रियायत के लिए आवेदन।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format for an LTC application; the entitlement and the block years come from "
              "the CCS (LTC) Rules, 1988. Built on the letter chassis.",
              "सीएसएमओपी अवकाश यात्रा रियायत आवेदन का कोई प्रारूप निर्धारित नहीं करता; पात्रता और ब्लॉक वर्ष "
              "केंद्रीय सिविल सेवा (अवकाश यात्रा रियायत) नियम, 1988 से आते हैं। पत्र ढाँचे पर बना।"),
        paras=[
            ("I request that I may be permitted to avail of leave travel concession of the {{ltcType}} kind for "
             "the block year {{blockYear}}, in respect of myself and the members of my family listed below.",
             "अनुरोध है कि मुझे ब्लॉक वर्ष {{blockYear}} हेतु {{ltcType}} प्रकार की अवकाश यात्रा रियायत का उपयोग "
             "करने की अनुमति दी जाए, स्वयं तथा नीचे सूचीबद्ध अपने परिवार के सदस्यों के संबंध में।"),
            ("My declared home town is {{homeTown}} and the place to be visited is {{destination}}. The journey "
             "is proposed to be performed from {{fromDate}} to {{toDate}} by {{modeOfTravel}}.",
             "मेरा घोषित गृह नगर {{homeTown}} है और जिस स्थान की यात्रा करनी है वह {{destination}} है। यात्रा "
             "{{fromDate}} से {{toDate}} तक {{modeOfTravel}} द्वारा करने का प्रस्ताव है।"),
            ("# Family members travelling", "# यात्रा करने वाले परिवार के सदस्य"),
            ("{{#each familyMembers}}", "{{#each familyMembers}}"),
            ("{{@index}}. {{.}}", "{{@index}}. {{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("{{#if advanceAmount}}", "{{#if advanceAmount}}"),
            ("An advance of Rs. {{advanceAmount}} is requested, which I undertake to adjust by submitting the "
             "claim within one month of the completion of the return journey.",
             "{{advanceAmount}} रुपये का अग्रिम अनुरोधित है, जिसे मैं वापसी यात्रा पूरी होने के एक माह के भीतर "
             "दावा प्रस्तुत करके समायोजित करने का वचन देता/देती हूँ।"),
            ("{{/if}}", "{{/if}}"),
            ("I have applied separately for leave for the period of the journey.",
             "यात्रा की अवधि के लिए मैंने अलग से अवकाश हेतु आवेदन किया है।"),
        ],
        variables=[
            var("ltcType", bl("Kind of LTC", "रियायत का प्रकार"), "select", True, ex=("home town", "गृह नगर"),
                options=[{"value": "home town", "label": bl("Home town", "गृह नगर")},
                         {"value": "any place in India", "label": bl("Any place in India", "भारत में कोई स्थान")}]),
            var("blockYear", bl("Block year", "ब्लॉक वर्ष"), "text", True, ex=("2026-2029", "2026-2029")),
            var("homeTown", bl("Declared home town", "घोषित गृह नगर"), "text", True, ex=("Varanasi", "वाराणसी")),
            var("destination", bl("Place to be visited", "यात्रा का स्थान"), "text", True, ex=("Varanasi", "वाराणसी")),
            var("fromDate", bl("Journey from", "यात्रा प्रारंभ"), "date", True, ex=("10.10.2026", "10.10.2026")),
            var("toDate", bl("Journey to", "यात्रा समाप्ति"), "date", True, ex=("20.10.2026", "20.10.2026")),
            var("modeOfTravel", bl("Mode of travel", "यात्रा का साधन"), "text", True,
                ex=("rail, in the entitled class", "रेल, पात्र श्रेणी में")),
            var("familyMembers", bl("Family members travelling", "यात्रा करने वाले परिवार के सदस्य"), "enclosures", True,
                ex=("Smt. X.Y.Z., spouse, age 38", "श्रीमती एक्स.वाई.ज़ेड., पत्नी, आयु 38"),
                hint=bl("Name, relationship and age, one per line.", "नाम, संबंध और आयु, प्रति पंक्ति एक।")),
            var("advanceAmount", bl("Advance requested", "अनुरोधित अग्रिम"), "text", False, ex=("30,000", "30,000"),
                pattern=r"^[0-9][0-9,]*$",
                pattern_hint=bl("Figures only.", "केवल अंक।")),
        ],
        extra_checks=[
            check("block-year", bl("The block year is declared", "ब्लॉक वर्ष घोषित है"),
                  bl("The concession is availed in a four-year block and the sanctioning authority checks the "
                     "block before anything else.",
                     "यह रियायत चार वर्ष के ब्लॉक में ली जाती है और स्वीकृति प्राधिकारी सबसे पहले ब्लॉक ही जाँचता है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": r"(block|ब्लॉक)"}),
        ],
    ))

    out.append(application(
        "gpf-advance",
        encl=(["A statement of my General Provident Fund account as on 31.03.2026."],
              ["31.03.2026 की स्थिति के अनुसार मेरे सामान्य भविष्य निधि खाते का विवरण।"]),
        name=("GPF advance / withdrawal application", "सामान्य भविष्य निधि अग्रिम / आहरण आवेदन"),
        short=("GPF advance", "भविष्य निधि अग्रिम"),
        use_when=("Applying for a temporary advance from, or a part-final withdrawal out of, the GPF.",
                  "सामान्य भविष्य निधि से अस्थायी अग्रिम या आंशिक अंतिम आहरण हेतु आवेदन।"),
        when=("The General Provident Fund (Central Services) Rules, 1960 allow a temporary advance, which is "
              "recovered in instalments, and a part-final withdrawal, which is not. Which of the two is being "
              "asked for, the purpose, the amount and the balance at credit are the four facts the sanctioning "
              "authority needs; an application missing any of them comes back.",
              "सामान्य भविष्य निधि (केंद्रीय सेवाएँ) नियम, 1960 अस्थायी अग्रिम की अनुमति देते हैं, जो किस्तों में "
              "वसूला जाता है, तथा आंशिक अंतिम आहरण की, जो वसूला नहीं जाता। इन दोनों में से क्या माँगा जा रहा है, "
              "प्रयोजन, राशि और जमा शेष — ये चार तथ्य स्वीकृति प्राधिकारी को चाहिए; इनमें से कोई भी छूटा आवेदन "
              "लौट आता है।"),
        subject=("Application for a temporary advance from the General Provident Fund.",
                 "सामान्य भविष्य निधि से अस्थायी अग्रिम हेतु आवेदन।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format. The entitlement, the purposes and the recovery come from the General "
              "Provident Fund (Central Services) Rules, 1960. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। पात्रता, प्रयोजन और वसूली सामान्य भविष्य निधि "
              "(केंद्रीय सेवाएँ) नियम, 1960 से आते हैं। पत्र ढाँचे पर बना।"),
        paras=[
            ("I request the sanction of a {{advanceKind}} of Rs. {{amount}} from my General Provident Fund "
             "account No. {{accountNumber}} for the purpose of {{purpose}}.",
             "अनुरोध है कि मेरे सामान्य भविष्य निधि खाता संख्या {{accountNumber}} से {{purpose}} के प्रयोजन हेतु "
             "{{amount}} रुपये का {{advanceKind}} स्वीकृत किया जाए।"),
            ("The balance at my credit as on {{balanceDate}} was Rs. {{balance}}, as per the account statement "
             "enclosed. {{previousAdvance}}",
             "संलग्न खाता विवरण के अनुसार {{balanceDate}} को मेरे खाते में {{balance}} रुपये जमा थे। "
             "{{previousAdvance}}"),
            ("{{#if instalments}}", "{{#if instalments}}"),
            ("I request that the advance may be recovered in {{instalments}} monthly instalments beginning with "
             "the pay for the month of {{recoveryFrom}}.",
             "अनुरोध है कि अग्रिम की वसूली {{recoveryFrom}} माह के वेतन से आरंभ करके {{instalments}} मासिक "
             "किस्तों में की जाए।"),
            ("{{/if}}", "{{/if}}"),
        ],
        variables=[
            var("advanceKind", bl("Advance or withdrawal", "अग्रिम या आहरण"), "select", True,
                ex=("temporary advance", "अस्थायी अग्रिम"),
                options=[{"value": "temporary advance", "label": bl("Temporary advance (recovered)", "अस्थायी अग्रिम (वसूली योग्य)")},
                         {"value": "part-final withdrawal", "label": bl("Part-final withdrawal (not recovered)", "आंशिक अंतिम आहरण (वसूली नहीं)")}]),
            var("amount", bl("Amount", "राशि"), "text", True, ex=("1,50,000", "1,50,000"),
                pattern=r"^[0-9][0-9,]*$", pattern_hint=bl("Figures only.", "केवल अंक।")),
            var("accountNumber", bl("GPF account number", "भविष्य निधि खाता संख्या"), "text", True,
                ex=("DPT/12345", "डीपीटी/12345")),
            var("purpose", bl("Purpose", "प्रयोजन"), "text", True,
                ex=("meeting the cost of higher education of my daughter",
                    "अपनी पुत्री की उच्च शिक्षा का व्यय वहन करने")),
            var("balanceDate", bl("Balance as on", "शेष किस दिनांक को"), "date", True, ex=("31.03.2026", "31.03.2026")),
            var("balance", bl("Balance at credit", "जमा शेष"), "text", True, ex=("8,42,000", "8,42,000")),
            var("previousAdvance", bl("Previous advance, if any", "पूर्व अग्रिम, यदि कोई"), "textarea", False,
                ex=("A temporary advance of Rs. 60,000 sanctioned in March 2024 has been fully recovered.",
                    "मार्च 2024 में स्वीकृत 60,000 रुपये का अस्थायी अग्रिम पूरी तरह वसूल हो चुका है।")),
            var("instalments", bl("Instalments of recovery", "वसूली की किस्तें"), "number", False, ex=("36", "36")),
            var("recoveryFrom", bl("Recovery to begin from", "वसूली किस माह से"), "text", False,
                ex=("November 2026", "नवंबर 2026")),
        ],
        extra_checks=[
            check("balance-stated", bl("The balance at credit is stated", "जमा शेष लिखा गया है"),
                  bl("The sanctioning authority checks the amount asked for against the balance. An application "
                     "without it cannot be decided at all.",
                     "स्वीकृति प्राधिकारी माँगी गई राशि की जाँच शेष के विरुद्ध करता है। उसके बिना आवेदन पर निर्णय "
                     "ही नहीं हो सकता।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(balance|credit|शेष|जमा)"}),
        ],
    ))

    out.append(application(
        "house-allotment",
        encl=(["A copy of my last pay certificate."],
              ["मेरे अंतिम वेतन प्रमाणपत्र की प्रति।"]),
        name=("House allotment application", "आवास आवंटन आवेदन"), short=("House allotment", "आवास आवंटन"),
        use_when=("Applying for allotment of General Pool residential accommodation, or for a change of type.",
                  "सामान्य पूल आवासीय आवास के आवंटन, या प्रकार परिवर्तन हेतु आवेदन।"),
        when=("Allotment out of the General Pool is by seniority in the priority date list maintained by the "
              "Directorate of Estates under the Allotment of Government Residences (General Pool in Delhi) "
              "Rules, 1963. The application is made through the office, which certifies the pay, the date of "
              "entitlement and whether any Government accommodation is already held — the last being the one "
              "that decides eligibility.",
              "सामान्य पूल से आवंटन संपदा निदेशालय द्वारा सरकारी निवास आवंटन (दिल्ली में सामान्य पूल) नियम, 1963 "
              "के अंतर्गत रखी गई प्राथमिकता तिथि सूची की वरिष्ठता के अनुसार होता है। आवेदन कार्यालय के माध्यम से "
              "किया जाता है, जो वेतन, पात्रता तिथि तथा यह प्रमाणित करता है कि कोई सरकारी आवास पहले से है या नहीं "
              "— अंतिम बात ही पात्रता तय करती है।"),
        subject=("Application for allotment of General Pool residential accommodation of Type IV.",
                 "प्रकार-IV के सामान्य पूल आवासीय आवास के आवंटन हेतु आवेदन।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format. Eligibility and the priority date come from the Allotment of "
              "Government Residences (General Pool in Delhi) Rules, 1963. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। पात्रता और प्राथमिकता तिथि सरकारी निवास आवंटन "
              "(दिल्ली में सामान्य पूल) नियम, 1963 से आती हैं। पत्र ढाँचे पर बना।"),
        addressee=(["The Deputy Director of Estates", "Directorate of Estates",
                    "Nirman Bhawan, New Delhi - 110011"],
                   ["उप संपदा निदेशक", "संपदा निदेशालय", "निर्माण भवन, नई दिल्ली - 110011"]),
        paras=[
            ("I request that I may be considered for the allotment of General Pool residential accommodation of "
             "{{houseType}}, for which I am eligible on a basic pay of Rs. {{basicPay}} in Level {{payLevel}} of "
             "the Pay Matrix.",
             "अनुरोध है कि मुझ पर {{houseType}} के सामान्य पूल आवासीय आवास के आवंटन हेतु विचार किया जाए, जिसके "
             "लिए मैं वेतन मैट्रिक्स के स्तर {{payLevel}} में {{basicPay}} रुपये के मूल वेतन पर पात्र हूँ।"),
            ("My date of entitlement to this type is {{entitlementDate}} and my present station of posting is "
             "{{station}}. {{accommodationHeld}}",
             "इस प्रकार हेतु मेरी पात्रता तिथि {{entitlementDate}} है और मेरा वर्तमान तैनाती स्थान {{station}} है। "
             "{{accommodationHeld}}"),
            ("{{#if preferredLocalities}}", "{{#if preferredLocalities}}"),
            ("My preferences, in order, are: {{preferredLocalities}}",
             "मेरी वरीयताएँ क्रम में इस प्रकार हैं : {{preferredLocalities}}"),
            ("{{/if}}", "{{/if}}"),
            ("The application is submitted through the Establishment Section of this Department, which is "
             "requested to certify the particulars above.",
             "यह आवेदन इस विभाग के स्थापना अनुभाग के माध्यम से प्रस्तुत है, जिससे अनुरोध है कि उपर्युक्त विवरण "
             "प्रमाणित करें।"),
        ],
        variables=[
            var("houseType", bl("Type applied for", "जिस प्रकार हेतु आवेदन"), "text", True, ex=("Type IV", "प्रकार-IV")),
            var("basicPay", bl("Basic pay", "मूल वेतन"), "text", True, ex=("67,700", "67,700")),
            var("payLevel", bl("Pay level", "वेतन स्तर"), "text", True, ex=("10", "10")),
            var("entitlementDate", bl("Date of entitlement", "पात्रता तिथि"), "date", True, ex=("01.07.2024", "01.07.2024")),
            var("station", bl("Station of posting", "तैनाती स्थान"), "text", True, ex=("New Delhi", "नई दिल्ली")),
            var("accommodationHeld", bl("Accommodation already held", "पहले से धारित आवास"), "textarea", True,
                ex=("I am not in occupation of any Government accommodation at present.",
                    "मैं वर्तमान में किसी सरकारी आवास में नहीं रह रहा/रही हूँ।")),
            var("preferredLocalities", bl("Preferred localities", "वरीयता वाले क्षेत्र"), "text", False,
                ex=("Kaka Nagar, Pandara Road, R.K. Puram Sector 12",
                    "काका नगर, पंडारा रोड, आर.के. पुरम सेक्टर 12")),
        ],
        extra_checks=[
            check("accommodation-declared", bl("Whether accommodation is already held is declared",
                                               "पहले से आवास धारित है या नहीं, घोषित है"),
                  bl("Eligibility turns on it, and a declaration found later to be wrong is a matter under the "
                     "CCS (Conduct) Rules, not merely a wrong allotment.",
                     "पात्रता इसी पर निर्भर है, और बाद में गलत पाई गई घोषणा केवल गलत आवंटन नहीं बल्कि केंद्रीय "
                     "सिविल सेवा (आचरण) नियमों का विषय है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(accommodation|occupation|आवास|अधिभोग)"}),
        ],
    ))

    out.append(application(
        "noc-request",
        encl=(["A copy of the application form.", "Two passport-size photographs."],
              ["आवेदन प्रपत्र की एक प्रति।", "पासपोर्ट आकार के दो फोटो।"]),
        name=("NOC request", "अनापत्ति हेतु अनुरोध"), short=("NOC request", "अनापत्ति अनुरोध"),
        use_when=("Asking your own office for a no-objection certificate — passport, outside job, loan, visa.",
                  "अपने कार्यालय से अनापत्ति प्रमाणपत्र माँगना — पासपोर्ट, बाहर की नौकरी, ऋण, वीज़ा।"),
        when=("The purpose must be stated, because the office certifies against that purpose and no other. "
              "Where the certificate is for applying to a post outside the Department, rule 20 of the CCS "
              "(Conduct) Rules, 1964 and the standing instructions on forwarding applications apply, and the "
              "application itself is forwarded rather than an NOC issued.",
              "प्रयोजन अवश्य बताया जाना चाहिए, क्योंकि कार्यालय उसी प्रयोजन के लिए प्रमाणित करता है, किसी अन्य के "
              "लिए नहीं। जहाँ प्रमाणपत्र विभाग के बाहर किसी पद हेतु आवेदन के लिए हो, वहाँ केंद्रीय सिविल सेवा "
              "(आचरण) नियम, 1964 का नियम 20 तथा आवेदन अग्रेषित करने संबंधी स्थायी अनुदेश लागू होते हैं, और "
              "अनापत्ति जारी करने के बजाय आवेदन ही अग्रेषित किया जाता है।"),
        subject=("Request for a no objection certificate for the issue of an ordinary passport.",
                 "साधारण पासपोर्ट जारी करने हेतु अनापत्ति प्रमाणपत्र के लिए अनुरोध।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format. Where the NOC is for outside employment, rule 20 of the CCS (Conduct) "
              "Rules, 1964 governs. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। जहाँ अनापत्ति बाहर के नियोजन हेतु हो, वहाँ केंद्रीय "
              "सिविल सेवा (आचरण) नियम, 1964 का नियम 20 लागू होता है। पत्र ढाँचे पर बना।"),
        paras=[
            ("I request that a no objection certificate may kindly be issued in my favour for {{purpose}}.",
             "अनुरोध है कि {{purpose}} हेतु मेरे पक्ष में अनापत्ति प्रमाणपत्र जारी किया जाए।"),
            ("My particulars are: name {{employeeName}}, designation {{employeeDesignation}}, date of joining "
             "this Department {{joiningDate}}, employee code {{employeeCode}}.",
             "मेरा विवरण इस प्रकार है : नाम {{employeeName}}, पदनाम {{employeeDesignation}}, इस विभाग में "
             "कार्यग्रहण दिनांक {{joiningDate}}, कर्मचारी कोड {{employeeCode}}।"),
            ("{{#if extraDetails}}", "{{#if extraDetails}}"),
            ("{{extraDetails}}", "{{extraDetails}}"),
            ("{{/if}}", "{{/if}}"),
            ("It is certified that no disciplinary or vigilance proceedings are pending or contemplated against "
             "me to the best of my knowledge.",
             "प्रमाणित किया जाता है कि मेरी जानकारी में मेरे विरुद्ध कोई अनुशासनिक या सतर्कता कार्यवाही न तो "
             "लंबित है और न विचाराधीन।"),
        ],
        variables=[
            var("purpose", bl("Purpose of the NOC", "अनापत्ति का प्रयोजन"), "text", True,
                ex=("applying for an ordinary passport", "साधारण पासपोर्ट हेतु आवेदन करने")),
            var("employeeName", bl("Your name", "आपका नाम"), "text", True, ex=("A.B.C.", "ए.बी.सी."),
                default_from="name"),
            var("employeeDesignation", bl("Your designation", "आपका पदनाम"), "text", True,
                ex=("Assistant Section Officer", "सहायक अनुभाग अधिकारी"), default_from="designation"),
            var("joiningDate", bl("Date of joining", "कार्यग्रहण दिनांक"), "date", True, ex=("15.07.2019", "15.07.2019")),
            var("employeeCode", bl("Employee code", "कर्मचारी कोड"), "text", True, ex=("DPT/2019/0451", "डीपीटी/2019/0451")),
            var("extraDetails", bl("Anything else the office needs", "कार्यालय को और क्या चाहिए"), "textarea", False,
                ex=("A copy of the application form and the passport-size photographs are enclosed.",
                    "आवेदन प्रपत्र की प्रति तथा पासपोर्ट आकार के फोटो संलग्न हैं।")),
        ],
        extra_checks=[
            check("purpose-stated", bl("The purpose is stated", "प्रयोजन बताया गया है"),
                  bl("The office certifies against the purpose named and no other; a request with none asks the "
                     "office to certify at large.",
                     "कार्यालय नामित प्रयोजन हेतु प्रमाणित करता है, किसी अन्य हेतु नहीं; बिना प्रयोजन का अनुरोध "
                     "कार्यालय से खुला प्रमाणन माँगता है।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(for|purpose|हेतु|प्रयोजन)"}),
        ],
    ))

    out.append(application(
        "vigilance-clearance",
        encl=(["The deputation proposal in respect of the officer."],
              ["अधिकारी के संबंध में प्रतिनियुक्ति प्रस्ताव।"]),
        name=("Vigilance clearance request", "सतर्कता निकासी अनुरोध"),
        short=("Vigilance clearance", "सतर्कता निकासी"),
        use_when=("Asking the vigilance section to confirm that nothing is pending against an officer.",
                  "सतर्कता अनुभाग से यह पुष्टि माँगना कि किसी अधिकारी के विरुद्ध कुछ लंबित नहीं है।"),
        when=("Required before empanelment, deputation, foreign posting, promotion and retirement benefits. The "
              "request must name the officer, the period to be covered and the purpose, and must ask about both "
              "limbs — disciplinary proceedings under the CCS (CCA) Rules, 1965 and any vigilance case — "
              "because clearance on one is not clearance on the other.",
              "सूचीबद्धता, प्रतिनियुक्ति, विदेश तैनाती, पदोन्नति और सेवानिवृत्ति लाभों से पूर्व अपेक्षित। अनुरोध में "
              "अधिकारी, जिस अवधि को कवर करना है और प्रयोजन नामित होने चाहिए, तथा दोनों पहलुओं के बारे में पूछा "
              "जाना चाहिए — केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 के अंतर्गत अनुशासनिक "
              "कार्यवाही और कोई सतर्कता मामला — क्योंकि एक पर निकासी दूसरे पर निकासी नहीं है।"),
        subject=("Vigilance clearance in respect of Shri A.B.C., Section Officer, for deputation.",
                 "प्रतिनियुक्ति हेतु श्री ए.बी.सी., अनुभाग अधिकारी के संबंध में सतर्कता निकासी।"),
        csmop_paras=["8.4(3)"],
        note=("CSMOP prescribes no format. What must be certified comes from the standing instructions on "
              "vigilance clearance and the CCS (CCA) Rules, 1965. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। क्या प्रमाणित करना है यह सतर्कता निकासी संबंधी स्थायी "
              "अनुदेशों तथा केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 से आता है। पत्र ढाँचे पर बना।"),
        addressee=(["The Vigilance Officer", "Department of Personnel and Training", "North Block, New Delhi"],
                   ["सतर्कता अधिकारी", "कार्मिक और प्रशिक्षण विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]),
        designation=("Under Secretary to the Govt. of India", "अवर सचिव, भारत सरकार"),
        paras=[
            ("Vigilance clearance is requested in respect of {{officerName}}, {{officerDesignation}}, for "
             "{{purpose}}, covering the period {{period}}.",
             "{{purpose}} हेतु {{officerName}}, {{officerDesignation}} के संबंध में {{period}} की अवधि के लिए "
             "सतर्कता निकासी अनुरोधित है।"),
            ("It may kindly be confirmed whether any disciplinary proceedings under the CCS (CCA) Rules, 1965 "
             "are pending or contemplated against the officer, and whether any vigilance case, complaint or "
             "investigation is pending.",
             "कृपया पुष्टि करें कि क्या अधिकारी के विरुद्ध केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, "
             "1965 के अंतर्गत कोई अनुशासनिक कार्यवाही लंबित या विचाराधीन है, तथा क्या कोई सतर्कता मामला, शिकायत "
             "या जाँच लंबित है।"),
            ("The information is required by {{replyBy}}, as the proposal has to be submitted to "
             "{{submitTo}} by that date.",
             "यह सूचना {{replyBy}} तक अपेक्षित है, क्योंकि प्रस्ताव उस तिथि तक {{submitTo}} को प्रस्तुत करना है।"),
        ],
        variables=[
            var("officerName", bl("Officer's name", "अधिकारी का नाम"), "text", True, ex=("Shri A.B.C.", "श्री ए.बी.सी.")),
            var("officerDesignation", bl("Designation", "पदनाम"), "text", True, ex=("Section Officer", "अनुभाग अधिकारी")),
            var("purpose", bl("Purpose", "प्रयोजन"), "text", True,
                ex=("deputation to the Department of Expenditure", "व्यय विभाग में प्रतिनियुक्ति")),
            var("period", bl("Period to be covered", "जिस अवधि हेतु"), "text", True,
                ex=("the last ten years", "पिछले दस वर्ष")),
            var("replyBy", bl("Information required by", "सूचना कब तक अपेक्षित"), "date", True,
                ex=("20.09.2026", "20.09.2026")),
            var("submitTo", bl("Proposal to be submitted to", "प्रस्ताव किसे प्रस्तुत करना है"), "text", True,
                ex=("the Department of Expenditure", "व्यय विभाग")),
        ],
        extra_checks=[
            check("both-limbs", bl("Both disciplinary and vigilance status are asked about",
                                   "अनुशासनिक और सतर्कता दोनों स्थितियाँ पूछी गई हैं"),
                  bl("Clearance on disciplinary proceedings is not clearance on a vigilance case; a request that "
                     "asks about one gets an answer about one.",
                     "अनुशासनिक कार्यवाही पर निकासी सतर्कता मामले पर निकासी नहीं है; जो अनुरोध एक के बारे में "
                     "पूछता है उसे एक का ही उत्तर मिलता है।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(vigilance|सतर्कता)"}),
            H.CHECK_REPLY_DATE,
        ],
    ))

    out.append(application(
        "transfer-request",
        encl=(["A copy of my spouse's posting order dated 20.06.2026."],
              ["मेरे जीवनसाथी के दिनांक 20.06.2026 के तैनाती आदेश की प्रति।"]),
        name=("Transfer request", "स्थानांतरण अनुरोध"), short=("Transfer request", "स्थानांतरण"),
        use_when=("Asking for a posting or transfer, on grounds the transfer policy actually recognises.",
                  "ऐसे आधारों पर तैनाती या स्थानांतरण माँगना जिन्हें स्थानांतरण नीति वास्तव में मान्यता देती है।"),
        when=("A request for transfer is decided against the Department's own transfer policy and the "
              "Department of Personnel and Training's instructions on the posting of employees with a disability, "
              "of women, and of those with a spouse in Government service. Naming the ground the policy "
              "recognises, and the document that proves it, is what turns a request into a case.",
              "स्थानांतरण अनुरोध का निर्णय विभाग की अपनी स्थानांतरण नीति तथा दिव्यांग कर्मचारियों, महिलाओं और "
              "जिनके जीवनसाथी सरकारी सेवा में हैं, उनकी तैनाती संबंधी कार्मिक और प्रशिक्षण विभाग के अनुदेशों के "
              "आधार पर होता है। नीति द्वारा मान्य आधार और उसे सिद्ध करने वाला दस्तावेज़ नामित करना ही अनुरोध को "
              "मामला बनाता है।"),
        subject=("Request for transfer to the Regional Office, Lucknow, on grounds of spouse posting.",
                 "जीवनसाथी की तैनाती के आधार पर क्षेत्रीय कार्यालय, लखनऊ में स्थानांतरण हेतु अनुरोध।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format. The grounds and their weight come from the Department's transfer "
              "policy and DoPT's instructions. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। आधार और उनका महत्व विभाग की स्थानांतरण नीति तथा "
              "कार्मिक और प्रशिक्षण विभाग के अनुदेशों से आते हैं। पत्र ढाँचे पर बना।"),
        paras=[
            ("I request that I may be considered for transfer to {{requestedStation}}, on the ground that "
             "{{ground}}.",
             "अनुरोध है कि मुझ पर {{requestedStation}} में स्थानांतरण हेतु विचार किया जाए, इस आधार पर कि {{ground}}।"),
            ("I have been serving at {{presentStation}} since {{sinceDate}}, that is, for {{durationYears}} "
             "years, and my present post is {{presentPost}}.",
             "मैं {{sinceDate}} से, अर्थात {{durationYears}} वर्ष से, {{presentStation}} में सेवारत हूँ, और मेरा "
             "वर्तमान पद {{presentPost}} है।"),
            ("{{#if supportingDocument}}", "{{#if supportingDocument}}"),
            ("In support, {{supportingDocument}} is enclosed.", "समर्थन में {{supportingDocument}} संलग्न है।"),
            ("{{/if}}", "{{/if}}"),
            ("I shall be grateful if the request may be considered in accordance with the transfer policy of the "
             "Department. I am willing to be relieved at the convenience of the office.",
             "आभारी रहूँगा/रहूँगी यदि अनुरोध पर विभाग की स्थानांतरण नीति के अनुसार विचार किया जाए। मैं कार्यालय की "
             "सुविधा के अनुसार कार्यमुक्त होने को तैयार हूँ।"),
        ],
        variables=[
            var("requestedStation", bl("Station requested", "अनुरोधित स्थान"), "text", True,
                ex=("the Regional Office, Lucknow", "क्षेत्रीय कार्यालय, लखनऊ")),
            var("ground", bl("Ground for the request", "अनुरोध का आधार"), "textarea", True,
                ex=("my spouse, who is also in Central Government service, has been posted at Lucknow with effect "
                    "from 01.07.2026",
                    "मेरे जीवनसाथी, जो केंद्र सरकार की सेवा में हैं, की तैनाती 01.07.2026 से लखनऊ में हुई है")),
            var("presentStation", bl("Present station", "वर्तमान स्थान"), "text", True, ex=("New Delhi", "नई दिल्ली")),
            var("sinceDate", bl("At this station since", "इस स्थान पर कब से"), "date", True, ex=("15.07.2019", "15.07.2019")),
            var("durationYears", bl("Years at this station", "इस स्थान पर कितने वर्ष"), "number", True, ex=("7", "7")),
            var("presentPost", bl("Present post", "वर्तमान पद"), "text", True,
                ex=("Assistant Section Officer, Establishment Section",
                    "सहायक अनुभाग अधिकारी, स्थापना अनुभाग")),
            var("supportingDocument", bl("Supporting document", "समर्थक दस्तावेज़"), "text", False,
                ex=("a copy of my spouse's posting order dated 20.06.2026",
                    "मेरे जीवनसाथी के दिनांक 20.06.2026 के तैनाती आदेश की प्रति")),
        ],
        extra_checks=[
            check("ground-named", bl("A ground the policy recognises is named",
                                     "नीति द्वारा मान्य आधार नामित है"),
                  bl("A request that gives no ground is decided against the general seniority position, which is "
                     "rarely what the applicant wanted.",
                     "जो अनुरोध कोई आधार नहीं देता उसका निर्णय सामान्य वरिष्ठता स्थिति के आधार पर होता है, जो "
                     "प्रायः वह नहीं होता जो आवेदक चाहता था।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(ground|on account of|because|आधार|कारण)"}),
        ],
    ))

    out.append(application(
        "grievance",
        encl=(["A copy of my claim dated 10.04.2026."],
              ["दिनांक 10.04.2026 के मेरे दावे की प्रति।"]),
        name=("Grievance / complaint", "शिकायत"), short=("Grievance", "शिकायत"),
        use_when=("Raising a grievance with the office, before or instead of a formal representation.",
                  "औपचारिक अभ्यावेदन से पहले या उसके स्थान पर कार्यालय के समक्ष शिकायत उठाना।"),
        when=("A grievance states what happened, what rule or instruction it is inconsistent with, what has "
              "already been done about it, and what redress is asked for. It is not a representation under the "
              "CCS (CCA) Rules and does not begin any appeal period; where a statutory remedy exists, it should "
              "say so and reserve the right rather than replacing it.",
              "शिकायत में यह बताया जाता है कि क्या हुआ, वह किस नियम या अनुदेश के विरुद्ध है, अब तक उस पर क्या "
              "किया गया, और क्या उपचार माँगा जा रहा है। यह केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियमों "
              "के अंतर्गत अभ्यावेदन नहीं है और इससे कोई अपील अवधि आरंभ नहीं होती; जहाँ वैधानिक उपचार उपलब्ध हो, "
              "वहाँ यह कहकर अधिकार सुरक्षित रखना चाहिए, उसे प्रतिस्थापित नहीं करना चाहिए।"),
        subject=("Grievance regarding non-payment of Children Education Allowance for 2025-26.",
                 "वर्ष 2025-26 के बाल शिक्षा भत्ते के भुगतान न होने संबंधी शिकायत।"),
        csmop_paras=["8.9(i)", "8.9(iv)"],
        note=("CSMOP 8.9 governs how a communication from an individual is acknowledged and replied to, but "
              "prescribes no format for the grievance itself. Built on the letter chassis.",
              "सीएसएमओपी 8.9 यह शासित करता है कि किसी व्यक्ति के पत्र की पावती और उत्तर कैसे दिया जाए, पर स्वयं "
              "शिकायत का कोई प्रारूप निर्धारित नहीं करता। पत्र ढाँचे पर बना।"),
        paras=[
            ("I wish to bring to notice that {{whatHappened}}.",
             "मैं यह ध्यान में लाना चाहता/चाहती हूँ कि {{whatHappened}}।"),
            ("This is not consistent with {{provision}}.", "यह {{provision}} के अनुरूप नहीं है।"),
            ("{{#if stepsTaken}}", "{{#if stepsTaken}}"),
            ("I have already {{stepsTaken}}, without result.",
             "मैं पहले ही {{stepsTaken}}, किंतु कोई परिणाम नहीं निकला।"),
            ("{{/if}}", "{{/if}}"),
            ("I request that {{redressSought}}, and that I may be informed of the action taken by {{replyBy}}.",
             "अनुरोध है कि {{redressSought}}, और की गई कार्रवाई से मुझे {{replyBy}} तक अवगत कराया जाए।"),
        ],
        variables=[
            var("whatHappened", bl("What happened", "क्या हुआ"), "textarea", True,
                ex=("my claim for Children Education Allowance for the academic year 2025-26, submitted on "
                    "10.04.2026, has not been settled although eight months have passed",
                    "शैक्षणिक वर्ष 2025-26 हेतु मेरा बाल शिक्षा भत्ता दावा, जो 10.04.2026 को प्रस्तुत किया गया था, "
                    "आठ माह बीत जाने पर भी निपटाया नहीं गया है")),
            var("provision", bl("Rule or instruction it goes against", "किस नियम या अनुदेश के विरुद्ध"), "text", True,
                ex=("the Department of Expenditure O.M. dated 16.08.2024, which prescribes settlement within "
                    "sixty days",
                    "व्यय विभाग का दिनांक 16.08.2024 का कार्यालय ज्ञापन, जो साठ दिन में निपटान निर्धारित करता है")),
            var("stepsTaken", bl("What you have already done", "आपने अब तक क्या किया"), "textarea", False,
                ex=("written to the Drawing and Disbursing Officer twice, on 20.06.2026 and 05.08.2026",
                    "आहरण एवं संवितरण अधिकारी को दो बार, 20.06.2026 और 05.08.2026 को लिखा")),
            var("redressSought", bl("Redress sought", "अपेक्षित उपचार"), "textarea", True,
                ex=("the claim may be settled and the amount credited with the pay for the current month",
                    "दावा निपटाया जाए और राशि चालू माह के वेतन के साथ जमा की जाए")),
            var("replyBy", bl("Action to be informed by", "कार्रवाई की सूचना कब तक"), "date", True,
                ex=("30.09.2026", "30.09.2026")),
        ],
        extra_checks=[
            check("redress-sought", bl("What is asked for is stated", "क्या माँगा जा रहा है वह बताया गया है"),
                  bl("A grievance that describes a wrong without saying what would put it right leaves the "
                     "office to decide what the complainant wanted.",
                     "जो शिकायत गलती का वर्णन करती है पर यह नहीं बताती कि उसे क्या सही करेगा, वह कार्यालय पर छोड़ "
                     "देती है कि शिकायतकर्ता क्या चाहता था।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(request|may be|pray|अनुरोध|प्रार्थना|जाए)"}),
        ],
    ))

    out.append(application(
        "appeal",
        encl=(["A copy of the order dated 12.08.2026 appealed against."],
              ["जिस दिनांक 12.08.2026 के आदेश के विरुद्ध अपील है उसकी प्रति।"]),
        name=("Appeal to the appellate authority", "अपीलीय प्राधिकारी को अपील"), short=("Appeal", "अपील"),
        use_when=("Appealing against an order under rule 23 of the CCS (CCA) Rules, 1965, within 45 days.",
                  "केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 के नियम 23 के अंतर्गत 45 दिन में अपील।"),
        when=("Rule 23 of the CCS (CCA) Rules, 1965 gives an appeal against a penalty and against certain other "
              "orders, and rule 25 requires it to be preferred within forty-five days of the date on which the "
              "order was delivered. Rule 24 requires the appeal to be addressed to the appellate authority, to "
              "be submitted through the authority that made the order, to contain all material statements and "
              "arguments, to be complete in itself and to be in a language that is courteous and temperate.",
              "केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 का नियम 23 शास्ति तथा कुछ अन्य आदेशों के "
              "विरुद्ध अपील देता है, और नियम 25 के अनुसार वह आदेश की प्राप्ति की तिथि से पैंतालीस दिन के भीतर की "
              "जानी चाहिए। नियम 24 के अनुसार अपील अपीलीय प्राधिकारी को संबोधित हो, आदेश करने वाले प्राधिकारी के "
              "माध्यम से प्रस्तुत हो, उसमें सभी सारवान कथन और तर्क हों, वह स्वतःपूर्ण हो और उसकी भाषा शिष्ट और "
              "संयत हो।"),
        subject=("Appeal under rule 23 of the CCS (CCA) Rules, 1965 against the order dated 12.08.2026.",
                 "दिनांक 12.08.2026 के आदेश के विरुद्ध केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 "
                 "के नियम 23 के अंतर्गत अपील।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format. Rules 23 to 27 of the CCS (CCA) Rules, 1965 govern who may appeal, "
              "to whom, within what time and what the appeal must contain. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, "
              "1965 के नियम 23 से 27 यह शासित करते हैं कि कौन, किसे, कितने समय में अपील कर सकता है और अपील में "
              "क्या होना चाहिए। पत्र ढाँचे पर बना।"),
        addressee=(["The Joint Secretary (Administration)", "Department of Personnel and Training",
                    "North Block, New Delhi", "(through the Under Secretary (Establishment))"],
                   ["संयुक्त सचिव (प्रशासन)", "कार्मिक और प्रशिक्षण विभाग", "नॉर्थ ब्लॉक, नई दिल्ली",
                    "(अवर सचिव (स्थापना) के माध्यम से)"]),
        designation=("Section Officer", "अनुभाग अधिकारी"),
        paras=[
            ("This appeal is preferred under rule 23 of the Central Civil Services (Classification, Control and "
             "Appeal) Rules, 1965 against the order No. {{orderNumber}} dated {{orderDate}}, by which "
             "{{whatWasOrdered}}. The order was delivered to me on {{deliveryDate}} and this appeal is within "
             "the forty-five days allowed by rule 25.",
             "यह अपील केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 के नियम 23 के अंतर्गत आदेश संख्या "
             "{{orderNumber}} दिनांक {{orderDate}} के विरुद्ध प्रस्तुत है, जिसके द्वारा {{whatWasOrdered}}। आदेश "
             "मुझे {{deliveryDate}} को प्राप्त हुआ और यह अपील नियम 25 द्वारा अनुमत पैंतालीस दिन के भीतर है।"),
            ("# Grounds of appeal", "# अपील के आधार"),
            ("{{#each grounds}}", "{{#each grounds}}"),
            ("{{.}}", "{{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("# Prayer", "# प्रार्थना"),
            ("It is prayed that {{prayer}}.", "प्रार्थना है कि {{prayer}}।"),
            ("The appeal is complete in itself and does not contain any disrespectful or improper language.",
             "यह अपील स्वतःपूर्ण है और इसमें कोई अनादरपूर्ण या अनुचित भाषा नहीं है।"),
        ],
        variables=[
            var("orderNumber", bl("Order appealed against — number", "जिस आदेश के विरुद्ध अपील — संख्या"), "text", True,
                ex=("A-11012/7/2026-Vig.", "ए-11012/7/2026-सतर्कता")),
            var("orderDate", bl("Order date", "आदेश दिनांक"), "date", True, ex=("12.08.2026", "12.08.2026")),
            var("deliveryDate", bl("Order delivered to me on", "आदेश मुझे कब प्राप्त हुआ"), "date", True,
                ex=("18.08.2026", "18.08.2026")),
            var("whatWasOrdered", bl("What the order did", "आदेश ने क्या किया"), "textarea", True,
                ex=("the penalty of censure was imposed upon me under rule 11(i) of the said Rules",
                    "उक्त नियमों के नियम 11(i) के अंतर्गत मुझ पर निंदा की शास्ति अधिरोपित की गई")),
            var("grounds", bl("Grounds, one per line", "आधार, प्रति पंक्ति एक"), "enclosures", True,
                ex=("The order does not record any finding on the explanation submitted by me on 05.07.2026.",
                    "आदेश में मेरे द्वारा 05.07.2026 को प्रस्तुत स्पष्टीकरण पर कोई निष्कर्ष अभिलिखित नहीं है।"),
                hint=bl("Each ground a separate point. Courteous and temperate language — rule 24.",
                        "प्रत्येक आधार एक अलग बिंदु। भाषा शिष्ट और संयत हो — नियम 24।")),
            var("prayer", bl("What you ask the appellate authority to do", "अपीलीय प्राधिकारी से क्या करने की प्रार्थना"),
                "textarea", True,
                ex=("the impugned order may be set aside and the penalty quashed",
                    "आक्षेपित आदेश अपास्त किया जाए और शास्ति निरस्त की जाए")),
        ],
        extra_checks=[
            check("within-time", bl("The date of the order and of its delivery are given",
                                    "आदेश और उसकी प्राप्ति की तिथियाँ दी गई हैं"),
                  bl("Rule 25 runs the forty-five days from the date the order was delivered. An appeal that "
                     "gives neither date invites a preliminary objection instead of an answer.",
                     "नियम 25 के अनुसार पैंतालीस दिन आदेश की प्राप्ति की तिथि से चलते हैं। जो अपील कोई तिथि नहीं "
                     "देती वह उत्तर के बजाय प्रारंभिक आपत्ति आमंत्रित करती है।"),
                  "must", {"kind": "allRequired", "fields": ["date"]}),
            check("temperate", bl("The language is courteous and temperate", "भाषा शिष्ट और संयत है"),
                  bl("Rule 24 requires an appeal to be couched in courteous and temperate language and free from "
                     "any disrespectful or improper expression.",
                     "नियम 24 के अनुसार अपील की भाषा शिष्ट और संयत हो तथा उसमें कोई अनादरपूर्ण या अनुचित अभिव्यक्ति "
                     "न हो।"),
                  "must", {"kind": "regexAbsent", "role": "body",
                           "pattern": "(malafide|mala fide|deliberately false|biased|dishonest|द्वेषपूर्ण|जानबूझकर झूठा|पक्षपाती|बेईमान)"}),
        ],
    ))

    out.append(application(
        "charges-reply",
        encl=(["A copy of the memorandum of charges dated 12.08.2026."],
              ["दिनांक 12.08.2026 के आरोप ज्ञापन की प्रति।"]),
        name=("Reply to a memorandum of charges", "आरोप ज्ञापन का उत्तर"),
        short=("Charges reply", "आरोप उत्तर"),
        use_when=("Answering articles of charge under rule 14 or rule 16 of the CCS (CCA) Rules, 1965.",
                  "केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 के नियम 14 या 16 के अंतर्गत आरोपों का उत्तर।"),
        when=("This is the REPLY side only. Rule 14 governs a major-penalty proceeding and rule 16 a minor-penalty "
              "one; in both the charged officer submits a written statement of defence within the time allowed, "
              "admitting or denying each article of charge separately, and saying whether an oral inquiry is "
              "desired. Answering the articles as a whole rather than one by one is the commonest defect, and it "
              "leaves an unanswered article to be treated as admitted.",
              "यह केवल उत्तर पक्ष है। नियम 14 बड़ी शास्ति की कार्यवाही को और नियम 16 लघु शास्ति की कार्यवाही को "
              "शासित करता है; दोनों में आरोपित अधिकारी अनुमत समय के भीतर लिखित बचाव कथन प्रस्तुत करता है, प्रत्येक "
              "आरोप को अलग-अलग स्वीकार या अस्वीकार करता है, और यह बताता है कि मौखिक जाँच वांछित है या नहीं। "
              "आरोपों का एक साथ उत्तर देना, एक-एक करके नहीं, सबसे सामान्य दोष है, और इससे अनुत्तरित आरोप स्वीकृत "
              "मान लिया जाता है।"),
        subject=("Written statement of defence in respect of the memorandum of charges dated 12.08.2026.",
                 "दिनांक 12.08.2026 के आरोप ज्ञापन के संबंध में लिखित बचाव कथन।"),
        csmop_paras=["8.4(1)"],
        note=("CSMOP prescribes no format. Rules 14 and 16 of the CCS (CCA) Rules, 1965 govern the proceeding "
              "and the time allowed. Built on the letter chassis. This template covers the REPLY only — this "
              "app does not draft a charge memorandum.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता। केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, "
              "1965 के नियम 14 और 16 कार्यवाही और अनुमत समय को शासित करते हैं। पत्र ढाँचे पर बना। यह टेम्पलेट "
              "केवल उत्तर के लिए है — यह ऐप आरोप ज्ञापन का मसौदा नहीं बनाता।"),
        addressee=(["The Disciplinary Authority", "Department of Personnel and Training", "North Block, New Delhi"],
                   ["अनुशासनिक प्राधिकारी", "कार्मिक और प्रशिक्षण विभाग", "नॉर्थ ब्लॉक, नई दिल्ली"]),
        designation=("Section Officer", "अनुभाग अधिकारी"),
        paras=[
            ("This written statement of defence is submitted in reply to the memorandum of charges No. "
             "{{memoNumber}} dated {{memoDate}}, served on me on {{servedDate}}, under rule {{ccaRule}} of the "
             "Central Civil Services (Classification, Control and Appeal) Rules, 1965.",
             "यह लिखित बचाव कथन केंद्रीय सिविल सेवा (वर्गीकरण, नियंत्रण और अपील) नियम, 1965 के नियम {{ccaRule}} के "
             "अंतर्गत आरोप ज्ञापन संख्या {{memoNumber}} दिनांक {{memoDate}}, जो मुझे {{servedDate}} को तामील हुआ, "
             "के उत्तर में प्रस्तुत है।"),
            ("# Reply to each article of charge", "# प्रत्येक आरोप का उत्तर"),
            ("{{#each articleReplies}}", "{{#each articleReplies}}"),
            ("{{.}}", "{{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("{{#if documentsSought}}", "{{#if documentsSought}}"),
            ("For the purpose of my defence I request that the following documents may be made available to me: "
             "{{documentsSought}}",
             "अपने बचाव के प्रयोजन हेतु अनुरोध है कि निम्नलिखित दस्तावेज़ मुझे उपलब्ध कराए जाएँ : {{documentsSought}}"),
            ("{{/if}}", "{{/if}}"),
            ("I {{inquiryWanted}} an oral inquiry in the matter. The statement is submitted with respect, and I "
             "pray that the charges may be dropped.",
             "मैं इस विषय में मौखिक जाँच {{inquiryWanted}}। यह कथन सादर प्रस्तुत है, और मेरी प्रार्थना है कि आरोप "
             "वापस ले लिए जाएँ।"),
        ],
        variables=[
            var("memoNumber", bl("Memorandum number", "ज्ञापन संख्या"), "text", True,
                ex=("A-11012/7/2026-Vig.", "ए-11012/7/2026-सतर्कता")),
            var("memoDate", bl("Memorandum dated", "ज्ञापन का दिनांक"), "date", True, ex=("12.08.2026", "12.08.2026")),
            var("servedDate", bl("Served on me on", "मुझे कब तामील हुआ"), "date", True, ex=("18.08.2026", "18.08.2026")),
            var("ccaRule", bl("Under which rule", "किस नियम के अंतर्गत"), "select", True, ex=("16", "16"),
                options=[{"value": "14", "label": bl("Rule 14 (major penalty)", "नियम 14 (बड़ी शास्ति)")},
                         {"value": "16", "label": bl("Rule 16 (minor penalty)", "नियम 16 (लघु शास्ति)")}]),
            var("articleReplies", bl("Reply to each article, one per line", "प्रत्येक आरोप का उत्तर, प्रति पंक्ति एक"),
                "enclosures", True,
                ex=("Article I is denied. The file in question was returned to the Section on 04.07.2026, as the "
                    "movement register at page 41 shows.",
                    "आरोप I अस्वीकार है। प्रश्नगत फाइल 04.07.2026 को अनुभाग को लौटा दी गई थी, जैसा कि पृष्ठ 41 पर "
                    "गतिविधि रजिस्टर से प्रकट है।"),
                hint=bl("One line per article, in the order the memorandum lists them. An article not answered is "
                        "treated as admitted.",
                        "प्रति आरोप एक पंक्ति, उसी क्रम में जिसमें ज्ञापन ने उन्हें दिया है। जिस आरोप का उत्तर न दिया "
                        "जाए वह स्वीकृत माना जाता है।")),
            var("documentsSought", bl("Documents sought for the defence", "बचाव हेतु वांछित दस्तावेज़"), "textarea", False,
                ex=("the file movement register of the Section for the period 01.07.2026 to 31.07.2026",
                    "अनुभाग का 01.07.2026 से 31.07.2026 की अवधि का फाइल गतिविधि रजिस्टर")),
            var("inquiryWanted", bl("Oral inquiry", "मौखिक जाँच"), "select", True, ex=("desire", "चाहता/चाहती हूँ"),
                options=[{"value": "desire", "label": bl("I desire an oral inquiry", "मैं मौखिक जाँच चाहता/चाहती हूँ")},
                         {"value": "do not desire", "label": bl("I do not desire an oral inquiry", "मैं मौखिक जाँच नहीं चाहता/चाहती")}]),
        ],
        extra_checks=[
            check("article-by-article", bl("Each article of charge is answered separately",
                                           "प्रत्येक आरोप का अलग-अलग उत्तर दिया गया है"),
                  bl("An article of charge that is not specifically denied is treated as admitted. Answering the "
                     "memorandum as a whole is the commonest and costliest defect in a defence statement.",
                     "जिस आरोप को विशेष रूप से अस्वीकार न किया जाए वह स्वीकृत माना जाता है। ज्ञापन का एक साथ उत्तर "
                     "देना बचाव कथन का सबसे सामान्य और सबसे महँगा दोष है।"),
                  "must", {"kind": "regex", "role": "body",
                           "pattern": "(Article|charge|आरोप)"}),
            check("inquiry-choice", bl("Whether an oral inquiry is desired is stated",
                                       "मौखिक जाँच वांछित है या नहीं, बताया गया है"),
                  bl("The disciplinary authority has to record this; leaving it out means the decision is taken "
                     "without knowing what the charged officer wanted.",
                     "अनुशासनिक प्राधिकारी को यह अभिलिखित करना होता है; इसे छोड़ना अर्थात यह निर्णय बिना यह जाने "
                     "लेना कि आरोपित अधिकारी क्या चाहता था।"),
                  "must", {"kind": "regex", "role": "body", "pattern": "(inquiry|enquiry|जाँच)"}),
        ],
    ))

    out.append(application(
        "rti-application",
        encl=(["Indian Postal Order No. 45F 123456 for Rs. 10."],
              ["10 रुपये का भारतीय पोस्टल आर्डर संख्या 45F 123456।"]),
        name=("RTI application (as a citizen)", "आरटीआई आवेदन (नागरिक के रूप में)"),
        short=("RTI application", "आरटीआई आवेदन"),
        use_when=("Asking a public authority for information under section 6 of the RTI Act, 2005.",
                  "सूचना का अधिकार अधिनियम, 2005 की धारा 6 के अंतर्गत किसी लोक प्राधिकरण से सूचना माँगना।"),
        when=("Section 6(1) of the Right to Information Act, 2005 requires a request in writing to the Central "
              "Public Information Officer, with the prescribed fee of ten rupees. Section 6(2) says the applicant "
              "SHALL NOT be required to give any reason for the request or any personal details beyond those "
              "needed to contact them — so an application that explains why the information is wanted has given "
              "away something it did not have to. Numbering the points asked for is what makes a point-wise "
              "reply possible, and what makes a missing answer visible on a first appeal.",
              "सूचना का अधिकार अधिनियम, 2005 की धारा 6(1) के अनुसार केंद्रीय लोक सूचना अधिकारी को दस रुपये के "
              "निर्धारित शुल्क सहित लिखित अनुरोध किया जाना चाहिए। धारा 6(2) कहती है कि आवेदक से अनुरोध का कोई "
              "कारण या संपर्क हेतु आवश्यक विवरण से अधिक कोई व्यक्तिगत विवरण नहीं माँगा जाएगा — अतः जो आवेदन यह "
              "बताता है कि सूचना क्यों चाहिए, उसने वह दे दिया जो देना आवश्यक नहीं था। माँगे गए बिंदुओं को "
              "क्रमांकित करना ही बिंदुवार उत्तर संभव बनाता है, और प्रथम अपील में छूटा उत्तर दिखाई देता है।"),
        subject=("Request for information under section 6 of the Right to Information Act, 2005.",
                 "सूचना का अधिकार अधिनियम, 2005 की धारा 6 के अंतर्गत सूचना हेतु अनुरोध।"),
        csmop_paras=["12.5"],
        note=("CSMOP prescribes no format; the fee, the thirty-day limit and section 6(2)'s bar on asking for "
              "reasons all come from the Right to Information Act, 2005. Built on the letter chassis.",
              "सीएसएमओपी कोई प्रारूप निर्धारित नहीं करता; शुल्क, तीस दिन की सीमा और कारण पूछने पर धारा 6(2) की "
              "रोक — ये सभी सूचना का अधिकार अधिनियम, 2005 से आते हैं। पत्र ढाँचे पर बना।"),
        addressee=(["The Central Public Information Officer", "Department of Personnel and Training",
                    "North Block, New Delhi - 110001"],
                   ["केंद्रीय लोक सूचना अधिकारी", "कार्मिक और प्रशिक्षण विभाग", "नॉर्थ ब्लॉक, नई दिल्ली - 110001"]),
        designation=("Applicant", "आवेदक"),
        paras=[
            ("I request the following information under section 6 of the Right to Information Act, 2005, relating "
             "to {{aboutWhat}} for the period {{period}}.",
             "मैं सूचना का अधिकार अधिनियम, 2005 की धारा 6 के अंतर्गत {{period}} की अवधि हेतु {{aboutWhat}} से "
             "संबंधित निम्नलिखित सूचना का अनुरोध करता/करती हूँ।"),
            ("{{#each points}}", "{{#each points}}"),
            ("{{@index}}. {{.}}", "{{@index}}. {{.}}"),
            ("{{/each}}", "{{/each}}"),
            ("The prescribed fee of Rs. 10 has been paid by {{feeMode}}. I am a citizen of India.",
             "10 रुपये का निर्धारित शुल्क {{feeMode}} द्वारा दिया गया है। मैं भारत का नागरिक हूँ।"),
            ("The information may kindly be sent to the address given above. If any part of this request is held "
             "to relate to another public authority, it may be transferred under section 6(3) within five days "
             "and I may be informed.",
             "कृपया सूचना उपर्युक्त पते पर भेजी जाए। यदि इस अनुरोध का कोई भाग किसी अन्य लोक प्राधिकरण से संबंधित "
             "माना जाए तो उसे धारा 6(3) के अंतर्गत पाँच दिन में अंतरित किया जाए और मुझे सूचित किया जाए।"),
        ],
        variables=[
            var("aboutWhat", bl("What the information is about", "सूचना किस बारे में है"), "text", True,
                ex=("the filling of the posts of Assistant Section Officer by promotion",
                    "पदोन्नति द्वारा सहायक अनुभाग अधिकारी के पदों को भरे जाने")),
            var("period", bl("Period", "अवधि"), "text", True,
                ex=("1 April 2024 to 31 March 2026", "1 अप्रैल 2024 से 31 मार्च 2026")),
            var("points", bl("Points, one per line", "बिंदु, प्रति पंक्ति एक"), "enclosures", True,
                ex=("The number of posts of Assistant Section Officer filled by promotion in each of the two "
                    "years, year-wise.",
                    "दोनों वर्षों में से प्रत्येक में पदोन्नति द्वारा भरे गए सहायक अनुभाग अधिकारी पदों की संख्या, "
                    "वर्षवार।"),
                hint=bl("Number each point. A numbered point that is not answered is visible on first appeal; a "
                        "paragraph of prose is not.",
                        "प्रत्येक बिंदु को क्रमांकित करें। जिस क्रमांकित बिंदु का उत्तर न मिले वह प्रथम अपील में "
                        "दिखता है; गद्य का अनुच्छेद नहीं दिखता।")),
            var("feeMode", bl("How the fee was paid", "शुल्क कैसे दिया गया"), "text", True,
                ex=("an Indian Postal Order of Rs. 10 bearing number 45F 123456, enclosed",
                    "10 रुपये का भारतीय पोस्टल आर्डर संख्या 45F 123456, संलग्न")),
        ],
        extra_checks=[
            check("no-reasons", bl("No reason for wanting the information is given",
                                   "सूचना क्यों चाहिए, इसका कोई कारण नहीं दिया गया"),
                  bl("Section 6(2) says an applicant shall not be required to give any reason for the request. "
                     "Giving one anyway hands the public authority something it may not ask for.",
                     "धारा 6(2) कहती है कि आवेदक से अनुरोध का कोई कारण नहीं माँगा जाएगा। फिर भी कारण देना लोक "
                     "प्राधिकरण को वह दे देता है जो वह माँग ही नहीं सकता।"),
                  "should", {"kind": "regexAbsent", "role": "body",
                             "pattern": "(the reason for|because I|I need this|since I|इसका कारण यह|क्योंकि मुझे)"}),
            check("fee", bl("The fee is accounted for", "शुल्क का उल्लेख है"),
                  bl("A request under section 6(1) is accompanied by the prescribed fee; without it the clock "
                     "does not start.",
                     "धारा 6(1) के अंतर्गत अनुरोध के साथ निर्धारित शुल्क होता है; उसके बिना समय की गणना आरंभ ही "
                     "नहीं होती।"),
                  "must", {"kind": "regex", "role": "body", "pattern": r"(fee|शुल्क)"}),
        ],
    ))

    return out
