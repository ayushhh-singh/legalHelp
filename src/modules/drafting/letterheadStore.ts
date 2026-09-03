import { db, type LetterheadImageRow } from '@/db'
import {
  checkLetterheadFile,
  fitLetterhead,
  svgIsInert,
  type LetterheadCheck,
  type LetterheadRejection,
} from '@/lib/drafting/letterhead'

/**
 * The officer's own letterhead image, in IndexedDB.
 *
 * There is exactly one, keyed `letterhead`, and it is the officer's — this app
 * ships no emblem, no crest and no seal, and the surface says so. See
 * `src/lib/drafting/letterhead.ts` for why.
 */

export const LETTERHEAD_ID = 'letterhead'

export type StoreResult =
  { ok: true; row: LetterheadImageRow } | { ok: false; reason: LetterheadRejection | 'undecodable' }

export const getLetterhead = (): Promise<LetterheadImageRow | undefined> =>
  db.letterheadImages.get(LETTERHEAD_ID)

export const deleteLetterhead = (): Promise<void> => db.letterheadImages.delete(LETTERHEAD_ID)

/**
 * Measure an image without rendering it into the page.
 *
 * `Image` with an object URL rather than `createImageBitmap`, because an SVG
 * has no intrinsic bitmap and `createImageBitmap` rejects one in Firefox. The
 * URL is revoked in both branches — an object URL that outlives its use pins
 * the whole blob in memory for the life of the tab.
 */
export function measureImage(blob: Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

/**
 * Store a chosen file, after every check.
 *
 * An SVG is read as TEXT first and refused if it names a script, an event
 * handler or an external URL. It is never rendered inline anywhere in this app
 * — it goes into an `<img src="blob:…">`, where scripts do not run — so this is
 * the second belt, and its value is that the officer is told at upload time
 * rather than getting a letterhead that silently does not draw.
 */
export async function putLetterheadFile(file: File, at: string): Promise<StoreResult> {
  const check: LetterheadCheck = checkLetterheadFile(file)
  if (!check.ok) return { ok: false, reason: check.reason }

  if (check.type === 'image/svg+xml') {
    const source = await file.text()
    if (!svgIsInert(source)) return { ok: false, reason: 'unsafe-svg' }
  }

  const blob = new Blob([file], { type: check.type })
  const measured = await measureImage(blob)
  if (!measured || measured.width === 0 || measured.height === 0) {
    // An SVG with only a `viewBox` and no `width` reports 0 in some browsers.
    // A default that matches the header band is better than a refusal: the
    // officer can see the result in the preview and change it.
    if (check.type !== 'image/svg+xml') return { ok: false, reason: 'undecodable' }
  }

  const row: LetterheadImageRow = {
    id: LETTERHEAD_ID,
    type: check.type,
    name: file.name,
    data: blob,
    width: measured?.width || 600,
    height: measured?.height || 120,
    updatedAt: at,
  }
  await db.letterheadImages.put(row)
  return { ok: true, row }
}

/** The size the stored image prints at, fitted into the header band. */
export const letterheadSizeMm = (row: LetterheadImageRow) =>
  fitLetterhead({ width: row.width, height: row.height })
