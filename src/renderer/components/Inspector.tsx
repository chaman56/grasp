import type { Analysis, DiffLine, FnNode, Mark, MarkStatus, Provider, SavedAnalysis } from '../../shared/types'
import { CheckIcon, CloseIcon, FlagIcon } from '../icons'
import { CHANGE_LABEL, displayName, reviewState, sliceLines, TIER_LABEL } from '../review'
import { AiPanel } from './AiPanel'
import { Behaviour } from './Behaviour'
import { CodeLines } from './CodeLines'

interface Props {
  analysis: Analysis
  node: FnNode
  fileLines: DiffLine[] | null
  marks: Record<string, Mark>
  saved: SavedAnalysis | undefined
  provider: Provider | null
  onMark(node: FnNode, status: MarkStatus | null): void
  onSelect(id: string | null): void
  onSaved(nodeId: string, analysis: SavedAnalysis): void
  onOpenSettings(): void
}

const KIND_NOTE = { module: 'Top-level code of this file (imports, properties, declarations).', file: 'Non-code file.' }

export function Inspector(props: Props) {
  const { analysis, node, marks, onMark } = props
  const linked = new Map([...analysis.nodes, ...analysis.context].map((n) => [n.id, n]))
  const callers = analysis.edges.filter((e) => e.to === node.id).flatMap((e) => linked.get(e.from) ?? [])
  const callees = analysis.edges.filter((e) => e.from === node.id).flatMap((e) => linked.get(e.to) ?? [])
  const review = reviewState(node, marks)
  const lines = props.fileLines ? sliceLines(props.fileLines, node) : null
  const hasBase = Boolean(analysis.git?.base)

  return (
    <aside className="inspector">
      <header className="insp-head">
        <div className="insp-title">
          <h2 className="mono">{displayName(node)}</h2>
          <span className="insp-path mono">{node.path}:{node.startLine}</span>
        </div>
        {analysis.git && <span className={`change-tag large ${node.change}`}>{CHANGE_LABEL[node.change]}</span>}
        <div className={`risk-badge tier-${node.tier}`} title={node.sinks.length ? `Touches ${node.sinks.join(', ')}` : undefined}>
          <span>{TIER_LABEL[node.tier].toUpperCase()}</span>
          <b>{node.risk}</b>
        </div>
        <button className="icon-btn close" onClick={() => props.onSelect(null)} aria-label="Close inspector"><CloseIcon /></button>
      </header>

      <div className="insp-body">
        {review === 'changed' && <div className="notice amber">Changed since you last reviewed it. Review again.</div>}
        {review === 'flagged' && <div className="notice red">Flagged for the author.</div>}

        <section>
          <h3>What changed</h3>
          {node.kind === 'function' ? (
            <Behaviour node={node} linked={linked} edges={analysis.edges} hasBase={hasBase} onSelect={props.onSelect} />
          ) : (
            <p className="muted small">{KIND_NOTE[node.kind]}</p>
          )}
          {node.sinks.length > 0 && <p className="sinks small">Touches <b>{node.sinks.join(', ')}</b></p>}
        </section>

        <section>
          <h3>In plain words</h3>
          <AiPanel
            key={node.id}
            root={analysis.root} node={node} lines={lines} callers={callers} callees={callees}
            saved={props.saved} provider={props.provider} onSaved={props.onSaved} onOpenSettings={props.onOpenSettings}
          />
        </section>

        <details className="code-section" key={node.id} open>
          <summary><h3>Code <span className="muted">+{node.added} −{node.removed}</span></h3></summary>
          {lines ? <CodeLines lines={lines} /> : <div className="skeleton" />}
        </details>
      </div>

      <footer className="insp-foot">
        {review === 'understood' ? (
          <button className="btn success-outline" onClick={() => onMark(node, null)}><CheckIcon /> Understood · undo</button>
        ) : (
          <button className="btn success" onClick={() => onMark(node, 'understood')}><CheckIcon /> Mark as understood <kbd>U</kbd></button>
        )}
        <button className={`btn outline${review === 'flagged' ? ' active' : ''}`} onClick={() => onMark(node, review === 'flagged' ? null : 'flagged')}>
          <FlagIcon /> {review === 'flagged' ? 'Unflag' : 'Flag for author'} <kbd>F</kbd>
        </button>
      </footer>
    </aside>
  )
}
