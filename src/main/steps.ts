import { basename, dirname } from 'node:path'
import type { Edge, FnNode, Step } from '../shared/types'

const MAX_STEP_NODES = 12
const MAX_CODE_STEPS = 7

function groupBy(nodes: FnNode[], key: (n: FnNode) => string): FnNode[][] {
  const groups = new Map<string, FnNode[]>()
  for (const n of nodes) {
    const list = groups.get(key(n))
    if (list) list.push(n)
    else groups.set(key(n), [n])
  }
  return [...groups.values()]
}

function components(nodes: FnNode[], edges: Edge[]): FnNode[][] {
  const parent = new Map(nodes.map((n) => [n.id, n.id]))
  const find = (id: string): string => {
    let root = id
    while (parent.get(root) !== root) root = parent.get(root) as string
    parent.set(id, root)
    return root
  }
  const union = (a: string, b: string) => parent.set(find(a), find(b))
  for (const e of edges) if (parent.has(e.from) && parent.has(e.to)) union(e.from, e.to)
  const firstInFile = new Map<string, string>()
  for (const n of nodes) {
    const first = firstInFile.get(n.path)
    if (first) union(n.id, first)
    else firstInFile.set(n.path, n.id)
  }
  return groupBy(nodes, (n) => find(n.id))
}

// Big components read better per directory, then per file, than as one 40-node step.
function splitLarge(group: FnNode[]): FnNode[][] {
  if (group.length <= MAX_STEP_NODES) return [group]
  return groupBy(group, (n) => dirname(n.path)).flatMap((dir) =>
    dir.length <= MAX_STEP_NODES ? [dir] : groupBy(dir, (n) => n.path),
  )
}

// How many nodes of the group are reachable from `start`: entry points that lead into more of the step read first.
function reach(start: string, inner: Edge[]): number {
  const seen = new Set([start])
  for (let frontier = [start]; frontier.length; ) {
    frontier = inner.filter((e) => frontier.includes(e.from) && !seen.has(e.to)).map((e) => e.to)
    for (const id of frontier) seen.add(id)
  }
  return seen.size
}

/** Callers before callees (longest path from an entry point); within a rank, widest reach then risk. */
function readingOrder(group: FnNode[], edges: Edge[]): FnNode[] {
  const rank = new Map(group.map((n) => [n.id, 0]))
  const inner = edges.filter((e) => rank.has(e.from) && rank.has(e.to) && e.change !== 'removed')
  for (let pass = 0; pass < group.length; pass++) {
    let moved = false
    for (const { from, to } of inner) {
      const next = (rank.get(from) ?? 0) + 1
      if (next > (rank.get(to) ?? 0) && next < group.length) {
        rank.set(to, next)
        moved = true
      }
    }
    if (!moved) break
  }
  const reachOf = new Map(group.map((n) => [n.id, reach(n.id, inner)]))
  return [...group].sort(
    (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || (reachOf.get(b.id) ?? 0) - (reachOf.get(a.id) ?? 0) || b.risk - a.risk,
  )
}

function displayName(node: FnNode): string {
  return node.kind === 'function' ? (node.name.split('.').pop() ?? node.name) : node.name
}

// "a → b → c" along the riskiest path from the entry point, skipping repeats of the same name.
function titleOf(ordered: FnNode[], edges: Edge[]): string {
  const ids = new Set(ordered.map((n) => n.id))
  const byId = new Map(ordered.map((n) => [n.id, n]))
  const names: string[] = []
  const visited = new Set<string>()
  for (let node = ordered[0]; node && names.length < 3 && !visited.has(node.id); ) {
    visited.add(node.id)
    if (names.at(-1) !== displayName(node)) names.push(displayName(node))
    const next = edges.filter((e) => e.from === node?.id && ids.has(e.to) && e.change !== 'removed').map((e) => byId.get(e.to) as FnNode)
    node = next.sort((a, b) => b.risk - a.risk)[0]
  }
  if (names.length > 1) return names.join(' → ')
  const files = new Set(ordered.map((n) => n.path))
  const path = ordered[0]?.path ?? ''
  if (files.size === 1) return `${basename(dirname(path))}/${basename(path)}`
  return `${basename(dirname(path))}/ (${files.size} files)`
}

function step(id: string, title: string, nodes: FnNode[]): Step {
  return { id, title, why: null, nodeIds: nodes.map((n) => n.id) }
}

/**
 * Groups changed nodes into reading steps without AI: call-connected code that shares files becomes one step,
 * riskiest step first. Tests and non-code files go last.
 */
export function buildSteps(nodes: FnNode[], edges: Edge[]): Step[] {
  const tests = nodes.filter((n) => n.isTest)
  const files = nodes.filter((n) => !n.isTest && n.kind === 'file')
  const code = nodes.filter((n) => !n.isTest && n.kind !== 'file')
  const groups = components(code, edges).flatMap(splitLarge).map((g) => readingOrder(g, edges))
  groups.sort((a, b) => Math.max(...b.map((n) => n.risk)) - Math.max(...a.map((n) => n.risk)))
  const kept = groups.slice(0, MAX_CODE_STEPS)
  const rest = groups.slice(MAX_CODE_STEPS).flat()
  return [
    ...kept.map((g) => step(`code:${g[0]?.id}`, titleOf(g, edges), g)),
    ...(rest.length ? [step('rest', 'Smaller changes', readingOrder(rest, edges))] : []),
    ...(tests.length ? [step('tests', `Tests (${tests.length})`, readingOrder(tests, edges))] : []),
    ...(files.length ? [step('files', 'Config & other files', files)] : []),
  ]
}
