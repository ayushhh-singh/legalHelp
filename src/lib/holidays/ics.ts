/**
 * RFC 5545 export of the gazetted holidays only — the restricted list is a
 * personal choice of at most two, not a calendar of days the office is shut,
 * and exporting it alongside the gazetted list would tell a calendar app the
 * office is closed on days it is not.
 *
 * `stamp` is threaded in rather than read from a clock (`DTSTAMP` must be an
 * instant, but this stays a pure function of its arguments) — callers pass
 * `dataset.fetchedAt`, which is already the "as of" instant for every date in
 * the file.
 */

import type { HolidaysDataset } from './types'

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function toBasicDate(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}

function toBasicDateTime(isoInstant: string): string {
  // "2026-08-29T00:00:00Z" -> "20260829T000000Z"
  return isoInstant.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

const CRLF = '\r\n'

export function toIcs(dataset: HolidaysDataset, stamp: string = dataset.fetchedAt): string {
  const dtstamp = toBasicDateTime(stamp)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sahayak//Holiday Calendar//EN',
    'CALSCALE:GREGORIAN',
  ]

  for (const holiday of dataset.gazetted) {
    const start = toBasicDate(holiday.date)
    lines.push(
      'BEGIN:VEVENT',
      `UID:${holiday.id}-${dataset.year}@sahayak`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `SUMMARY:${icsEscape(holiday.name.en)} / ${icsEscape(holiday.name.hi)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join(CRLF) + CRLF
}
