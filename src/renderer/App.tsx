import { useCallback, useEffect, useState } from 'react'
import type { Settings as SettingsData } from '../shared/types'
import { lens } from './api'
import { Settings } from './components/Settings'
import { Welcome } from './components/Welcome'
import { Workspace } from './components/Workspace'

export function App() {
  const [root, setRoot] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const refreshSettings = useCallback(async () => {
    const result = await lens.settings()
    if (result.ok) setSettings(result.value)
    else setToast(result.error)
  }, [])

  useEffect(() => {
    void refreshSettings()
  }, [refreshSettings])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const pick = async (): Promise<void> => {
    const result = await lens.pickFolder()
    if (!result.ok) setToast(result.error)
    else if (result.value) setRoot(result.value)
  }

  const close = (): void => {
    setRoot(null)
    void refreshSettings()
  }

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])
  const provider = settings?.providers.find((p) => p.id === settings.activeProviderId) ?? null

  return (
    <div className="app">
      {root ? (
        <Workspace key={root} root={root} provider={provider} onClose={close} onSettings={openSettings} onError={setToast} />
      ) : (
        <Welcome
          recent={settings?.recent ?? []}
          providerLabel={provider ? `${provider.name} · ${provider.model}` : null}
          onPick={() => void pick()}
          onOpen={setRoot}
          onSettings={openSettings}
        />
      )}
      {settingsOpen && settings && <Settings settings={settings} onChange={setSettings} onClose={closeSettings} />}
      {toast && <div className="toast" role="alert" onClick={() => setToast(null)}>{toast}</div>}
    </div>
  )
}
