export {
  allBookmarks,
  allHighlights,
  allNotes,
  colourOf,
  createHighlight,
  deleteHighlight,
  deleteNote,
  HIGHLIGHT_COLOURS,
  highlightsFor,
  isHighlightColour,
  isStale,
  lostHighlights,
  notesFor,
  quoteText,
  rememberScroll,
  resolveHighlights,
  saveNote,
  setBookmarkLabel,
  setHighlightColour,
  setMarkedRead,
  toMarkdown,
  type ExportableAnnotation,
  type HighlightColour,
  type NoteInput,
  type ResolvedHighlight,
} from './annotations'
export {
  anchorParagraphs,
  anchorText,
  normaliseText,
  paragraphRanges,
  quoteAt,
  resolveAnchor,
  segmentParagraph,
  type AnchoredRange,
  type AnchorResolution,
  type AnchorSpan,
  type ParagraphRange,
  type Segment,
} from './anchor'
export { ALL_CATEGORIES, LIBRARY_CATEGORIES } from './categories'
export { diffOf, type ComparePart, type CompareResult } from './compare'
export {
  buildTermMatcher,
  findTermOccurrences,
  isDefinitionsUnit,
  parseDefinitions,
  type DefinedTerm,
  type TermOccurrence,
} from './definitions'
export {
  noteToPlainText,
  parseInline,
  parseNote,
  safeHref,
  wikiLinks,
  type BlockNode,
  type InlineNode,
} from './markdown'
export {
  buildPersonalCorpus,
  deletePersonalWork,
  fromDataset,
  fromPersonal,
  getPersonalWork,
  isPersonalWorkId,
  listPersonalWorks,
  parsePersonalFile,
  personalFileName,
  personalWorkId,
  savePersonalWork,
  toPersonalFile,
  UNIT_WORDS,
  type PersonalWorkFile,
  type ReaderWork,
} from './personal'
export { extractQuickRef, type QuickRefKind, type QuickRefRow } from './quickref'
export {
  DEFAULT_ACTS,
  findReferences,
  referenceLabel,
  resolveReference,
  type ActPattern,
  type UnitReference,
} from './refs'
export {
  mergeWithPrevious,
  splitDocument,
  splitUnitAt,
  type SplitConfidence,
  type SplitResult,
  type SplitUnit,
} from './split'
export {
  clampRate,
  noLocalVoiceReason,
  platformHint,
  RATE_MAX,
  RATE_MIN,
  RATE_STEP,
  ReadAloudController,
  sentenceRanges,
  splitSentences,
  usableVoices,
  type NoVoiceReason,
  type ReadAloudSnapshot,
  type ReadAloudState,
  type SentenceRange,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from './tts'
export { buildCorpus, paragraphs, tocLeaves, type CorpusJson, type CorpusWork } from './corpus'
export { lawCrossReferences, type LawCrossReference } from './crossRefs'
export {
  AID_WORK_IDS,
  isWorkId,
  loadCorpus,
  loadDefinitions,
  loadLibraryIndex,
  loadQuickRef,
  loadStudyAids,
  loadWork,
  resetLibraryCache,
  WORK_IDS,
} from './data'
export { unitLabel, type UnitLabel } from './label'
export {
  adjacent,
  firstUnitId,
  getUnit,
  tocPath,
  tocUnitIds,
  type Adjacent,
  type OrderedWork,
  type TocWork,
} from './navigate'
export { estimateReadTime, WPM } from './readTime'
export {
  buildWorkSearchIndex,
  isSearchable,
  searchAll,
  searchWithin,
  type ShelfSearchGroup,
  type WorkSearchHit,
  type WorkSearchIndex,
} from './search'
export {
  bookmarksFor,
  isBookmarked,
  lastReadAnywhere,
  lastReadIn,
  progressFor,
  progressId,
  readUnitIds,
  recordProgress,
  toggleBookmark,
} from './store'
export { isLibraryTag, LIBRARY_TAGS, tagLabel, type LibraryTag } from './tags'
export type { LibraryCorpus, LibraryUnit } from './types'
