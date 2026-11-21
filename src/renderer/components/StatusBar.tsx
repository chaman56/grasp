import type { Analysis, FnNode, Mark } from '../../shared/types'
import { reviewMinutes, reviewState } from '../review'

export function StatusBar({ analysis, nodes, marks }: { analysis: Analysis; nodes: FnNode[]; marks: Record<string, Mark> }) {
  const pending = nodes.filter((n) => reviewState(n, marks) !== 'understood')
  const parts = [
    `${nodes.length} nodes`,
    `${nodes.filter((n) => n.tier === 'critical').length} critical`,
    `${nodes.filter((n) => n.tests === 0).length} untested`,
    `${pending.length} to review`,
  ]
  return (
    <footer className="statusbar">
      {parts.map((p) => <span key={p}>{p}</span>)}
      <span>estimated review time <b>{reviewMinutes(pending)} min</b></span>
      {analysis.skippedFiles > 0 && <span className="warn">{analysis.skippedFiles} files not analyzed (5,000-file limit)</span>}
      <span className="grow" />
      <span className="muted">call edges are name-matched heuristics</span>
    </footer>
  )
}
