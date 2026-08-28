import { lookupOldSection } from './resolve'
import type { Bilingual, LawCode, LawCorpus, LawIndexEntry, LawSection, OldActId } from './types'

/**
 * The "What's new" explainer, as a list of POINTERS rather than as prose.
 *
 * Every bullet on `/law/whats-new` names a provision, and the heading, the
 * text, the classification and the source URL are all read back out of
 * `data/law/*.json` at render time. Nothing on that page restates the law in
 * this file's own words: the only thing written here is `why` — one bilingual
 * sentence saying why the reader should care — and the section it hangs on.
 *
 * That is the whole design. A page of hand-written summaries of 1,059 sections
 * would rot the first time the weekly ingest corrected a heading, and there
 * would be no test that could tell. Instead `whatsNew.test.ts` asserts every
 * pointer below resolves against the committed datasets, so a section that
 * moved fails the build rather than rendering a bullet with nothing behind it.
 */

export type WhatsNewGroup =
  /** Offences the BNS created that the IPC did not have. */
  | 'new-offences'
  /** Numbers that moved, including the ones that swapped with each other. */
  | 'renumbering'
  /** Provisions the new Act dropped outright. */
  | 'dropped'
  /** BNSS timelines and procedural duties with a clock attached. */
  | 'procedure'
  /** BSA and electronic records. */
  | 'evidence'

/** A point about a section of one of the three new Acts. */
export interface SectionPoint {
  kind: 'section'
  id: string
  group: WhatsNewGroup
  code: LawCode
  section: string
  /** The sub-section the point is really about, when it is one: `"103(2)"`. */
  clause?: string
  why: Bilingual
}

/** A point about a repealed provision with no counterpart in the new Act. */
export interface DroppedPoint {
  kind: 'dropped'
  id: string
  group: 'dropped'
  oldAct: OldActId
  section: string
  why: Bilingual
}

export type WhatsNewPoint = SectionPoint | DroppedPoint

