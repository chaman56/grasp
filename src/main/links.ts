import type { Edge, EdgeChange, FnNode } from '../shared/types'
import type { Unit } from './analyze'
import { isTestPath } from './files'
import { grammarOf } from './parse'

const MAX_CONTEXT_CALLERS = 5

export function innermost<T extends { startLine: number; endLine: number }>(items: T[], line: number, next = line): T | null {
  let best: T | null = null
  for (const item of items) {
    if (item.startLine > line || item.endLine < next) continue
    if (!best || item.endLine - item.startLine < best.endLine - best.startLine) best = item
  }
  return best
}

// JS, JSX, TS and TSX call each other freely; other languages only resolve within themselves.
function languageFamily(path: string): string | undefined {
  const grammar = grammarOf(path)
  return grammar === 'tsx' || grammar === 'javascript' ? 'typescript' : grammar
}

function shortName(node: FnNode): string {
  return node.name.slice(node.name.lastIndexOf('.') + 1)
}

function indexByName(nodes: FnNode[]): Map<string, FnNode[]> {
  const byName = new Map<string, FnNode[]>()
  for (const node of nodes) {
    const list = byName.get(shortName(node))
    if (list) list.push(node)
    else byName.set(shortName(node), [node])
  }
  return byName
}

/**
 * Name-based, so heuristic. Among same-language candidates (never test code when calling from production code):
 * one in the same file wins, then one whose qualified name contains the call's qualifier, then a unique match.
 */
function resolve(byName: Map<string, FnNode[]>, name: string, qualifier: string | null, caller: { id?: string; path: string; isTest: boolean }): FnNode | undefined {
  const family = languageFamily(caller.path)
  const candidates = (byName.get(name) ?? []).filter(
    (c) => c.id !== caller.id && languageFamily(c.path) === family && (caller.isTest || !c.isTest),
  )
  const local = candidates.filter((c) => c.path === caller.path)
  if (local.length === 1) return local[0]
  const qualified = qualifier ? candidates.filter((c) => c.name.split('.').includes(qualifier)) : []
  if (qualified.length === 1) return qualified[0]
  return local.length === 0 && candidates.length === 1 ? candidates[0] : undefined
}

function edgeChange(caller: FnNode, callee: string, hasBase: boolean): EdgeChange {
  if (!hasBase) return 'same'
  if (caller.before) return caller.before.calls.includes(callee) ? 'same' : 'added'
  return caller.change === 'added' && caller.kind === 'function' ? 'added' : 'same'
}

/** Resolves calls in the current code, plus calls that changed functions no longer make. */
export function linkCalls(units: Unit[], hasBase: boolean): Edge[] {
  const current = indexByName(units.flatMap((u) => u.symbols.map((s) => s.node)))
  const edges = new Map<string, Edge>()
  for (const unit of units) {
    const nodes = unit.symbols.map((s) => s.node)
    const isTest = isTestPath(unit.path)
    for (const call of unit.parsed.calls) {
      const caller = innermost(nodes, call.line) ?? unit.fileNode
      const callee = resolve(current, call.name, call.qualifier, { id: caller?.id, path: unit.path, isTest })
      if (!callee) continue
      callee.callers += 1
      if (isTest && callee.tests !== null) callee.tests += 1
      if (caller) edges.set(`${caller.id}>${callee.id}`, { from: caller.id, to: callee.id, change: edgeChange(caller, call.name, hasBase) })
    }
  }
  const withRemoved = units.flatMap((u) => [...u.symbols.map((s) => s.node), ...u.removed])
  const everything = indexByName(withRemoved)
  for (const caller of withRemoved) {
    for (const name of caller.before?.calls ?? []) {
      if (caller.after?.calls.includes(name)) continue
      const callee = resolve(everything, name, null, caller)
      if (callee) edges.set(`${caller.id}>${callee.id}`, { from: caller.id, to: callee.id, change: 'removed' })
    }
  }
  return [...edges.values()]
}

/**
 * Keeps edges that touch changed nodes, and returns the unchanged functions on their other end as context.
 * Test callers are left out (each node's test count summarises them), and callers are capped per node.
 */
export function withContext(nodes: FnNode[], edges: Edge[], all: Map<string, FnNode>): { context: FnNode[]; edges: Edge[] } {
  const changed = new Set(nodes.map((n) => n.id))
  const context = new Map<string, FnNode>()
  const callersShown = new Map<string, number>()
  const kept: Edge[] = []
  for (const edge of edges) {
    const fromChanged = changed.has(edge.from)
    const toChanged = changed.has(edge.to)
    if (fromChanged && toChanged) kept.push(edge)
    if (fromChanged === toChanged) continue
    const other = all.get(fromChanged ? edge.to : edge.from)
    if (!other || other.isTest) continue
    if (!fromChanged) {
      const shown = callersShown.get(edge.to) ?? 0
      if (shown >= MAX_CONTEXT_CALLERS) continue
      callersShown.set(edge.to, shown + 1)
    }
    context.set(other.id, other)
    kept.push(edge)
  }
  return { context: [...context.values()], edges: kept }
}
