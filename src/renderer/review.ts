import type { Analysis, DiffLine, FnNode, Mark, Step, Story, Tier } from '../shared/types'

export type ReviewState = 'understood' | 'flagged' | 'changed' | 'unreviewed'

export const TIER_LABEL: Record<Tier, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
export const CHANGE_LABEL = { added: 'NEW', modified: 'MOD', removed: 'DEL' } as const

/** A mark only counts while the code it was made on is unchanged. */
export function reviewState(node: FnNode, marks: Record<string, Mark>): ReviewState {
  const mark = marks[node.id]
  if (!mark) return 'unreviewed'
  return mark.hash === node.hash ? mark.status : 'changed'
}

/** `Owner.method()` for functions, so same-named methods on different types stay distinguishable. */
export function displayName(node: FnNode): string {
  return node.kind === 'function' ? `${node.name.split('.').slice(-2).join('.')}()` : node.name
}

/** Identifies a change set, so a saved AI story is only reused for exactly the code it was written for. */
export function changeKey(nodes: FnNode[]): string {
  let hash = 0x811c9dc5
  for (const n of nodes) {
    for (const ch of `${n.id}:${n.hash};`) hash = Math.imul(hash ^ ch.charCodeAt(0), 0x01000193) >>> 0
  }
  return `${nodes.length}-${hash.toString(16)}`
}

/** The AI story when it was written for this exact change set, else the deterministic steps. */
export function activeSteps(analysis: Analysis, story: Story | null): { steps: Step[]; story: Story | null } {
  const current = story && story.key === changeKey(analysis.nodes) ? story : null
  return { steps: current?.steps ?? analysis.steps, story: current }
}

/** The highest-risk node in a set, used to summarise a step. */
export function riskiest(nodes: FnNode[]): FnNode | null {
  return nodes.reduce<FnNode | null>((top, n) => (!top || n.risk > top.risk ? n : top), null)
}

/** Nodes in walkthrough order: step by step, in each step's reading order. */
export function walkOrder(steps: Step[], nodes: FnNode[]): FnNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return steps.flatMap((s) => s.nodeIds.flatMap((id) => byId.get(id) ?? []))
}

/** The lines of `node` within a file's lines, keeping removed lines that fall inside it. */
export function sliceLines(lines: DiffLine[], node: FnNode): DiffLine[] {
  if (node.kind !== 'function') return lines
  // Removed functions only exist in the base file, so they are located by base line numbers.
  const at = node.change === 'removed' ? (l: DiffLine) => l.old : (l: DiffLine) => l.no
  let first = lines.findIndex((l) => at(l) === node.startLine)
  const last = lines.findLastIndex((l) => at(l) === node.endLine)
  if (first === -1 || last === -1) return []
  // Lines removed right above the first line were replaced by it, so they belong to this node.
  while (node.change !== 'removed' && first > 0 && lines[first - 1]?.kind === '-') first -= 1
  return lines.slice(first, last + 1)
}

// ~400 reviewed lines per hour is the commonly cited ceiling for careful review.
export function reviewMinutes(nodes: FnNode[]): number {
  const lines = nodes.reduce((sum, n) => sum + n.added + n.removed, 0)
  return Math.ceil((lines / 400) * 60)
}
