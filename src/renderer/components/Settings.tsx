import { useEffect, useState, type FormEvent } from 'react'
import type { Provider, Result, Settings as SettingsData } from '../../shared/types'
import { lens } from '../api'
import { CloseIcon, TrashIcon } from '../icons'

interface Props {
  settings: SettingsData
  onChange(settings: SettingsData): void
  onClose(): void
}

interface Draft {
  id: string | null
  name: string
  baseUrl: string
  model: string
  apiKey: string
  hasKey: boolean
}

const PRESETS: Record<'ollama' | 'gateway', Omit<Draft, 'id' | 'hasKey' | 'apiKey'>> = {
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: '' },
  gateway: { name: 'Custom gateway', baseUrl: 'https://', model: '' },
}

function ProviderForm({ initial, onSaved, onCancel }: { initial: Draft; onSaved(s: SettingsData): void; onCancel(): void }) {
  const [draft, setDraft] = useState(initial)
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const fetchModels = async (): Promise<void> => {
    setStatus({ busy: true, error: null })
    const result = await lens.listModels(draft.baseUrl, draft.apiKey || null, draft.id)
    setStatus({ busy: false, error: result.ok ? null : result.error })
    if (!result.ok) return
    setModels(result.value)
    if (!draft.model && result.value[0]) set({ model: result.value[0] })
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setStatus({ busy: true, error: null })
    // An empty key field means "keep the saved key"; there's a separate control to remove it.
    const apiKey = draft.apiKey ? draft.apiKey : draft.hasKey ? undefined : ''
    const result = await lens.saveProvider({ id: draft.id, name: draft.name, baseUrl: draft.baseUrl, model: draft.model, apiKey })
    setStatus({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) onSaved(result.value)
  }

  return (
    <form className="provider-form" onSubmit={(e) => void submit(e)}>
      {!draft.id && (
        <div className="presets">
          {(['ollama', 'gateway'] as const).map((p) => (
            <button type="button" key={p} className={`chip${draft.name === PRESETS[p].name ? ' on' : ''}`} onClick={() => set({ ...PRESETS[p], model: '' })}>
              {p === 'ollama' ? 'Ollama (local)' : 'Custom gateway'}
            </button>
          ))}
        </div>
      )}
      <label>Name<input value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} /></label>
      <label>
        Base URL <span className="muted">OpenAI-compatible, e.g. …/v1</span>
        <input value={draft.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} required type="url" className="mono" />
      </label>
      <label>
        API key <span className="muted">stored encrypted by your OS keychain</span>
        <input
          value={draft.apiKey} onChange={(e) => set({ apiKey: e.target.value })} type="password" autoComplete="off"
          placeholder={draft.hasKey ? 'Saved. Leave blank to keep.' : 'Optional for local models'}
        />
      </label>
      {draft.hasKey && !draft.apiKey && (
        <button type="button" className="link danger" onClick={() => set({ hasKey: false })}>Remove saved key</button>
      )}
      <label>
        Model
        <div className="row">
          <input value={draft.model} onChange={(e) => set({ model: e.target.value })} required list="models" className="mono" placeholder="e.g. qwen2.5-coder:7b" />
          <button type="button" className="btn" onClick={() => void fetchModels()} disabled={status.busy}>Fetch models</button>
        </div>
        <datalist id="models">{models.map((m) => <option key={m} value={m} />)}</datalist>
      </label>
      {status.error && <div className="inline-error">{status.error}</div>}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={status.busy}>Save provider</button>
      </div>
    </form>
  )
}

function toDraft(provider: Provider | null): Draft {
  return provider ? { ...provider, apiKey: '' } : { id: null, ...PRESETS.ollama, apiKey: '', hasKey: false }
}

export function Settings({ settings, onChange, onClose }: Props) {
  const [editing, setEditing] = useState<Draft | null>(settings.providers.length === 0 ? toDraft(null) : null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const apply = async (call: Promise<Result<SettingsData>>): Promise<void> => {
    const result = await call
    setError(result.ok ? null : result.error)
    if (result.ok) onChange(result.value)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="AI providers">
        <header className="modal-head">
          <h2>AI providers</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </header>
        <p className="muted small">Code is sent only to the provider you choose. Use Ollama to keep it on this machine.</p>
        <ul className="providers">
          {settings.providers.map((p) => (
            <li key={p.id} className={p.id === settings.activeProviderId ? 'active' : ''}>
              <label className="provider-pick">
                <input type="radio" name="active" checked={p.id === settings.activeProviderId} onChange={() => void apply(lens.setActiveProvider(p.id))} />
                <span>
                  <b>{p.name}</b>
                  <span className="mono muted small">{p.baseUrl} · {p.model}{p.hasKey ? ' · key saved' : ''}</span>
                </span>
              </label>
              <button className="btn ghost small" onClick={() => setEditing(toDraft(p))}>Edit</button>
              <button className="icon-btn" onClick={() => void apply(lens.deleteProvider(p.id))} aria-label={`Delete ${p.name}`}><TrashIcon /></button>
            </li>
          ))}
        </ul>
        {error && <div className="inline-error">{error}</div>}
        {editing ? (
          <ProviderForm
            key={editing.id ?? 'new'}
            initial={editing}
            onSaved={(s) => {
              onChange(s)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <button className="btn" onClick={() => setEditing(toDraft(null))}>+ Add provider</button>
        )}
      </div>
    </div>
  )
}