export const WHATS_NEW: readonly WhatsNewPoint[] = [
  /* ---------------- New offences ---------------- */
  {
    kind: 'section',
    id: 'organised-crime',
    group: 'new-offences',
    code: 'bns',
    section: '111',
    why: {
      en: 'Organised crime is now an offence in the general penal law. Until 1 July 2024 it existed only in State legislation such as MCOCA, so a case outside those States had to be built from the ordinary offences.',
      hi: 'संगठित अपराध अब सामान्य दंड विधि में ही अपराध है। 1 जुलाई 2024 तक यह केवल मकोका जैसे राज्य अधिनियमों में था, इसलिए उन राज्यों के बाहर मामला साधारण अपराधों से ही बनाना पड़ता था।',
    },
  },
  {
    kind: 'section',
    id: 'petty-organised-crime',
    group: 'new-offences',
    code: 'bns',
    section: '112',
    why: {
      en: 'A separate, lesser offence for organised gangs committing theft, snatching and similar acts — the tier below section 111, and new.',
      hi: 'चोरी, झपटमारी आदि करने वाले संगठित गिरोहों के लिए पृथक्, लघुतर अपराध — धारा 111 से नीचे का स्तर, और नया।',
    },
  },
  {
    kind: 'section',
    id: 'terrorist-act',
    group: 'new-offences',
    code: 'bns',
    section: '113',
    why: {
      en: 'A terrorist act is now punishable under the general penal law as well as under the UAPA. Which of the two is invoked is a decision the investigating agency must record.',
      hi: 'आतंकवादी कृत्य अब यूएपीए के साथ-साथ सामान्य दंड विधि के अधीन भी दंडनीय है। इनमें से कौन-सा लगाया जाए, यह निर्णय अन्वेषण अभिकरण को अभिलिखित करना होता है।',
    },
  },
  {
    kind: 'section',
    id: 'mob-lynching',
    group: 'new-offences',
    code: 'bns',
    section: '103',
    clause: '103(2)',
    why: {
      en: 'Murder by a group of five or more on the ground of race, caste, community, sex, place of birth, language or personal belief is now its own sub-section. The IPC had no such provision; cases were charged under section 302 with section 149.',
      hi: 'जाति, समुदाय, लिंग, जन्मस्थान, भाषा या व्यक्तिगत विश्वास के आधार पर पाँच या अधिक व्यक्तियों के समूह द्वारा की गई हत्या अब स्वतंत्र उपधारा है। भादंसं में ऐसा उपबंध नहीं था; ऐसे मामले धारा 302 सहपठित धारा 149 में चलाए जाते थे।',
    },
  },
  {
    kind: 'section',
    id: 'snatching',
    group: 'new-offences',
    code: 'bns',
    section: '304',
    why: {
      en: 'Snatching is a named offence for the first time. It was previously charged as theft, or as robbery where force was used, and the two carry very different punishments.',
      hi: 'झपटमारी पहली बार नामित अपराध है। पहले इसे चोरी के रूप में, अथवा बल प्रयोग होने पर लूट के रूप में आरोपित किया जाता था, और दोनों के दंड में बड़ा अंतर है।',
    },
  },
  {
    kind: 'section',
    id: 'deceitful-means',
    group: 'new-offences',
    code: 'bns',
    section: '69',
    why: {
      en: 'Sexual intercourse obtained by a false promise of marriage, employment or promotion, or by concealing identity, is now a distinct offence rather than a question of whether consent under section 375 was vitiated.',
      hi: 'विवाह, रोजगार या पदोन्नति के मिथ्या वचन से, अथवा पहचान छिपाकर प्राप्त मैथुन अब पृथक् अपराध है, न कि धारा 375 के अधीन सम्मति दूषित हुई या नहीं — इस प्रश्न का विषय।',
    },
  },
  {
    kind: 'section',
    id: 'community-service',
    group: 'new-offences',
    code: 'bns',
    section: '4',
    why: {
      en: 'Community service joins the list of punishments. It is available for six petty offences, and it is the first addition to the punishment ladder since 1860.',
      hi: 'सामुदायिक सेवा दंडों की सूची में सम्मिलित हुई है। यह छह लघु अपराधों के लिए उपलब्ध है, और 1860 के बाद दंड-क्रम में पहला संवर्धन है।',
    },
  },

  /* ---------------- Renumbering ---------------- */
  {
    kind: 'section',
    id: 'murder-103',
    group: 'renumbering',
    code: 'bns',
    section: '103',
    why: {
      en: 'Murder moved from IPC 302 to BNS 103 — and BNS 302 exists, as a religious-feelings offence carrying up to one year. Saying "302" now points at the wrong provision.',
      hi: 'हत्या भादंसं 302 से बीएनएस 103 में आ गई — और बीएनएस 302 विद्यमान है, जो एक वर्ष तक के दंड वाला धार्मिक भावना संबंधी अपराध है। अब "302" कहना गलत उपबंध की ओर संकेत करता है।',
    },
  },
  {
    kind: 'section',
    id: 'cheating-318',
    group: 'renumbering',
    code: 'bns',
    section: '318',
    clause: '318(4)',
    why: {
      en: 'IPC 415, 417, 418 and 420 are consolidated into BNS 318. "420" is section 318(4). Citing 318 alone does not say which sub-section, and they differ on cognizability, bail and punishment.',
      hi: 'भादंसं की धाराएँ 415, 417, 418 और 420 बीएनएस 318 में समाहित हैं। "420" धारा 318(4) है। केवल 318 उद्धृत करने से उपधारा स्पष्ट नहीं होती, और उनमें संज्ञेयता, जमानत तथा दंड भिन्न हैं।',
    },
  },
  {
    kind: 'section',
    id: 'rape-64',
    group: 'renumbering',
    code: 'bns',
    section: '64',
    why: {
      en: 'Punishment for rape is BNS 64; the definition is BNS 63. The IPC kept both in section 375 and section 376, so the habit of citing "376" now needs two numbers.',
      hi: 'बलात्संग का दंड बीएनएस 64 है; परिभाषा बीएनएस 63 है। भादंसं में दोनों धारा 375 एवं 376 में थे, इसलिए "376" उद्धृत करने की आदत के लिए अब दो संख्याएँ चाहिए।',
    },
  },
  {
    kind: 'section',
    id: 'cruelty-85',
    group: 'renumbering',
    code: 'bns',
    section: '85',
    why: {
      en: 'Cruelty by a husband or his relatives — "498A" — is BNS 85, with the explanation of cruelty now standing separately as BNS 86.',
      hi: 'पति या उसके नातेदारों द्वारा क्रूरता — "498क" — बीएनएस 85 है, और क्रूरता की व्याख्या अब पृथक् रूप से बीएनएस 86 है।',
    },
  },
  {
    kind: 'section',
    id: 'fir-173',
    group: 'renumbering',
    code: 'bnss',
    section: '173',
    why: {
      en: 'The FIR provision moves from CrPC 154 to BNSS 173, and now expressly allows information to be given irrespective of where the offence was committed — the zero FIR, in the Sanhita itself rather than in an executive instruction.',
      hi: 'प्रथम सूचना का उपबंध दंप्रसं 154 से बीएनएसएस 173 में आया है, और अब स्पष्टतः यह अनुज्ञात करता है कि सूचना अपराध के स्थान की परवाह किए बिना दी जा सकती है — अर्थात् जीरो एफआईआर, अब कार्यपालक अनुदेश में नहीं, संहिता में ही।',
    },
  },
  {
    kind: 'section',
    id: 'anticipatory-bail-482',
    group: 'renumbering',
    code: 'bnss',
    section: '482',
    why: {
      en: 'Anticipatory bail was CrPC 438 and is BNSS 482 — and CrPC 482, the High Court’s inherent powers, is now BNSS 528. The two numbers swapped places, which is the single most dangerous renumbering in the BNSS.',
      hi: 'अग्रिम जमानत दंप्रसं 438 थी और अब बीएनएसएस 482 है — तथा दंप्रसं 482, अर्थात् उच्च न्यायालय की अंतर्निहित शक्तियाँ, अब बीएनएसएस 528 है। दोनों संख्याओं ने स्थान बदल लिए हैं, जो बीएनएसएस का सबसे भ्रामक पुनर्संख्यांकन है।',
    },
  },
  {
    kind: 'section',
    id: 'inherent-powers-528',
    group: 'renumbering',
    code: 'bnss',
    section: '528',
    why: {
      en: 'The High Court’s inherent powers — "482" for fifty years — are BNSS 528. A petition still headed "under section 482" now reads as an anticipatory bail application.',
      hi: 'उच्च न्यायालय की अंतर्निहित शक्तियाँ — पचास वर्षों से "482" — अब बीएनएसएस 528 हैं। "धारा 482 के अधीन" शीर्षक वाली याचिका अब अग्रिम जमानत आवेदन प्रतीत होती है।',
    },
  },

  /* ---------------- Dropped ---------------- */
  {
    kind: 'dropped',
    id: 'sedition-124a',
    group: 'dropped',
    oldAct: 'IPC',
    section: '124A',
    why: {
      en: 'Sedition is gone. BNS 152 punishes acts endangering the sovereignty, unity and integrity of India and is worded differently — it turns on secession, armed rebellion and subversive activities. It is not a renumbering of 124A, and 124A case law does not carry over automatically.',
      hi: 'राजद्रोह समाप्त है। बीएनएस 152 भारत की प्रभुता, एकता एवं अखंडता को संकटापन्न करने वाले कृत्यों को दंडित करती है और उसकी शब्दावली भिन्न है — वह पृथक्करण, सशस्त्र विद्रोह तथा विध्वंसक क्रियाकलापों पर आधारित है। यह 124क का पुनर्संख्यांकन नहीं है, और 124क की न्यायिक व्याख्या स्वतः लागू नहीं होती।',
    },
  },
  {
    kind: 'dropped',
    id: 'attempt-suicide-309',
    group: 'dropped',
    oldAct: 'IPC',
    section: '309',
    why: {
      en: 'Attempt to commit suicide has no counterpart in the BNS. Abetment of suicide survives as BNS 108; the attempt itself is no longer an offence under the general penal law.',
      hi: 'आत्महत्या का प्रयास बीएनएस में नहीं है। आत्महत्या का दुष्प्रेरण बीएनएस 108 के रूप में बना हुआ है; प्रयास स्वयं अब सामान्य दंड विधि के अधीन अपराध नहीं है।',
    },
  },
  {
    kind: 'dropped',
    id: 'adultery-497',
    group: 'dropped',
    oldAct: 'IPC',
    section: '497',
    why: {
      en: 'Adultery has no counterpart in the BNS, following its being struck down in 2018. Nothing replaces it.',
      hi: 'जारकर्म का बीएनएस में कोई तत्संगत उपबंध नहीं है, जो 2018 में इसके अपास्त किए जाने के अनुरूप है। इसके स्थान पर कुछ नहीं है।',
    },
  },
  {
    kind: 'dropped',
    id: 'unnatural-offences-377',
    group: 'dropped',
    oldAct: 'IPC',
    section: '377',
    why: {
      en: 'IPC 377 has no counterpart in the BNS at all — including the part left standing after the 2018 judgment. What that means for non-consensual acts between adult men is an open question the Sanhita does not answer.',
      hi: 'भादंसं 377 का बीएनएस में कोई तत्संगत उपबंध नहीं है — 2018 के निर्णय के पश्चात् शेष रहा भाग भी नहीं। वयस्क पुरुषों के बीच सम्मति-रहित कृत्यों पर इसका क्या प्रभाव है, यह प्रश्न संहिता अनुत्तरित छोड़ती है।',
    },
  },

  /* ---------------- Procedure and timelines ---------------- */
  {
    kind: 'section',
    id: 'detention-187',
    group: 'procedure',
    code: 'bnss',
    section: '187',
    why: {
      en: 'The outer limits on detention during investigation — ninety days for an offence punishable with death, life or ten years or more, sixty days otherwise — are BNSS 187(3), the provision the CrPC carried at 167.',
      hi: 'अन्वेषण के दौरान निरोध की बाह्य सीमाएँ — मृत्यु, आजीवन कारावास या दस वर्ष या अधिक से दंडनीय अपराध के लिए नब्बे दिन, अन्यथा साठ दिन — बीएनएसएस 187(3) में हैं, जो दंप्रसं में धारा 167 थी।',
    },
  },
  {
    kind: 'section',
    id: 'chargesheet-193',
    group: 'procedure',
    code: 'bnss',
    section: '193',
    why: {
      en: 'The charge sheet provision now carries duties with a clock on them: investigation into the listed sexual offences within two months, and the informant or victim to be told the progress of the investigation within ninety days.',
      hi: 'आरोप-पत्र संबंधी उपबंध अब समयबद्ध कर्तव्य रखता है: सूचीबद्ध लैंगिक अपराधों का अन्वेषण दो मास में, तथा सूचनाकर्ता या पीड़ित को अन्वेषण की प्रगति नब्बे दिन में बताई जाए।',
    },
  },
  {
    kind: 'section',
    id: 'documents-230',
    group: 'procedure',
    code: 'bnss',
    section: '230',
    why: {
      en: 'Copies of the police report and the documents must reach the accused — and now the victim — within fourteen days of production or appearance. The CrPC set no outer limit.',
      hi: 'पुलिस रिपोर्ट एवं दस्तावेजों की प्रतियाँ अभियुक्त को — और अब पीड़ित को भी — उपस्थिति या पेशी से चौदह दिन के भीतर मिलनी चाहिए। दंप्रसं में कोई बाह्य सीमा नहीं थी।',
    },
  },
  {
    kind: 'section',
    id: 'judgment-258',
    group: 'procedure',
    code: 'bnss',
    section: '258',
    why: {
      en: 'Judgment must be delivered within thirty days of the close of arguments, extendable to forty-five for reasons recorded. There was no such limit in the CrPC.',
      hi: 'निर्णय तर्कों की समाप्ति से तीस दिन के भीतर सुनाया जाना है, जो अभिलिखित कारणों से पैंतालीस दिन तक बढ़ाया जा सकता है। दंप्रसं में ऐसी कोई सीमा नहीं थी।',
    },
  },
  {
    kind: 'section',
    id: 'search-recording-105',
    group: 'procedure',
    code: 'bnss',
    section: '105',
    why: {
      en: 'Search and seizure must be recorded by audio-video electronic means — the Sanhita says "preferably mobile phone" — and the recording forwarded to the Magistrate without delay. This is new, and it applies to every search under the chapter.',
      hi: 'तलाशी एवं अभिग्रहण की श्रव्य-दृश्य इलेक्ट्रॉनिक माध्यम से रिकॉर्डिंग अनिवार्य है — संहिता कहती है "अधिमानतः चल दूरभाष" — और वह रिकॉर्डिंग बिना विलंब मजिस्ट्रेट को भेजी जानी है। यह नया है और अध्याय की प्रत्येक तलाशी पर लागू होता है।',
    },
  },
  {
    kind: 'section',
    id: 'trial-in-absentia-356',
    group: 'procedure',
    code: 'bnss',
    section: '356',
    why: {
      en: 'A proclaimed offender who has absconded can now be tried and sentenced in absentia, ninety days after the charge is framed. There was no equivalent in the CrPC.',
      hi: 'फरार उद्घोषित अपराधी का विचारण एवं दंडादेश अब आरोप विरचित होने के नब्बे दिन पश्चात् उसकी अनुपस्थिति में हो सकता है। दंप्रसं में इसका समतुल्य उपबंध नहीं था।',
    },
  },
  {
    kind: 'section',
    id: 'electronic-mode-530',
    group: 'procedure',
    code: 'bnss',
    section: '530',
    why: {
      en: 'Summons, evidence, trials and appeals may all be held in electronic mode. This is the provision that makes video proceedings the Sanhita’s own rule rather than a High Court practice direction.',
      hi: 'समन, साक्ष्य, विचारण तथा अपील — सभी इलेक्ट्रॉनिक माध्यम से हो सकते हैं। यही वह उपबंध है जो वीडियो कार्यवाही को उच्च न्यायालय के अभ्यास-निर्देश के स्थान पर स्वयं संहिता का नियम बनाता है।',
    },
  },

  /* ---------------- Evidence ---------------- */
  {
    kind: 'section',
    id: 'electronic-records-63',
    group: 'evidence',
    code: 'bsa',
    section: '63',
    why: {
      en: 'The certificate provision every officer knows as "65B" is BSA 63. The certificate is still required, and the schedule to the BSA now prescribes its form.',
      hi: 'जिस प्रमाणपत्र-उपबंध को हर अधिकारी "65बी" के नाम से जानता है, वह भा.सा.अ. 63 है। प्रमाणपत्र अब भी अपेक्षित है, और भा.सा.अ. की अनुसूची अब उसका प्ररूप विहित करती है।',
    },
  },
  {
    kind: 'section',
    id: 'electronic-record-61',
    group: 'evidence',
    code: 'bsa',
    section: '61',
    why: {
      en: 'A new section stating that an electronic record has the same legal effect as paper, and may not be denied admissibility on the ground that it is electronic. The Indian Evidence Act had no such declaration.',
      hi: 'नई धारा, जो कहती है कि इलेक्ट्रॉनिक अभिलेख का वही विधिक प्रभाव है जो कागज का है, और उसे इलेक्ट्रॉनिक होने के आधार पर ग्राह्यता से वंचित नहीं किया जा सकता। भारतीय साक्ष्य अधिनियम में ऐसी घोषणा नहीं थी।',
    },
  },
  {
    kind: 'section',
    id: 'primary-evidence-57',
    group: 'evidence',
    code: 'bsa',
    section: '57',
    why: {
      en: 'Primary evidence now expressly includes an electronic record produced from proper custody, and each of several files created together. The category was written for documents on paper and has been rewritten for storage devices.',
      hi: 'प्राथमिक साक्ष्य में अब स्पष्टतः उचित अभिरक्षा से प्रस्तुत इलेक्ट्रॉनिक अभिलेख, तथा एक साथ बनी अनेक फाइलों में से प्रत्येक सम्मिलित है। यह वर्ग कागजी दस्तावेजों के लिए लिखा गया था और अब भंडारण उपकरणों के लिए पुनर्लिखित है।',
    },
  },
]

