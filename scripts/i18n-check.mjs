#!/usr/bin/env node
/**
 * Fail the build if the English and Hindi resource files disagree.
 *
 * Master context: Hindi and English are on equal footing. A missing `hi` string
 * is a CI failure, not a fallback — so this checks key parity in BOTH
 * directions, and also flags empty strings and values whose type differs
 * between locales (e.g. object in one, string in the other).
 *
 * Usage: pnpm i18n:check
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const I18N_DIR = join(ROOT, 'src', 'i18n')
const LOCALES = ['en', 'hi']
const BASE = 'en'

/** Flatten to `a.b.c` -> value, recording the type of every leaf. */
function flatten(obj, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, out)
    } else {
      out.set(path, value)
    }
  }
  return out
}

const load = async (locale) => flatten(JSON.parse(await readFile(join(I18N_DIR, `${locale}.json`), 'utf8')))

const maps = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l, await load(l)])))

const problems = []
const base = maps[BASE]

for (const locale of LOCALES) {
  if (locale === BASE) continue
  const other = maps[locale]

  for (const key of base.keys()) {
    if (!other.has(key)) problems.push(`missing in ${locale}.json: ${key}`)
  }
  for (const key of other.keys()) {
    if (!base.has(key)) problems.push(`missing in ${BASE}.json: ${key}  (present in ${locale}.json)`)
  }
  for (const [key, value] of other) {
    if (!base.has(key)) continue
    const baseType = typeof base.get(key)
    if (typeof value !== baseType) {
      problems.push(`type mismatch at ${key}: ${BASE}=${baseType}, ${locale}=${typeof value}`)
    }
  }
}

for (const locale of LOCALES) {
  for (const [key, value] of maps[locale]) {
    if (typeof value === 'string' && value.trim() === '') {
      problems.push(`empty string in ${locale}.json: ${key}`)
    }
  }
}

/** Hindi strings that are byte-identical to English are usually untranslated. */
const IDENTICAL_ALLOWED = new Set([])
for (const [key, value] of maps.hi) {
  if (typeof value !== 'string') continue
  const enValue = maps.en.get(key)
  if (typeof enValue !== 'string') continue
  const isAscii = /^[\x20-\x7E]*$/.test(value)
  if (value === enValue && isAscii && value.trim() !== '' && !IDENTICAL_ALLOWED.has(key)) {
    problems.push(`hi.json appears untranslated at ${key}: "${value}"`)
  }
}

if (problems.length > 0) {
  process.stderr.write(`i18n:check FAILED — ${problems.length} problem(s)\n\n`)
  for (const p of problems) process.stderr.write(`  • ${p}\n`)
  process.stderr.write('\n')
  process.exit(1)
}

process.stdout.write(
  `i18n:check OK — ${base.size} keys, ${LOCALES.length} locales (${LOCALES.join(', ')}), all in parity\n`,
)
