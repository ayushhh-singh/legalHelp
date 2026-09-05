/**
 * "Report a data error" — a prefilled `mailto:`, never a form this app submits.
 *
 * The master context rules out a backend for anything the reader types, and a
 * report about a wrong figure or a garbled provision is exactly that. It lives
 * here rather than beside Settings' About card because the Library's reader
 * offers the same action from its ⋯ menu, and two copies of an address is one
 * that goes stale.
 */

const REPORT_EMAIL = 'asingh9@ee.iitr.ac.in'

export function reportMailto(language: string, context?: string): string {
  const subject = language === 'hi' ? 'Sahayak — डेटा में त्रुटि' : 'Sahayak — data error report'
  const preamble =
    language === 'hi'
      ? 'कृपया बताएं कि कौन-सा आँकड़ा गलत है, और सही स्रोत का लिंक हो तो जोड़ें:'
      : 'Which figure or record is wrong, and (if you have it) a link to the correct source:'
  // The citation goes in the body when the caller has one, so a report sent
  // from a provision names the provision without the reader retyping it.
  const body = context ? `${preamble}\n\n${context}\n\n` : `${preamble}\n\n`
  return `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
