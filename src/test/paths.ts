import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Vitest runs from the project root, and `import.meta.url` is not a file: URL
 * under the jsdom environment — so repo-relative paths are resolved from cwd.
 */
export const projectRoot = process.cwd()

export const fromRoot = (...segments: string[]) => resolve(projectRoot, ...segments)

export const readFromRoot = (...segments: string[]) => readFileSync(fromRoot(...segments), 'utf8')