export const WHATS_NEW_GROUPS: readonly WhatsNewGroup[] = [
  'new-offences',
  'renumbering',
  'dropped',
  'procedure',
  'evidence',
]

/** A resolved bullet: the pointer, plus everything the dataset says about it. */
export interface ResolvedPoint {
  point: WhatsNewPoint
  /** Present for a `section` point. */
  record?: LawSection
  /** Present for a `dropped` point. */
  entry?: LawIndexEntry
  /** The Act this bullet cites, in both languages. */
  actName: Bilingual
  /** The dataset source the citation links to. */
  source: { name: Bilingual; url: string } | null
}

/**
 * Resolve every bullet against the loaded corpus.
 *
 * A pointer that does not resolve is DROPPED rather than rendered empty. That
 * can only happen if a dataset changed under a bullet, which the unit test
 * catches first — but a reader must never see a citation with nothing behind
 * it, and failing quietly here is better than a crash in a route.
 */
export function resolveWhatsNew(corpus: LawCorpus): ResolvedPoint[] {
  const out: ResolvedPoint[] = []

  for (const point of WHATS_NEW) {
    if (point.kind === 'section') {
      const dataset = corpus.datasets[point.code]
      const record = dataset.sections[point.section]
      if (!record) continue
      const source =
        dataset.sources.find((entry) => record.sources.includes(entry.id)) ?? dataset.sources[0] ?? null
      out.push({
        point,
        record,
        actName: dataset.newAct.name,
        source: source ? { name: source.name, url: source.url } : null,
      })
      continue
    }

    const entry = lookupOldSection(corpus.index, point.oldAct, point.section)
    if (!entry) continue
    const act = corpus.index.acts[point.oldAct]
    // The correspondence table itself is the source for a dropped provision:
    // it is the document that marks the row "Deleted".
    const note = entry.warnings?.[0]?.source ?? null
    out.push({
      point,
      entry,
      actName: act?.oldActName ?? { en: point.oldAct, hi: point.oldAct },
      source: note,
    })
  }

  return out
}
