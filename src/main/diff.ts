import type { DiffLine, FileStatus } from '../shared/types'

export interface FileDiff {
  path: string
  /** Path in the base commit when renamed. */
  oldPath: string | null
  status: FileStatus
  /** New-file line numbers of added non-blank lines. */
  addedLines: number[]
  /** For each deletion run: the new-file line it sits after, its first base line, and how many non-blank lines were removed. */
  deletions: { after: number; old: number; count: number }[]
  lines: DiffLine[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

// Git C-quotes unusual paths. With core.quotePath=false only JSON-compatible escapes (\" \\ \t \n) remain.
function unquote(path: string): string {
  if (!path.startsWith('"')) return path
  try {
    return JSON.parse(path) as string
  } catch {
    return path.slice(1, -1)
  }
}

function emptyFile(): FileDiff {
  return { path: '', oldPath: null, status: 'modified', addedLines: [], deletions: [], lines: [] }
}

function readHeader(file: FileDiff, line: string): void {
  if (line.startsWith('new file mode')) file.status = 'added'
  else if (line.startsWith('deleted file mode')) file.status = 'deleted'
  else if (line.startsWith('rename to ')) file.status = 'renamed'
  else if (line.startsWith('rename from ')) file.oldPath = unquote(line.slice(12))
  else if (line.startsWith('Binary files')) file.status = 'binary'
  // Git appends a tab to ---/+++ paths that contain spaces.
  else if (line.startsWith('+++ ') && line !== '+++ /dev/null') file.path = unquote(line.slice(4).replace(/\t$/, '')).replace(/^b\//, '')
}

/** Parses `git diff --no-color` output. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let file: FileDiff | null = null
  let newNo = 0
  let oldNo = 0
  let inHunk = false
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = emptyFile()
      file.path = /^diff --git a\/.+ b\/(.+)$/.exec(line)?.[1] ?? ''
      files.push(file)
      inHunk = false
      continue
    }
    if (!file) continue
    const hunk = HUNK.exec(line)
    if (hunk) {
      inHunk = true
      oldNo = Number(hunk[1])
      newNo = Number(hunk[3])
      if (hunk[2] === '0') oldNo += 1
      if (hunk[4] === '0') newNo += 1
      continue
    }
    if (!inHunk) {
      readHeader(file, line)
      continue
    }
    const kind = line[0]
    const body = line.slice(1)
    if (kind === '+') {
      if (body.trim()) file.addedLines.push(newNo)
      file.lines.push({ kind: '+', no: newNo++, old: null, text: body })
    } else if (kind === '-') {
      const last = file.deletions.at(-1)
      const weight = body.trim() ? 1 : 0
      if (last && last.after === newNo - 1 && file.lines.at(-1)?.kind === '-') last.count += weight
      else if (weight) file.deletions.push({ after: newNo - 1, old: oldNo, count: weight })
      file.lines.push({ kind: '-', no: null, old: oldNo++, text: body })
    } else if (kind === ' ') {
      file.lines.push({ kind: ' ', no: newNo++, old: oldNo++, text: body })
    }
  }
  return files.filter((f) => f.path)
}

export function countChanges(file: FileDiff): { added: number; removed: number } {
  return { added: file.addedLines.length, removed: file.deletions.reduce((sum, d) => sum + d.count, 0) }
}
