import { basename } from 'node:path'
import type { Analysis, FileEntry, FnNode, Mode, Progress } from '../shared/types'
import { countChanges, parseDiff, type FileDiff } from './diff'
import { isTestPath, readSource, reviewable, walkFiles } from './files'
import { diffAgainst, gitInfo, isGitRepo, listFiles, showAtBase, untrackedFiles } from './git'
import { innermost, linkCalls, withContext } from './links'
import { hashText, isParseable, parseSource, type ParsedFile, type ParsedSymbol } from './parse'
import { detectSinks, riskScore, tierOf } from './risk'
import { buildSteps } from './steps'

const MAX_FILES = 5000
const NO_SYMBOLS: ParsedFile = { symbols: [], calls: [] }

export class Cancelled extends Error {}

export interface Unit {
  path: string
  diff: FileDiff | null
  source: string | null
  parsed: ParsedFile
  /** Current symbols paired with their node, in source order. */
  symbols: { symbol: ParsedSymbol; node: FnNode }[]
  /** Functions present at the base commit but gone now. */
  removed: FnNode[]
  fileNode: FnNode | null
}

function wholeFileAdded(path: string, source: string | null): FileDiff {
  const addedLines = (source ?? '').split('\n').flatMap((line, i) => (line.trim() ? [i + 1] : []))
  return { path, oldPath: null, status: source === null ? 'binary' : 'added', addedLines, deletions: [], lines: [] }
}

interface Changes {
  git: Analysis['git']
  diffs: FileDiff[]
  /** Files that count as entirely new: untracked files, or every file outside git. */
  whole: string[]
  all: string[]
}

async function collectChanges(root: string, mode: Mode): Promise<Changes> {
  if (mode === 'all') {
    const files = await walkFiles(root)
    return { git: null, diffs: [], whole: files, all: files }
  }
  const git = await gitInfo(root, mode)
  const [all, untracked] = await Promise.all([listFiles(root), untrackedFiles(root)])
  if (!git.base) return { git, diffs: [], whole: all, all }
  return { git, diffs: parseDiff(await diffAgainst(root, git.base, 0)), whole: untracked, all }
}

/** `path#name`, with `~n` for repeated names (overloads), so head and base symbols pair up by id. */
function symbolIds(path: string, symbols: ParsedSymbol[]): string[] {
  const seen = new Map<string, number>()
  return symbols.map(({ name }) => {
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return `${path}#${name}${count > 1 ? `~${count}` : ''}`
  })
}

function newNode(id: string, path: string, name: string, kind: FnNode['kind']): FnNode {
  return {
    id, name, kind, path, startLine: 1, endLine: 1, hash: '', added: 0, removed: 0, change: 'added',
    before: null, after: null, callers: 0, sinks: [], tests: null, isTest: isTestPath(path), risk: 0, tier: 'low',
  }
}

function symbolNode(id: string, path: string, symbol: ParsedSymbol): FnNode {
  const node = newNode(id, path, symbol.name, 'function')
  return Object.assign(node, {
    startLine: symbol.startLine, endLine: symbol.endLine, hash: symbol.hash,
    sinks: detectSinks(symbol.text), tests: node.isTest ? null : 0,
  })
}

function buildUnit(path: string, diff: FileDiff | null, source: string | null, parsed: ParsedFile, base: ParsedFile | null): Unit {
  const baseIds = base ? symbolIds(path, base.symbols) : []
  const baseById = new Map(baseIds.map((id, i) => [id, base?.symbols[i]]))
  const headIds = symbolIds(path, parsed.symbols)
  const symbols = parsed.symbols.map((symbol, i) => {
    const node = symbolNode(headIds[i] as string, path, symbol)
    const before = baseById.get(node.id)
    Object.assign(node, { after: symbol.shape, before: before?.shape ?? null, change: before ? 'modified' : 'added' })
    return { symbol, node }
  })
  const live = new Set(headIds)
  const removed = baseIds.flatMap((id, i) => {
    const symbol = base?.symbols[i]
    if (live.has(id) || !symbol) return []
    return [Object.assign(symbolNode(id, path, symbol), { change: 'removed', before: symbol.shape, tests: null })]
  })
  return { path, diff, source, parsed, symbols, removed, fileNode: null }
}

