import { FolderIcon, LensLogo } from '../icons'

interface Props {
  recent: string[]
  providerLabel: string | null
  onPick(): void
  onOpen(root: string): void
  onSettings(): void
}

export function Welcome({ recent, providerLabel, onPick, onOpen, onSettings }: Props) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <LensLogo size={48} />
        <h1>Grasp</h1>
        <p className="muted">Understand every change before you merge it.</p>
        <button className="btn primary large" onClick={onPick}><FolderIcon /> Open project…</button>
        <p className="welcome-hint muted">
          In a git repository, Grasp loads your branch's changes (or only uncommitted ones). Anywhere else it loads the whole
          project, and then tracks what changed since you last reviewed it.
        </p>
        {recent.length > 0 && (
          <div className="recent">
            <h3>Recent</h3>
            <ul>
              {recent.map((root) => (
                <li key={root}>
                  <button onClick={() => onOpen(root)}>
                    <span className="recent-name">{root.split(/[\\/]/).pop()}</span>
                    <span className="recent-path mono">{root}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button className="link" onClick={onSettings}>{providerLabel ? `AI: ${providerLabel}` : 'Set up AI (Ollama or a custom gateway)'}</button>
      </div>
    </div>
  )
}
