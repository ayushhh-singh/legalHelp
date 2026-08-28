/**
 * Devanagari ⇄ Latin, for search only.
 *
 * An officer who wants BNS 103 types "hatya" as often as "हत्या" or "murder",
 * and no data source carries the roman spelling for every section. Two
 * directions solve that, and they are used for different things:
 *
 *  - `romanise()` turns Devanagari into a Latin transcription. Every Hindi
 *    heading and keyword in the datasets goes through it once at index time.
 *  - `toDevanagari()` turns a Latin query into an approximate Devanagari form,
 *    so a roman query can also reach Devanagari text that has no keyword.
 *
 * Neither is a transliteration standard, and neither is ever shown to a reader.
 * They exist to put a query and a record into the same alphabet so `fuse.js`
 * can compare them. `foldRoman()` is what makes them meet: it collapses the
 * distinctions Latin spelling of Hindi is inconsistent about (vowel length,
 * `v`/`w`, `z`/`j`, doubled letters), so "hatya", "hatyaa" and the transcription
 * of "हत्या" all fold to the same string.
 *
 * NOTHING HERE IS PRESENTED AS THE LAW'S OWN WORDS. It is an index aid.
 */

/* ------------------------------------------------------------------ *
 * Devanagari → Latin
 * ------------------------------------------------------------------ */

const VIRAMA = '्'
const NUKTA = '़'

/** Base consonants. The inherent vowel is added by `romanise`, not here. */
const CONSONANTS: Readonly<Record<string, string>> = {
  क: 'k',
  ख: 'kh',
  ग: 'g',
  घ: 'gh',
  ङ: 'n',
  च: 'ch',
  छ: 'chh',
  ज: 'j',
  झ: 'jh',
  ञ: 'n',
  ट: 't',
  ठ: 'th',
  ड: 'd',
  ढ: 'dh',
  ण: 'n',
  त: 't',
  थ: 'th',
  द: 'd',
  ध: 'dh',
  न: 'n',
  प: 'p',
  फ: 'ph',
  ब: 'b',
  भ: 'bh',
  म: 'm',
  य: 'y',
  र: 'r',
  ल: 'l',
  ळ: 'l',
  व: 'v',
  श: 'sh',
  ष: 'sh',
  स: 's',
  ह: 'h',
}

/**
 * Consonant + nukta. Unicode's composition exclusions mean NFC leaves these as
 * two codepoints, so the pair is what has to be matched — the precomposed forms
 * (क़ U+0958 and friends) are normalised apart before they get here.
 */
const NUKTA_CONSONANTS: Readonly<Record<string, string>> = {
  क: 'q',
  ख: 'kh',
  ग: 'g',
  ज: 'z',
  ड: 'r',
  ढ: 'rh',
  फ: 'f',
}

/** Dependent vowel signs (matras). */
const MATRAS: Readonly<Record<string, string>> = {
  'ा': 'aa',
  'ि': 'i',
  'ी': 'ii',
  'ु': 'u',
  'ू': 'uu',
  'ृ': 'ri',
  'ॄ': 'ri',
  'े': 'e',
  'ै': 'ai',
  'ो': 'o',
  'ौ': 'au',
  'ॅ': 'e',
  'ॉ': 'o',
  'ॆ': 'e',
  'ॊ': 'o',
}

/** Independent vowels. */
const VOWELS: Readonly<Record<string, string>> = {
  अ: 'a',
  आ: 'aa',
  इ: 'i',
  ई: 'ii',
  उ: 'u',
  ऊ: 'uu',
  ऋ: 'ri',
  ए: 'e',
  ऐ: 'ai',
  ओ: 'o',
  औ: 'au',
  ऑ: 'o',
  ऍ: 'e',
}

/** Anusvara, chandrabindu and visarga, which all read as a nasal or an /h/. */
const SIGNS: Readonly<Record<string, string>> = {
  'ं': 'n',
  'ँ': 'n',
  'ः': 'h',
}

const DEVANAGARI_DIGITS = '०१२३४५६७८९'

const isDevanagariConsonant = (char: string) => char in CONSONANTS

