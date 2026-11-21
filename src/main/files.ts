import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const IGNORED_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'coverage',
  'venv', '__pycache__', 'Pods',
])
const MAX_FILE_BYTES = 1024 * 1024
const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$|(^|\/)test_[^/]+$/i

export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}
const MINIFIED_LINE = 2000

/** Lists files under `root` for folders without git, skipping dependency and build directories. */
export async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop() as string
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) pending.push(join(dir, entry.name))
      else if (entry.isFile()) files.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
    }
  }
  return files.sort()
}

/** Text worth parsing: not too large, not binary, not minified. Null otherwise. */
export function reviewable(text: string): string | null {
  if (text.length > MAX_FILE_BYTES || text.includes('\0')) return null
  if (text.split('\n', 50).some((line) => line.length > MINIFIED_LINE)) return null
  return text
}

/** Reads a file for analysis; null when it is missing or not reviewable. */
export async function readSource(root: string, path: string): Promise<string | null> {
  const full = join(root, path)
  const info = await stat(full).catch(() => null)
  if (!info?.isFile() || info.size > MAX_FILE_BYTES) return null
  return reviewable(await readFile(full, 'utf8'))
}
