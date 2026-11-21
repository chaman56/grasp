import type { Analysis, Edge, FnNode, Step } from '../../shared/types'

export const CARD_W = 290
export const CARD_H = 62
const COL_GAP = 92
const ROW_GAP = 22
const MAX_ROWS = 8
const WRAP_GAP = 28
const MAX_CONTEXT = 24

/** step = part of the current step; elsewhere = changed, but read in another step; context = unchanged code. */
export type Role = 'step' | 'elsewhere' | 'context'

export interface FlowItem {
  node: FnNode
  role: Role
  /** Index of the step an `elsewhere` node belongs to. */
  stepIndex: number | null
  x: number
  y: number
}

export interface Flow {
  items: FlowItem[]
  edges: Edge[]
}

/** The current step's nodes plus whatever they call or are called by, so the step reads as a flow. */
function neighbourhood(step: Step, steps: Step[], analysis: Analysis): { items: Omit<FlowItem, 'x' | 'y'>[]; edges: Edge[] } {
  const inStep = new Set(step.nodeIds)
  const stepOf = new Map(steps.flatMap((s, i) => s.nodeIds.map((id) => [id, i] as const)))
  const changed = new Map(analysis.nodes.map((n) => [n.id, n]))
  const unchanged = new Map(analysis.context.map((n) => [n.id, n]))
  const items = new Map(step.nodeIds.flatMap((id) => {
    const node = changed.get(id)
    return node ? [[id, { node, role: 'step' as Role, stepIndex: null as number | null }] as const] : []
  }))
  const edges: Edge[] = []
  for (const edge of analysis.edges) {
    if (!inStep.has(edge.from) && !inStep.has(edge.to)) continue
    const otherId = inStep.has(edge.from) ? edge.to : edge.from
    // Unchanged code is shown only as a caller, or where a call to it was added or removed.
    if (unchanged.has(otherId) && inStep.has(edge.from) && edge.change === 'same') continue
    if (!items.has(otherId)) {
      const other = changed.get(otherId) ?? unchanged.get(otherId)
      // Tests are summarised on each card unless we are reading the tests themselves.
      if (!other || (other.isTest && !step.nodeIds.some((id) => changed.get(id)?.isTest)) || items.size >= step.nodeIds.length + MAX_CONTEXT) continue
      const isChanged = changed.has(otherId)
      items.set(otherId, { node: other, role: isChanged ? 'elsewhere' : 'context', stepIndex: isChanged ? (stepOf.get(otherId) ?? null) : null })
    }
    edges.push(edge)
  }
  return { items: [...items.values()], edges }
}

// Longest path from an entry point decides the column; bounded so cycles terminate.
function columns(ids: string[], edges: Edge[]): Map<string, number> {
  const rank = new Map(ids.map((id) => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false
    for (const { from, to } of edges) {
      const next = (rank.get(from) ?? 0) + 1
      if (rank.has(to) && next > (rank.get(to) ?? 0) && next < ids.length) {
        rank.set(to, next)
        moved = true
      }
    }
    if (!moved) break
  }
  return rank
}

// Items with no calls in or out (config files, standalone functions) sit in a grid above the flow.
function placeIsolated(isolated: Omit<FlowItem, 'x' | 'y'>[], top: number): FlowItem[] {
  const perRow = Math.min(4, Math.max(1, isolated.length))
  const rows = Math.ceil(isolated.length / perRow)
  return isolated.map((item, i) => ({
    ...item,
    x: (i % perRow) * (CARD_W + WRAP_GAP),
    y: top - (rows - Math.floor(i / perRow)) * (CARD_H + ROW_GAP) - COL_GAP / 2,
  }))
}

/** Lays the step out left → right by call depth; rows follow their callers to keep edges short. */
export function stepFlow(step: Step, steps: Step[], analysis: Analysis): Flow {
  const { items: all, edges } = neighbourhood(step, steps, analysis)
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]))
  const items = all.filter((i) => linked.has(i.node.id))
  const rank = columns(items.map((i) => i.node.id), edges)
  const byColumn = new Map<number, typeof items>()
  for (const item of items) {
    const col = rank.get(item.node.id) ?? 0
    byColumn.set(col, [...(byColumn.get(col) ?? []), item])
  }
  const yOf = new Map<string, number>()
  const placed: FlowItem[] = []
  let x = 0
  for (const col of [...byColumn.keys()].sort((a, b) => a - b)) {
    const list = byColumn.get(col) ?? []
    const anchor = (item: (typeof items)[number]) => {
      const parents = edges.filter((e) => e.to === item.node.id && yOf.has(e.from)).map((e) => yOf.get(e.from) as number)
      return parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : Number.MAX_SAFE_INTEGER
    }
    list.sort((a, b) => anchor(a) - anchor(b) || (a.role === 'step' ? -1 : 1) - (b.role === 'step' ? -1 : 1) || b.node.risk - a.node.risk)
    // Tall columns wrap into side-by-side sub-columns.
    const wraps = Math.ceil(list.length / MAX_ROWS)
    const perColumn = Math.ceil(list.length / wraps)
    list.forEach((item, i) => {
      const sub = Math.floor(i / perColumn)
      const inSub = Math.min(perColumn, list.length - sub * perColumn)
      const y = ((i % perColumn) - (inSub - 1) / 2) * (CARD_H + ROW_GAP)
      yOf.set(item.node.id, y)
      placed.push({ ...item, x: x + sub * (CARD_W + WRAP_GAP), y })
    })
    x += wraps * (CARD_W + WRAP_GAP) - WRAP_GAP + COL_GAP
  }
  const top = placed.length ? Math.min(...placed.map((p) => p.y)) : 0
  return { items: [...placeIsolated(all.filter((i) => !linked.has(i.node.id)), top), ...placed], edges }
}