/**
 * A Latin transcription of Devanagari text.
 *
 * The inherent vowel is the whole difficulty: `हत्या` is ह + त + ् + य + ा, and
 * only the virama tells you that the त carries no vowel. So each consonant
 * looks ahead exactly one character — a matra, a virama, or neither, which
 * means the inherent `a`.
 *
 * Word-final schwa (which Hindi drops in speech: `घर` is "ghar", not "ghara")
 * is deliberately kept. `foldRoman` strips a trailing `a`, so both spellings
 * meet there rather than being guessed at here.
 */
export function romanise(input: string): string {
  const text = input.normalize('NFC')
  let out = ''

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? ''
    const next = text[i + 1] ?? ''

    if (isDevanagariConsonant(char)) {
      let consonant = CONSONANTS[char] ?? ''
      let cursor = i

      if (next === NUKTA) {
        consonant = NUKTA_CONSONANTS[char] ?? consonant
        cursor += 1
      }

      const following = text[cursor + 1] ?? ''
      if (following === VIRAMA) {
        out += consonant
        i = cursor + 1
      } else if (following in MATRAS) {
        out += consonant + (MATRAS[following] ?? '')
        i = cursor + 1
      } else {
        // No matra and no virama: the consonant carries its inherent vowel.
        out += `${consonant}a`
        i = cursor
      }
      continue
    }

    if (char in VOWELS) {
      out += VOWELS[char] ?? ''
      continue
    }
    if (char in SIGNS) {
      out += SIGNS[char] ?? ''
      continue
    }
    if (char in MATRAS) {
      // A stray matra with no consonant before it — malformed input, but
      // transcribing it is better than dropping the syllable.
      out += MATRAS[char] ?? ''
      continue
    }

    const digit = DEVANAGARI_DIGITS.indexOf(char)
    if (digit >= 0) {
      out += String(digit)
      continue
    }

    // Latin, punctuation and whitespace pass through untouched, so a mixed
    // string like "धारा 302" survives intact.
    if (char !== VIRAMA && char !== NUKTA && char !== 'ऽ' && char !== '॰') {
      out += char
    }
  }

  return out
}

/* ------------------------------------------------------------------ *
 * Latin → Devanagari
 * ------------------------------------------------------------------ */

/**
 * Ordered longest-first: `chh` must be tried before `ch`, and `ch` before `c`,
 * or "chhal" becomes च‍्हल.
 */
const ROMAN_CONSONANTS: ReadonlyArray<readonly [string, string]> = [
  ['chh', 'छ'],
  ['ksh', 'क्ष'],
  ['shr', 'श्र'],
  ['gy', 'ज्ञ'],
  ['kh', 'ख'],
  ['gh', 'घ'],
  ['ch', 'च'],
  ['jh', 'झ'],
  ['th', 'थ'],
  ['dh', 'ध'],
  ['ph', 'फ'],
  ['bh', 'भ'],
  ['sh', 'श'],
  ['ng', 'ं'],
  ['ny', 'ञ'],
  ['k', 'क'],
  ['q', 'क़'],
  ['g', 'ग'],
  ['c', 'च'],
  ['j', 'ज'],
  ['z', 'ज़'],
  ['t', 'त'],
  ['d', 'द'],
  ['n', 'न'],
  ['p', 'प'],
  ['f', 'फ़'],
  ['b', 'ब'],
  ['m', 'म'],
  ['y', 'य'],
  ['r', 'र'],
  ['l', 'ल'],
  ['v', 'व'],
  ['w', 'व'],
  ['s', 'स'],
  ['h', 'ह'],
  ['x', 'क्स'],
]

/** `[roman, independent vowel, matra]`. Longest-first, same reason. */
const ROMAN_VOWELS: ReadonlyArray<readonly [string, string, string]> = [
  ['aa', 'आ', 'ा'],
  ['ai', 'ऐ', 'ै'],
  ['au', 'औ', 'ौ'],
  ['ee', 'ई', 'ी'],
  ['ii', 'ई', 'ी'],
  ['oo', 'ऊ', 'ू'],
  ['uu', 'ऊ', 'ू'],
  ['ri', 'ऋ', 'ृ'],
  ['a', 'अ', ''],
  ['i', 'इ', 'ि'],
  ['u', 'उ', 'ु'],
  ['e', 'ए', 'े'],
  ['o', 'ओ', 'ो'],
]

