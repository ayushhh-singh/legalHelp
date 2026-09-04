/**
 * Eight letters, as they arrive.
 *
 * The session brief names these eight shapes and they are here rather than
 * inline in a test for the reason `tests/fixtures/law-search.ts` and
 * `tests/fixtures/retrieval.ts` are files of their own: the Playwright spec
 * pastes the same bytes the unit test asserts against, and a fixture that
 * exists twice is a fixture whose two halves can drift.
 *
 * Every one is invented. No real file number, no real officer, no real case —
 * the numbers follow the shape of the DoPT and DoE orders this app already
 * cites (`A-11011/…-Estt.`, `12/2/2026-JCA`) so the extractor is exercised
 * against realistic punctuation, and nothing in them refers to a real person or
 * a real proceeding. That is a requirement here rather than a courtesy: a
 * fixture is committed, and this repository holds public data only.
 */

const ENGLISH_OM = `F.No. A-11011/4/2026-Estt.(Allowances)
Government of India
Ministry of Personnel, Public Grievances and Pensions
Department of Personnel and Training

North Block, New Delhi
Dated the 12th August, 2026

OFFICE MEMORANDUM

Subject: Grant of Children Education Allowance to Central Government employees — clarification regarding.

To
The Under Secretary (Administration)
Ministry of Road Transport and Highways
Transport Bhawan, New Delhi

The undersigned is directed to refer to the subject mentioned above and to state that references have been received in this Department seeking clarification on the admissibility of Children Education Allowance where the child is studying in a school outside the station of posting.

2. The position has been examined in consultation with the Department of Expenditure. The existing instructions on the subject are self-contained and no relaxation is under consideration.

3. In order to enable this Department to complete the review, the number of cases pending in your Ministry on this account may kindly be furnished.

(R. K. Sharma)
Under Secretary to the Government of India
Tel: 011-2309 XXXX
`

const HINDI_OM = `परम अग्रता

संख्या 12/3/2026-स्थापना
भारत सरकार
कार्मिक, लोक शिकायत तथा पेंशन मंत्रालय
कार्मिक और प्रशिक्षण विभाग

नई दिल्ली
दिनांक 30 जुलाई, 2026

कार्यालय ज्ञापन

विषय: अर्जित अवकाश के नकदीकरण के संबंध में स्पष्टीकरण।

सेवा में
अवर सचिव (प्रशासन)
सड़क परिवहन और राजमार्ग मंत्रालय
परिवहन भवन, नई दिल्ली

अधोहस्ताक्षरी को उपर्युक्त विषय पर यह कहने का निदेश हुआ है कि इस विभाग को अर्जित अवकाश के नकदीकरण के संबंध में अनेक संदर्भ प्राप्त हुए हैं।

2. कृपया इस संबंध में आपके मंत्रालय में लंबित मामलों की संख्या इस विभाग को प्रेषित करें।

(र. क. शर्मा)
भारत सरकार के अवर सचिव
`

const NO_NUMBER = `Government of India
Ministry of Home Affairs

New Delhi
Dated: 01.09.2026

Subject: Request for transfer to the Northern Region — regarding.

Sir,

I am to state that I have been posted at the present station for over four years. It is requested that my case for transfer to the Northern Region may kindly be considered on the ground of the medical condition of a dependent family member.

Yours faithfully,
(S. Iyer)
Assistant Section Officer
`

const TWO_DATES = `Diary No. 4417 dated 27.08.2026
Received on 27.08.2026

F.No. 12/2/2026-JCA-2
Government of India
Ministry of Personnel, Public Grievances and Pensions

New Delhi
Dated the 20.08.2026

OFFICE MEMORANDUM

Subject: Observance of the restricted holiday calendar for the year 2027 — regarding.

To
The Head of Office
All attached and subordinate offices

The undersigned is directed to say that the list of restricted holidays for 2027 is under preparation. It is requested that the local requirements of your office may kindly be intimated to this Department.

(P. Menon)
Deputy Secretary
`

const CITES_IPC = `F.No. B-13014/2/2026-Vig.
Government of India
Ministry of Railways

New Delhi
Dated: 05.09.2026

Subject: Departmental proceedings — advice on the applicable penal provision, regarding.

To
The Deputy Secretary (Vigilance)
Ministry of Personnel, Public Grievances and Pensions

Sir,

Reference is invited to the complaint forwarded by this Ministry. The complaint alleges an offence under section 420 of the Indian Penal Code, 1860 said to have been committed in March 2024, and also refers to rule 3 of the CCS (Conduct) Rules, 1964.

2. The advice of your Department on the provision now to be cited may kindly be furnished.

Yours faithfully,
(A. Bose)
Under Secretary
`

const THREE_ASKS = `F.No. 19/4/2026-Coord.
Government of India
Ministry of Finance
Department of Expenditure

New Delhi
Dated the 02.09.2026

OFFICE MEMORANDUM

Subject: Annual review of expenditure on office contingencies — information called for.

To
The Under Secretary (Budget)
All Ministries and Departments

The undersigned is directed to say that the annual review of expenditure on office contingencies for the financial year 2025-26 is being undertaken.

2. It is requested that the statement at Annexure I may be completed and returned to this Department by 30.09.2026.

3. You are requested to nominate a nodal officer of the level of Under Secretary for this purpose.

4. Kindly confirm that the reconciliation with the Pay and Accounts Office has been completed.

(N. Raghavan)
Director
`

const FORWARDED = `F.No. B-12013/1/2026-Vig.
Government of India
Ministry of Road Transport and Highways

New Delhi
Dated: 18.08.2026

OFFICE MEMORANDUM

Subject: Children Education Allowance — reference from the Department of Personnel and Training, forwarded.

To
The Section Officer (Establishment)
National Highways Wing

The undersigned is directed to forward herewith a copy of the O.M. received from the Department of Personnel and Training with reference to their letter No. A-11011/4/2026-Estt.(Allowances) dated 12.08.2026 on the subject mentioned above.

2. The information called for therein may kindly be furnished to this Ministry by 05.09.2026 so that a consolidated reply can be sent.

(K. Venkatesh)
Under Secretary
`

const WITH_ENCLOSURES = `F.No. 7/2/2026-Admn.
Government of India
Ministry of Education

New Delhi
Dated: 22.08.2026

OFFICE MEMORANDUM

Subject: Proposal for creation of two posts in the Statistics Division — regarding.

To
The Deputy Secretary (Integrated Finance Division)

The undersigned is directed to forward the proposal for creation of two posts in the Statistics Division for the concurrence of the Integrated Finance Division.

2. The comments of the Division may kindly be furnished at an early date.

Encl.: as above (3)
1. Statement of justification
2. Note on the existing sanctioned strength
3. Copy of the earlier sanction dated 04.03.2024

(M. Fernandes)
Under Secretary
`

export const INTAKE_LETTERS = {
  englishOm: ENGLISH_OM,
  hindiOm: HINDI_OM,
  noNumber: NO_NUMBER,
  twoDates: TWO_DATES,
  citesIpc: CITES_IPC,
  threeAsks: THREE_ASKS,
  forwarded: FORWARDED,
  withEnclosures: WITH_ENCLOSURES,
} as const

export type IntakeLetterId = keyof typeof INTAKE_LETTERS
