export { ALL_CATEGORIES, LIBRARY_CATEGORIES } from './categories'
export { buildCorpus, paragraphs, tocLeaves, type CorpusJson } from './corpus'
export { lawCrossReferences, type LawCrossReference } from './crossRefs'
export { isWorkId, loadCorpus, loadLibraryIndex, loadWork, resetLibraryCache, WORK_IDS } from './data'
export { unitLabel, type UnitLabel } from './label'
export { adjacent, firstUnitId, getUnit, tocPath, tocUnitIds, type Adjacent } from './navigate'
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