function matchAt(
  text: string,
  at: number,
  table: ReadonlyArray<readonly string[]>,
): readonly string[] | undefined {
  for (const row of table) {
    const key = row[0] ?? ''
    if (text.startsWith(key, at)) return row
  }
  return undefined
}

/**
 * An approximate Devanagari form of a roman-Hindi word.
 *
 * "Approximate" is the honest word: roman Hindi does not distinguish dental
 * from retroflex (`t` is both त and ट) or short from long where the writer did
 * not bother, so "chori" produces चोरि where the word is चोरी. That is fine —
 * the output feeds a fuzzy matcher against Devanagari headings, and being one
 * matra out costs a little score, not the match. Where an exact term matters,
 * the lexicon's own `roman` list in `data/law/*.json` carries it.
 *
 * A string with no Latin letters at all comes back unchanged, so calling this
 * on Devanagari input is a no-op rather than a corruption.
 */
export function toDevanagari(input: string): string {
  const text = input.normalize('NFC').toLowerCase()
  let out = ''
  let i = 0
  /** True when the previous emission was a consonant awaiting its vowel. */
  let pendingConsonant = false

  while (i < text.length) {
    const consonant = matchAt(text, i, ROMAN_CONSONANTS)
    if (consonant) {
      // Two consonants in a row are a conjunct: the first one loses its
      // inherent vowel, which is what the virama says.
      if (pendingConsonant) out += VIRAMA
      out += consonant[1] ?? ''
      i += (consonant[0] ?? '').length
      pendingConsonant = true
      continue
    }

    const vowel = matchAt(text, i, ROMAN_VOWELS)
    if (vowel) {
      out += pendingConsonant ? (vowel[2] ?? '') : (vowel[1] ?? '')
      i += (vowel[0] ?? '').length
      pendingConsonant = false
      continue
    }

    out += text[i] ?? ''
    i += 1
    pendingConsonant = false
  }

  return out
}

/* ------------------------------------------------------------------ *
 * Folding
 * ------------------------------------------------------------------ */

/**
 * Collapse a Latin string to the skeleton both sides of a search can agree on.
 *
 * Roman Hindi has no spelling authority, so the same word reaches us as
 * "hatya" / "hatyaa", "chori" / "choree", "vasuli" / "wasooli". Each rule below
 * removes one distinction that carries no meaning in that alphabet:
 *
 *  - vowel length (`aa`→`a`, `ee`/`ii`→`i`, `oo`/`uu`→`u`)
 *  - `w`→`v`, `z`→`j`, `q`→`k`, `x`→`ks` — Hindi phonemes Latin spells several ways
 *  - any doubled letter
 *  - a trailing `a`, which is the schwa Hindi drops in speech but Devanagari
 *    still writes: `romanise('घर')` is "ghara", and a reader types "ghar"
 *
 * Applied to BOTH the query and the index, so the two meet in the middle
 * rather than one being bent towards the other.
 */
export function foldRoman(input: string): string {
  let text = input.normalize('NFKD').toLowerCase()
  // Strip combining marks left by NFKD, so "chorī" folds like "chorii".
  text = text.replace(/[̀-ͯ]/g, '')
  text = text.replace(/[^a-z0-9]/g, '')

  text = text
    .replace(/aa/g, 'a')
    .replace(/(?:ee|ii)/g, 'i')
    .replace(/(?:oo|uu)/g, 'u')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/q/g, 'k')
    .replace(/x/g, 'ks')
    // Any remaining doubled letter: "sarrkar", "abbhiyukt".
    .replace(/([a-z])\1+/g, '$1')

  // Trailing schwa. Guarded so a one-letter token does not vanish entirely.
  if (text.length > 2 && text.endsWith('a')) text = text.slice(0, -1)

  return text
}

/** True when the string contains at least one Devanagari letter. */
export function hasDevanagari(input: string): boolean {
  return /[ऀ-ॿ]/.test(input)
}

/** True when the string contains at least one Latin letter. */
export function hasLatin(input: string): boolean {
  return /[A-Za-z]/.test(input)
}

/**
 * The folded Latin skeleton of any string, in either script.
 *
 * This is the one function the search index calls: it does not care which
 * alphabet a term arrived in, only that every term ends up comparable.
 */
export function romanKey(input: string): string {
  return foldRoman(hasDevanagari(input) ? romanise(input) : input)
}
