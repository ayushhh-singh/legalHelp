# CSMOP 2022 — the format of every Central Secretariat document

Read this before editing anything under `data/drafting/`.

**Source.** The Central Secretariat Manual of Office Procedure, sixteenth edition, 2022, published by the
Department of Administrative Reforms and Public Grievances. Fetched by hand, once, from
`https://www.darpg.gov.in/static/uploads/2025/10/774e0b8f427b7875158363d842fa431f.pdf` (English, 219 pages,
sha256 `d335bdef…`) and `…/8b5d6eb6c7c47bc69e271e25f1c2cc43.pdf` (Hindi, 284 pages, sha256 `03049005…`). It is
not on any cron: a manual is revised by a new edition about once every three years, and a new edition is a
reading job, not a fetch (ADR-020).

**Everything below is a paraphrase.** Paragraph and page numbers are to the printed pages of the sixteenth
edition, which run 16 behind the PDF page (printed 1 = PDF 17). Nothing here is quoted at length; where a
phrase matters it is because the manual prescribes that phrase.

**A note on the Hindi.** The Hindi issue's text layer is unusable — it was typeset from a legacy font and its
glyph map yields `अभधकायी` where the page renders `अधिकारी`. Every Hindi string in `data/drafting/` that is
attributed to CSMOP was read off a **rendering** of the page, not copied out of the text stream
(`docs/DATA-GAPS.md` #36). And the manual's own Hindi is the authority, not the expected translation: it
prints **परम अग्रता** for Top Priority (6.13), not `सर्वोच्च अग्रता`, and **अर्ध-सरकारी पत्र** for a demi-official
letter (8.4(2)), not `अर्ध-शासकीय पत्र`. Both of the expected forms are carried in `alsoHi` because an officer
will meet them; neither is what this app prints.

---

## 1. The ten forms of written communication (8.4, pages 79–81)

CSMOP 8.4 lists the forms a Department uses for correspondence with organisations outside the Government of
India and for certain specific purposes. Their specimens are at **Appendix 8.1, pages 87–96**.

| Form                          | Para        | Used for                                                                                                                                                                            | Person                       | Salutation             | Subscription        |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------- | ------------------- |
| Letter                        | 8.4(1)      | State Governments, UPSC and other constitutional bodies, heads of attached and subordinate offices, public enterprises, statutory authorities, public bodies, members of the public | First (`I am directed…`)     | `Sir / Madam,`         | `Yours faithfully,` |
| Demi-official letter          | 8.4(2), 9.5 | One officer to another, to draw personal attention to a matter of importance or urgency                                                                                             | First, personal and friendly | `My dear / Dear Shri…` | `Yours sincerely,`  |
| Office Memorandum             | 8.4(3)      | Decisions to other Departments including attached and subordinate offices; calling for or supplying information; writing to one's own employees; between sections within a Ministry | **Third**                    | **None**               | **None**            |
| Office Order                  | 8.4(4)      | Routine internal administrative matters — leave, distribution of work, internal postings and transfers                                                                              | Third                        | None                   | None                |
| Order                         | 8.4(5)      | Financial sanctions; final orders in disciplinary cases. Addressed to nobody                                                                                                        | Third                        | None                   | None                |
| Notification                  | 8.4(6)      | Promulgation of statutory rules and orders, appointments and promotions of certain categories, through the Gazette                                                                  | Third                        | None                   | None                |
| Resolution                    | 8.4(7)      | Public announcement of a decision on an important matter of policy; published in the Gazette                                                                                        | Third                        | None                   | None                |
| Press Communiqué / Press Note | 8.4(8)      | Wide publicity through the media. A communiqué is published as given; a note may be edited by the outlet                                                                            | Third                        | None                   | None                |
| Endorsement                   | 8.4(9)      | Returning a paper in original, or sending a paper or its copy elsewhere for information or action                                                                                   | Third                        | None                   | None                |
| Minutes                       | 8.4(10)     | Record of a meeting: date, time, venue, who chaired, participants, conclusions, and who acts on each                                                                                | Third                        | None                   | None                |

Two rules from this list are the ones officers are most often marked down on.

- **An Office Memorandum is never sent to a constitutional or statutory authority.** Communications to the
  Election Commission, TRAI, SEBI and the like go in the **letter** form, addressed to the Principal Secretary
  or Secretary. `8.8, Table 8.1(5)`.
- **An endorsement is not used to copy something to a State Government** or to a statutory or constitutional
  body. The form for that is a letter. `8.4(9)`.

`8.8 Table 8.1` also settles the channel for particular authorities: the Lok Sabha and Rajya Sabha
Secretariats are addressed to their Secretaries and never to the Speaker or Chairman; the Attorney General is
approached only through the Ministry of Law and Justice; the C&AG only by and through the Ministry of Finance,
except on audit paragraphs; the UPSC by letter to its Secretary.

---

## 2. Where each part of a document goes (Appendix 8.1, pages 87–96)

### 2.1 Letter (page 87)

```
No. ………
                       Government of India
                       Department of ………
                                              New Delhi, the ……… 20..
To
    <addressee, by designation>
Subject:
Sir / Madam,
        With reference to your letter No. …… dated …… on the subject cited
        above, I am directed …
2.      …
                                              Yours faithfully,
                                              -Sd/-
                                              (A.B.C.)
                                              Under Secretary to the Govt. of India
                                              Tele. No.:
                                              email:
(Endorsement) No. ………
Copy forwarded for information / necessary action to:
(1)
(2)
```

- **Number** top left; **Government of India / Ministry / Department** centred beneath it; **place and date**
  on the right.
- **To** and the addressee, then **Subject**, then the salutation, then the body.
- **Signature block** on the right: `-Sd/-`, the name in brackets, the designation, telephone and email.
- The **endorsement** (copy-to) follows the signature under its own number, and the signature block is
  repeated below it.
- The specimen gives three interchangeable openings: `With reference to your letter No. … dated …`,
  `In continuation of my/this Department's letter No. …`, and
  `With reference to the correspondence resting with your letter No. …`.

Hindi (page 121 of the Hindi issue): `संख्या`, `भारत सरकार`, `विभाग`, `नई दिल्ली, दिनांक …`, `सेवा में,`, `विषय :`,
`महोदय/महोदया,`, `… के संदर्भ में, मुझे निर्देशित किया गया है …`, `भवदीय,`, `-हस्ताक्षरित/`,
`अवर सचिव, भारत सरकार`, `दूरभाष संख्या`, `ई-मेल`, `(पृष्ठांकन) संख्या`,
`प्रति सूचना/आवश्यक कार्रवाई के लिए अग्रेषित :`.

### 2.2 Demi-official letter (page 88; drafting rules at 9.5, page 104)

- The **writer's name, designation and telephone** sit at the **top left** — it is personal stationery.
- `D.O. No. ……` on the right, then Government of India / Department, then place and date.
- Salutation `My dear Shri …`; the body in the **first person, active voice**; `With regards,` then
  `Yours sincerely,` and the signature **by name only**.
- **The addressee's name, designation and address go at the foot**, below the signature — not at the top.
- **9.5(i)**: write `I notice`, not `It is noticed`; `I seek your cooperation in the matter of …`, not
  `It is expedient …`.
- **9.5(ii)**: preferably **not more than one page**. A longer message is condensed into a few short
  paragraphs and the detailed argument moved to appendices. A draft D.O. is faired by the **personal staff**
  of the officer who signs it.
- **9.5(iii)**: the colour code and the use of the National Emblem on D.O. stationery follow the Ministry of
  Home Affairs' instructions.
- **8.4(2)(a)**: addressed to an officer of the same level as far as possible; where no officer of that level
  is available at the receiving end, one or at most two levels below.

Hindi (page 122): `अर्ध-सरकारी पत्र`, `अर्ध-सरकारी पत्र संख्या`, `प्रिय श्री…`, `शुभकामनाओं सहित,`, `भवदीय,`.
The Hindi specimen closes `भवदीय` for both `Yours faithfully` and `Yours sincerely`; `सादर` is the usual
friendlier alternative and is carried as an alias.

### 2.3 Office Memorandum (page 89)

```
No.
                       Government of India
                       Department of ………
                                              New Delhi, the …… 20…
                       OFFICE MEMORANDUM
Subject :
        The undersigned is directed to refer to this/their Department O.M.
        No. …… dated ……
2.      Doubts have been expressed whether … It is hereby clarified that …
                                              (A.B.C.)
                                              Under Secretary to the Govt. of India
                                              Tele. No./email:
To
The Department of ………
```

Four things about this specimen are easy to get wrong and are encoded in
`data/drafting/templates/office-memorandum.json`:

1. **`OFFICE MEMORANDUM` is a centred title** below the date line, not a subject prefix.
2. **The addressee comes after the signature**, at the foot of the page.
3. **The first paragraph carries no number**; numbering starts at `2.`
4. **8.4(3)** requires the name, designation, e-mail ID, telephone number and fax number of the signing
   officer — and **no salutation and no subscription**, because it is in the third person.

Hindi (page 123): `कार्यालय ज्ञापन`, `विषय :`,
`अधोहस्ताक्षरी को इस/उनके विभाग के तारीख……… के कार्यालय ज्ञापन संख्या …… का संदर्भ लेने का निदेश हुआ है।`,
`अवर सचिव, भारत सरकार`, `दूरभाष संख्या/ईमेलः`, `प्रतिलिपि`.

### 2.4 Office Order (page 90) and Order (page 91)

Same head as an Office Memorandum, with `OFFICE ORDER` or `ORDER` as the centred title. Neither carries a
salutation or a subscription. Both end with `Copy to:` / `Copy forwarded to:` and a numbered list — for the
leave specimen: the office order file, the cashier, the Section concerned, and the officer.

The Order specimen is a financial sanction: _Sanction of the President is accorded under rule 10 of the
Delegation of Financial Powers Rules to write off …_. An Order is **not addressed to anyone**.

Hindi (pages 124–125): `कार्यालय आदेश`, `आदेश`, `हस्ताक्षर/`, `प्रतिलिपि :-`, `प्रतिलिपि अग्रेषितः`.

### 2.5 Inter-Departmental note — the former U.O. note (page 92; rules at 8.1, pages 75–77)

- **No number at the head.** Government of India / Department, then `Subject :`, then the body.
- **Every paragraph is numbered, from 1** — unlike a letter or an O.M.
- The point on which advice is sought goes in the **concluding paragraph**: _This Department will be grateful
  for the advice of the Department of Legal Affairs on the issue raised in para 4 above_.
- Signature: name, designation, telephone/email. Then the **Department consulted**, by name of the officer and
  building.
- **The I.D. number and date go at the foot**, below a rule: `Department of …… I.D. No. …… dated ……`.

From 8.1.2, the rules that make one valid:

- **(i)** prescribe a time limit when calling for advice or concurrence;
- **(v)** the reference is made with the approval of an officer **not below Joint Secretary**, under the
  signature of an officer **not below Under Secretary**;
- **(vi)** state the points on which advice is sought, preferably in the concluding paragraph;
- **(vii)** place the drafts of the orders proposed to be issued along with the note;
- **(viii)** where more than one Department must be consulted, consult them **simultaneously** by
  self-contained notes, unless a large number of documents would have to be copied, or the second
  consultation only makes sense once the first has replied.

Hindi (page 126): `अंतर-विभागीय टिप्पणी`, `विषय :`, `आई.डी. सं.`, `तारीख`. The older name `अशासकीय टिप्पणी` is
what most sections still use and is carried as an alias.

### 2.6 Notification (page 93)

- Opens with the **Gazette line**: `(To be published in the Gazette of India Part I, Section 2)`. Appendix 8.2
  (pages 97–100) sets out the composition of the Gazette and what belongs in each Part and Section.
- Head, then the centred title `NOTIFICATION`, then the text — which **begins with the notification number**
  rather than carrying it above.
- Signed by a Joint Secretary in the specimen; addressed to **The Manager, Government of India Press**, with
  `Copy forwarded for information to:` and a roman-numbered list.
- **9.3(i)**: orders and instruments made in the name of the President are expressed to be so made and signed
  by an officer of or above the rank of Under Secretary, or one specifically authorised under the
  Authentication (Orders and Other Instruments) Rules, 2002.
- **9.3(ii)**: where a statute confers the power on the Government of India, the order is expressed to be made
  **in the name of the Government of India**, not in the President's name.

Hindi (page 127): `अधिसूचना`, `(भारत के राजपत्र भाग I, खंड 2 में प्रकाशित होने के लिए)`, `संयुक्त सचिव`,
`भारत सरकार मुद्रणालय`, `प्रतिलिपि सूचनार्थ प्रेषितः`.

### 2.7 Endorsement (page 96)

Head, then the single line _A copy each of the papers mentioned below is forwarded for information and
necessary action_, then the signature, then **`List of papers forwarded`** as a numbered list, then `To`.

Hindi (page 130): `पृष्ठांकन`,
`नीचे उल्लिखित प्रत्येक कागजात की एक प्रति सूचना एवं आवश्यक कार्रवाई के लिए अग्रेषित की जाती है।`,
`अग्रेषित कागजातों की सूची`, `प्रतिलिपि`.

### 2.8 Resolution (page 94) and Press Communiqué / Note (page 95)

Not built as templates in this session (`docs/DATA-GAPS.md` #37). A Resolution is published in the Gazette
Part I Section 1, signed by the Secretary, and is followed by an `ORDER` clause directing that a copy be
communicated and that the Resolution be published. A Press Communiqué is forwarded to the Principal
Information Officer, Press Information Bureau, and may carry an embargo line —
_Not to be published or broadcast before … a.m./p.m. on ……_

---

## 3. Drafting a communication (Chapter 9, pages 101–109)

### 3.1 When a draft is needed (9.1)

- **9.1(i)** No draft in simple, straightforward or repetitive cases for which standard forms exist; those go
  up as fair copies for signature.
- **9.1(ii)** A draft is put up with the notes where the case is complex, or the line of action is not clear,
  or there is more than one option.
- **9.1(iii)** The competent authority may sign the fair communication itself, or authorise issue under the
  signature of an officer **not below Under Secretary**. Every draft put up for approval is marked
  **`Draft` at top centre**.
- **9.1(v)** Where a draft with policy, financial or vigilance implications was **changed by senior officers**
  on its way up — grammatical corrections apart — the earlier draft forms part of the correspondence portion.

### 3.2 General instructions (9.2) — the checklist the templates encode

| Sub-para | Rule                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (i)      | Clear, concise and unambiguous language                                                                                                                                                                                                   |
| (ii)     | No lengthy sentences, abruptness, redundancy, circumlocution, superlatives or repetition. An unavoidably long communication ends with a summary of the action expected                                                                    |
| (iii)    | A communication conveying the views or orders of the Government of India **must be expressed to have been written under the directions of Government** — this is what `The undersigned is directed…` and `I am directed…` are for         |
| (iv)     | Always quote the **number and date of the last communication in the series**; a series of them goes in the margin                                                                                                                         |
| (v)      | When asking for information, **name the date**: `may be sent by 28-02-2019`, not `may be sent immediately`                                                                                                                                |
| (vi)     | Every draft bears the **file number**. Two communications issued from the same file to the same addressee on the same date are distinguished by a serial inserted before the year — `A-11011/5(i)/2019-Estt.`, `A-11011/5(ii)/2019-Estt.` |
| (vii)    | The draft **specifies its enclosures**, and the count goes at the **bottom left**: `Encl. 3`                                                                                                                                              |
| (viii)   | Where copies of an enclosure are already available and are not to be photocopied, say so in the margin                                                                                                                                    |
| (ix)     | The Section Officer marks on the draft whether an important communication or a valuable document goes by registered post, speed post, or insured cover                                                                                    |
| (x)      | Drafts are prepared **in double space**, for editing                                                                                                                                                                                      |
| (xi)     | **Urgency grading is marked by or under the orders of an officer not lower than a Section Officer**                                                                                                                                       |
| (xii)    | The **name, designation, telephone number, fax number and e-mail address** of the signing officer must invariably be on the draft; the addressee's telephone and fax help too                                                             |
| (xiii)   | The draft is flagged **`DFA`**; several drafts are `DFA I`, `DFA II`, `DFA III`                                                                                                                                                           |

**9.4** — no communication other than a classified one or a demi-official letter is addressed to an officer
by name unless the matter needs that officer's personal attention. Where it does, address the head of the
organisation and write `Attention: Km XYZ, Deputy Secretary (Pol)` **above the subject**.

**9.6, Table 9.1** — who does what: the Dealing Officer fairs the draft and attaches the enclosures, with the
Section Officer as the secondary; the **personal staff** of the signing officer fairs and issues a
demi-official letter; the Dealing Officer keeps the office copy and does the docketing and referencing.
`Appendix 9.1` is the Section Dispatch Register, whose columns record whether each issue went out **in Hindi,
in English, or bilingually** — the Section Officer scrutinises it weekly.

**8.11** — the Official Languages Act, 1963 and the Department of Official Language's instructions are to be
scrupulously implemented. In eFile there are options to use Hindi, English or both.

---

## 4. Noting (Chapter 7, pages 61–73)

### 4.1 What a note is (7.1)

Remarks recorded on a case to facilitate its disposal: a precis of previous papers, an analysis of the issues
requiring decision, the financial, legal or other implications, suggestions with justifications, and the final
decision along with the authority competent to take it.

### 4.2 Conventions (7.2)

- **(i)** All notes on the note sheet — the green sheet.
- **(iii)** Concise and to the point. **No verbatim reproduction** of the PUC or the FR; summarise instead.
- **(v)** An officer confines a note to the actual points being made, without repeating ground already
  covered. Agreement with the preceding note is expressed by **merely appending a signature**; a different
  decision is recorded **with reasons**.
- **(vii)** Place the relevant extracts of the Act or rules **on the file** and draw attention to them, rather
  than reproducing the provisions in the note.
- **(viii)** A **self-contained note** goes up with every case submitted to the Secretary or the Minister,
  unless a running summary of facts is on the file or the last note serves that purpose.
- **(ix)** A self-contained note is also what goes to another Department, with the approval of an officer not
  below Joint Secretary.
- **(x)** Where a paper raises several major points, each is noted upon separately in **sectional notes**,
  each beginning with the points it deals with, placed below the main note in a separate folder.
- **(xi)** Errors and contrary opinions are countered in **courteous and temperate language, free from
  personal remarks**.
- **(xiii)** Black or blue ink.
- **(xiv)** **A note is divided into serially numbered paragraphs**; in a problem-solving or policy case the
  paragraphs may carry brief titles.
- **(xv)** Handwritten notes are to be avoided; anything half a page or more is printed, on both sides.
- **(xvi)** A margin of about an inch on all four sides.

### 4.3 Who signs where (7.3, 7.4)

- **7.3(xi)** The Dealing Officer affixes a **full signature with the complete date (dd/mm/yyyy) on the left**
  below the note.
- **7.4(iv)** The **Section Officer and above sign on the right** with the date, if they agree with the note;
  otherwise they record their own.
- **7.3(xii)** At least **a quarter of a page** is left below the last note, especially when the file goes to
  the Secretary or the Minister.
- **7.3(vi)–(x)** state the issues and the points requiring decision; draw attention to the statutory or
  customary procedure and the relevant provisions; draw attention to precedents; suggest the course of action
  **with justification and alternatives**; and **indicate the authority competent to decide**, with the
  delegation of powers.

### 4.4 How much to write — the functional approach (7.14, Table 7.1)

| Kind of case            | Quantum of noting                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Ephemeral               | **No noting.** The Section Officer records briefly why no action is needed and files it at the dak stage; kept in the File 'O' bundle and destroyed on 31 December                                                                                                                               |
| Correspondence handling | A brief note of **three or four sentences**                                                                                                                                                                                                                                                      |
| Repetitive              | A **standard process sheet** — a skeleton note of pre-determined points of check, filled in per case. **No conventional note at all** (specimen at Appendix 7.1)                                                                                                                                 |
| Problem solving         | A structured note: what is the problem, how did it arise, what do the Act, rules, policy or precedent provide, what are the possible solutions, which is best and why, what are its consequences, is an inter-Departmental consultation needed and with whom, and who is the competent authority |
| Policy / planning       | A detailed note built up systematically — problem, additional information, and so on                                                                                                                                                                                                             |

### 4.5 Level of disposal and channel of submission (7.6)

Each Department prescribes the level of final disposal and the channel of submission for each category of
case, publishes the channel on its website, and **reviews it at least once in three years**, keeping the
levels to a minimum. **Channels of submission should not exceed four.** Where a level is jumped, the case
passes back through every level jumped over on its return. Files for the Minister-in-charge may be initiated
at Deputy Secretary or Director level.

### 4.6 What may never happen (7.13)

**A note is never pasted over or removed from a file.** A mistake or a disagreement is dealt with by
recording a fresh note and leaving the earlier one where it is. Replacing or modifying a note that has already
been noted upon by others is not permitted, and where a decision already communicated turns out to rest on a
wrong fact or a misreading of the rules, the revised decision is taken with the approval of an officer
**higher** than the one who took the original, with the reasons recorded.

### 4.7 Referencing and docketing (6.7, 6.8, pages 42–44)

- **6.7(i)** Every page of each part of the file — notes, correspondence, appendix to notes, appendix to
  correspondence — is numbered consecutively in **separate series**, in pen, at the top right.
- **6.7(ii)** Each item of correspondence is assigned a number, shown prominently **in red ink at the top
  middle** of its first page.
- **6.7(iii)** The paper under consideration is flagged **`PUC`** and the latest fresh receipt noted upon
  **`FR`**; more than one becomes `FR I`, `FR II`. Other papers are flagged `A`, `B`, and so on. **The
  relevant page numbers are always quoted in the margin** — flags come off, page numbers do not.
- **6.7(v)** Quote the number of the file referred to in the body of the note, and the page numbers with the
  alphabetical slip in the margin. For an Act or rule, quote the brief title with the section, rule or
  paragraph number.
- **6.8** **Docketing** is the entry, in the notes portion, of the serial number assigned to each item of
  correspondence. Where the Branch Officer or a higher officer has written on the receipt, that remark is
  **reproduced before the note is recorded**.

### 4.8 Arrangement of papers (Box 6.1, pages 42–43)

Top downwards: Acts, rules and reference books; the notes portion ending with the note for consideration; the
**draft for approval**; the correspondence portion ending with the latest receipt or issue; appendices to
notes and correspondence; the standing guard file, precedent book or reference folder; other papers referred
to, latest on top; recorded files, latest on top; and routine notes and papers in a separate cover.

---

## 5. Urgency grading (6.13, page 48)

Three labels, and no more:

| English          | Hindi (CSMOP 2022) | When                                                                  |
| ---------------- | ------------------ | --------------------------------------------------------------------- |
| **Immediate**    | **तत्काल**         | Only cases requiring prompt attention                                 |
| **Priority**     | **अग्रता**         | Cases meriting disposal in precedence to others of an ordinary nature |
| **Top Priority** | **परम अग्रता**     | Extremely urgent cases                                                |

- Lok Sabha and Rajya Sabha questions, motions and Bills go in their **own file cover**; no other urgency
  grading is then needed. In eFile the label for these is **VIP**. `6.13(ii), Box-e.6.10`.
- The grading **is reviewed at every stage** of the case's progress and revised where necessary — particularly
  before the case goes to another Department. `6.13(iii)`.
- The grading is marked **by or under the orders of an officer not lower in rank than a Section Officer**.
  `9.2(xi)`.

`सर्वोच्च अग्रता` is the rendering of Top Priority that most people expect. It is **not** what CSMOP 2022
prints; `data/drafting/structure-terms.json` carries it in `alsoHi` so that a search for it finds the term,
and `tests/drafting-data.test.ts` asserts both halves of that.

---

## 6. Timeliness (8.9, 12.5)

- **8.9(i)** A communication from a Member of Parliament, a member of the public, a recognised association or
  a public body is **acknowledged within 15 days** and replied to **within the next 15 days**.
- **8.9(ii)** Where a final reply will be delayed, or information must be obtained from elsewhere, an
  **interim reply** goes within 15 days of receipt, naming the date by which a final reply will come.
- **8.9(iii)** A communication wrongly addressed is transferred within **5 working days**, and the party is
  told.
- **8.9(iv)** Where a request cannot be acceded to, the reasons are given **courteously**.
- **8.10** Time limits for replies are ordinarily specified; on expiry, orders are taken on whether to allow
  more time or to proceed without the reply.
- **12.5** Requests under the Right to Information Act, 2005 are monitored for timely disposal. The 30-day
  limit and the duty to name the First Appellate Authority come from the Act itself, not from the manual.

---

## 7. What this maps to in the repository

| CSMOP                                                                            | Where it lives                                                                                            |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 8.4 forms, Appendix 8.1 specimens                                                | `data/drafting/templates/*.json` — one `DocTemplate` per form, with `csmopRef.paras` naming the paragraph |
| 8.4 and Appendix 8.1 Hindi                                                       | `data/drafting/structure-terms.json` — the Hindi issue's own words, read off the rendered page            |
| 9.2 general instructions, 7.2 noting conventions                                 | the `checklist` on each template, one rule per requirement, evaluated by `src/lib/drafting/checklist.ts`  |
| Appendix 8.1 openings, 9.5 active voice, 7.14 note structure                     | `data/drafting/phrases.json`                                                                              |
| 6.13 urgency grading                                                             | the `urgency` select on every template that allows one                                                    |
| First paragraph unnumbered (8.1 specimens) vs numbered from 1 (I.D. note, notes) | `numberFrom` on the body block; `src/lib/drafting/engine.ts` counts                                       |
| 9.2(vii) enclosure count                                                         | the engine appends `Encl.: as above (n)` to any block that lists enclosures                               |

Seven of the fourteen templates are forms the manual prescribes **no** format for — circular, leave
application, representation, RTI reply, show-cause reply, tour programme, T.A. bill covering letter. Each
carries `verify: true` and a `csmopRef.chassis` naming the form whose format it borrows, and
`tests/drafting-data.test.ts` fails a template that claims to be unverified without saying whose chassis it
uses. That distinction — _CSMOP says this_ against _this is how it is done_ — is the one an officer must never
have to guess at.
