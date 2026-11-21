import type { Edge, FnNode } from '../../shared/types'

interface Props {
  node: FnNode
  /** Changed or context nodes this one is linked to, for clickable call chips. */
  linked: Map<string, FnNode>
  edges: Edge[]
  hasBase: boolean
  onSelect(id: string): void
}

function Delta({ label, before, after }: { label: string; before: number | undefined; after: number | undefined }) {
  const diff = before !== undefined && after !== undefined ? after - before : 0
  return (
    <div className="delta">
      <span className="delta-label">{label}</span>
      <span className="delta-value mono">
        {before !== undefined && after !== undefined && before !== after ? `${before} → ${after}` : (after ?? before ?? '—')}
        {diff !== 0 && <b className={diff > 0 ? 'up' : 'down'}>{diff > 0 ? `+${diff}` : diff}</b>}
      </span>
    </div>
  )
}

/** Structural before/after of one function: what it calls, how it exits, how much it branches. */
export function Behaviour({ node, linked, edges, hasBase, onSelect }: Props) {
  const { before, after } = node
  if (!before && !after) return null
  const added = after?.calls.filter((c) => !before?.calls.includes(c)) ?? []
  const removed = before?.calls.filter((c) => !after?.calls.includes(c)) ?? []
  const kept = after?.calls.filter((c) => before?.calls.includes(c)) ?? []
  const target = (name: string) =>
    edges.map((e) => (e.from === node.id ? linked.get(e.to) : undefined)).find((n) => n && n.name.split('.').pop() === name)
  const chip = (name: string, kind: 'added' | 'removed' | 'same') => {
    const to = target(name)
    return (
      <button key={`${kind}:${name}`} className={`call-chip ${kind}${to ? ' linked' : ''}`} disabled={!to} onClick={() => to && onSelect(to.id)}>
        {kind === 'added' ? '+ ' : kind === 'removed' ? '− ' : ''}{name}
      </button>
    )
  }
  const signatureChanged = before && after && before.signature !== after.signature
  return (
    <div className="behaviour">
      <div className="sig mono">
        {signatureChanged && <div className="sig-before">{before.signature}</div>}
        <div className={signatureChanged ? 'sig-after' : node.change === 'removed' ? 'sig-before' : ''}>{(after ?? before)?.signature}</div>
      </div>
      <div className="calls">
        <span className="delta-label">Calls <span className="muted">· solid = code in this repo, click to jump</span></span>
        <div className="call-chips">
          {(hasBase ? [...added.map((c) => [c, 'added'] as const), ...removed.map((c) => [c, 'removed'] as const)] : kept.concat(added).map((c) => [c, 'same'] as const))
            .sort(([a], [b]) => Number(Boolean(target(b))) - Number(Boolean(target(a))))
            .map(([name, kind]) => chip(name, kind))}
          {hasBase && added.length + removed.length === 0 && <span className="muted small">no change in what it calls</span>}
        </div>
        {hasBase && kept.length > 0 && <div className="calls-kept muted small">still calls {kept.join(', ')}</div>}
      </div>
      <div className="deltas">
        <Delta label="Exits (return / throw)" before={before?.exits} after={after?.exits} />
        <Delta label="Complexity" before={before?.complexity} after={after?.complexity} />
        <Delta label="Call sites" before={undefined} after={node.callers} />
        <Delta label="Tests calling it" before={undefined} after={node.tests ?? undefined} />
      </div>
    </div>
  )
}
