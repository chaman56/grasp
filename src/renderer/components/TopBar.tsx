import type { Analysis, Mode } from '../../shared/types'
import { ChevronIcon, FolderIcon, GearIcon, LensLogo, RefreshIcon } from '../icons'

export type View = 'map' | 'code'

interface Props {
  name: string
  analysis: Analysis | null
  mode: Mode
  view: View
  understood: number
  total: number
  loading: boolean
  onMode(mode: Mode): void
  onView(view: View): void
  onReload(): void
  onSettings(): void
  onClose(): void
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.id} role="tab" aria-selected={o.id === value} className={o.id === value ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function TopBar(props: Props) {
  const { analysis, total, understood } = props
  const git = analysis?.git
  return (
    <header className="topbar">
      <div className="brand"><LensLogo /> <span>Grasp</span></div>
      <ChevronIcon />
      <div className="crumbs">
        <button className="crumb-project" onClick={props.onClose} title="Switch project">{props.name}</button>
        {git && <span className="muted">/ <span className="mono">{git.branch}</span> · {git.baseLabel}</span>}
        {analysis && !git && <span className="muted">· no git · whole project</span>}
      </div>
      {git && (
        <Segmented
          value={props.mode}
          options={[{ id: 'branch', label: 'Branch' }, { id: 'uncommitted', label: 'Uncommitted' }]}
          onChange={props.onMode}
        />
      )}
      <div className="topbar-center">
        <Segmented value={props.view} options={[{ id: 'map', label: 'Map' }, { id: 'code', label: git ? 'Diff' : 'Code' }]} onChange={props.onView} />
      </div>
      <div className="progress-pill" title={`${understood} of ${total} understood`}>
        <span>{understood} of {total} nodes understood</span>
        <div className="bar"><div style={{ width: `${total ? (understood / total) * 100 : 0}%` }} /></div>
      </div>
      <button className={`icon-btn${props.loading ? ' spinning' : ''}`} onClick={props.onReload} aria-label="Re-analyze (⌘R)" title="Re-analyze (⌘R)"><RefreshIcon /></button>
      <button className="icon-btn" onClick={props.onSettings} aria-label="AI settings" title="AI settings"><GearIcon /></button>
      <button className="icon-btn" onClick={props.onClose} aria-label="Open another project" title="Open another project"><FolderIcon /></button>
    </header>
  )
}