function attributeChanges(unit: Unit, mode: Mode): void {
  const nodes = unit.symbols.map((s) => s.node)
  const outside = { added: 0, removed: 0 }
  for (const line of unit.diff?.addedLines ?? []) {
    const node = innermost(nodes, line)
    if (node) node.added += 1
    else outside.added += 1
  }
  for (const { after, old, count } of unit.diff?.deletions ?? []) {
    // A removed function owns its own lines. Otherwise the deletion sits between `after` and `after + 1`:
    // inside a symbol spanning both, else the code that replaced it, else the code above.
    const node = innermost(unit.removed, old) ?? innermost(nodes, after, after + 1) ?? innermost(nodes, after + 1) ?? innermost(nodes, after)
    if (node) node.removed += count
    else outside.removed += count
  }
  const deletedWithoutSymbols = unit.diff?.status === 'deleted' && unit.removed.length === 0
  const wantsFileNode = mode === 'all' ? nodes.length === 0 : true
  if (wantsFileNode && (outside.added > 0 || outside.removed > 0 || deletedWithoutSymbols)) unit.fileNode = fileNode(unit, outside)
}

function fileNode(unit: Unit, change: { added: number; removed: number }): FnNode {
  const kind = isParseable(unit.path) ? 'module' : 'file'
  const node = newNode(`${unit.path}#`, unit.path, basename(unit.path), kind)
  const lines = (unit.source ?? '').split('\n')
  const topLevel = lines.filter((_, i) => !innermost(unit.parsed.symbols, i + 1)).join('\n')
  return Object.assign(node, {
    endLine: Math.max(1, lines.length),
    hash: hashText(unit.source === null ? `deleted:${change.removed}` : topLevel),
    sinks: detectSinks(topLevel),
    change: unit.diff?.status === 'deleted' ? 'removed' : unit.diff?.status === 'added' ? 'added' : 'modified',
    added: change.added,
    removed: change.removed,
  })
}

function score(node: FnNode): void {
  const complexity = (node.after ?? node.before)?.complexity ?? 1
  node.risk = riskScore({ ...node, complexity, changed: node.added + node.removed })
  node.tier = tierOf(node.risk)
}

async function parseBase(root: string, base: string, path: string): Promise<ParsedFile | null> {
  const text = await showAtBase(root, base, path)
  const usable = text === null ? null : reviewable(text)
  return usable === null ? null : parseSource(path, usable)
}

async function loadUnit(root: string, path: string, change: FileDiff | 'whole' | undefined, base: string | null): Promise<Unit> {
  const source = change !== 'whole' && change?.status === 'deleted' ? null : await readSource(root, path)
  const parsed = source !== null && isParseable(path) ? await parseSource(path, source) : NO_SYMBOLS
  const diff = change === 'whole' ? wholeFileAdded(path, source) : (change ?? null)
  const hasBase = base !== null && diff !== null && diff.status !== 'added' && isParseable(diff.oldPath ?? path)
  const baseParsed = hasBase ? await parseBase(root, base, diff.oldPath ?? path) : null
  return buildUnit(path, diff, source, parsed, baseParsed)
}

export async function analyze(root: string, requested: Mode, onProgress: (p: Progress) => void, signal: AbortSignal): Promise<Analysis> {
  const mode = (await isGitRepo(root)) ? (requested === 'all' ? 'branch' : requested) : 'all'
  const { git, diffs, whole, all } = await collectChanges(root, mode)
  const changed = new Map<string, FileDiff | 'whole'>([...diffs.map((d) => [d.path, d] as const), ...whole.map((p) => [p, 'whole'] as const)])
  const rest = all.filter((path) => !changed.has(path) && isParseable(path))
  const queue = [...changed.keys(), ...rest].slice(0, Math.max(MAX_FILES, changed.size))
  const units: Unit[] = []
  for (const [index, path] of queue.entries()) {
    if (signal.aborted) throw new Cancelled()
    const unit = await loadUnit(root, path, changed.get(path), git?.base ?? null)
    if (unit.diff) attributeChanges(unit, mode)
    units.push(unit)
    if (index % 25 === 0) onProgress({ done: index, total: queue.length })
    await new Promise((resolve) => setImmediate(resolve))
  }
  const allEdges = linkCalls(units, Boolean(git?.base))
  const changedUnits = units.filter((u) => u.diff)
  const nodes = changedUnits.flatMap((u) => [
    ...(u.fileNode ? [u.fileNode] : []),
    ...u.symbols.map((s) => s.node).filter((n) => mode === 'all' || n.added + n.removed > 0),
    ...u.removed,
  ])
  nodes.forEach(score)
  const current = new Map(units.flatMap((u) => u.symbols.map((s) => [s.node.id, s.node] as const)))
  const { context, edges } = withContext(nodes, allEdges, current)
  return {
    root, name: basename(root), mode, git,
    files: changedUnits.map(fileEntry),
    nodes, context, edges,
    steps: buildSteps(nodes, edges),
    skippedFiles: rest.length + changed.size - queue.length,
  }
}

function fileEntry(unit: Unit): FileEntry {
  const diff = unit.diff as FileDiff
  return { path: unit.path, status: diff.status, ...countChanges(diff) }
}
