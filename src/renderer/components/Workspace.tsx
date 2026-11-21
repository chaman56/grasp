import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FnNode, MarkStatus, Mode, Provider } from '../../shared/types'
import { Flow } from '../graph/Flow'
import { activeSteps, reviewState, walkOrder } from '../review'
import { useFileLines, useProject } from '../useProject'
import { FileView } from './FileView'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { StoryPanel } from './StoryPanel'
import { TopBar, type View } from './TopBar'

interface Props {
  root: string
  provider: Provider | null
  onClose(): void
  onSettings(): void
  onError(message: string): void
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

export function Workspace({ root, provider, onClose, onSettings, onError }: Props) {
  const [mode, setMode] = useState<Mode>('branch')
  const project = useProject(root, mode, onError)
  const { analysis, state, setMark } = project
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stepId, setStepId] = useState<string | null>(null)
  const [view, setView] = useState<View>('map')

  const { steps, story } = useMemo(() => (analysis ? activeSteps(analysis, state.story) : { steps: [], story: null }), [analysis, state.story])
  const ordered = useMemo(() => (analysis ? walkOrder(steps, analysis.nodes) : []), [analysis, steps])
  const stepOf = useMemo(() => new Map(steps.flatMap((s) => s.nodeIds.map((id) => [id, s.id] as const))), [steps])
  const currentStep = steps.find((s) => s.id === stepId) ?? steps[0] ?? null
  const selected = analysis?.nodes.find((n) => n.id === selectedId) ?? null
  const fileLines = useFileLines(analysis, selected?.path ?? null)
  const understood = ordered.filter((n) => reviewState(n, state.marks) === 'understood').length

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      const owner = id ? stepOf.get(id) : undefined
      if (owner) setStepId(owner)
    },
    [stepOf],
  )

  const openStep = (id: string) => {
    setStepId(id)
    const nodes = walkOrder(steps.filter((s) => s.id === id), analysis?.nodes ?? [])
    setSelectedId((nodes.find((n) => reviewState(n, state.marks) !== 'understood') ?? nodes[0])?.id ?? null)
  }

  useEffect(() => {
    if (!analysis || analysis.nodes.some((n) => n.id === selectedId)) return
    select(ordered.find((n) => reviewState(n, state.marks) !== 'understood')?.id ?? null)
    // Only pick a default when a new analysis or story arrives, not on every mark.
  }, [analysis, ordered])

  const next = useCallback(
    (from: FnNode | null, delta: 1 | -1, onlyPending: boolean) => {
      const start = from ? ordered.findIndex((n) => n.id === from.id) : -1
      for (let i = 1; i <= ordered.length; i++) {
        const candidate = ordered[(start + delta * i + ordered.length * 2) % ordered.length]
        if (candidate && candidate.id !== from?.id && (!onlyPending || reviewState(candidate, state.marks) !== 'understood')) return candidate
      }
      return null
    },
    [ordered, state.marks],
  )

  const mark = useCallback(
    (node: FnNode, status: MarkStatus | null) => {
      void setMark(node, status)
      if (status === 'understood') select(next(node, 1, true)?.id ?? node.id)
    },
    [setMark, next, select],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey) return
      if (e.metaKey) {
        if (e.key === 'r') {
          e.preventDefault()
          project.reload()
        }
        return
      }
      const review = selected ? reviewState(selected, state.marks) : null
      if (e.key === 'u' && selected) mark(selected, review === 'understood' ? null : 'understood')
      else if (e.key === 'f' && selected) mark(selected, review === 'flagged' ? null : 'flagged')
      else if (e.key === 'j' || e.key === 'k') select(next(selected, e.key === 'j' ? 1 : -1, false)?.id ?? selectedId)
      else if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, selectedId, state.marks, mark, next, select, project.reload])

  return (
    <div className="workspace">
      <TopBar
        name={root.split(/[\\/]/).pop() ?? root} analysis={analysis} mode={mode} view={view}
        understood={understood} total={ordered.length} loading={project.loading}
        onMode={setMode} onView={setView} onReload={project.reload} onSettings={onSettings} onClose={onClose}
      />
      {!analysis ? (
        <Loading error={project.error} loading={project.loading} progress={project.progress} onRetry={project.reload} onClose={onClose} />
      ) : (
        <>
          <div className="main">
            <StoryPanel
              analysis={analysis} steps={steps} story={story} storyOutdated={!story && state.story !== null}
              marks={state.marks} stepId={currentStep?.id ?? null} selectedId={selectedId} provider={provider}
              onStep={openStep} onSelect={select} onStory={project.saveStory} onOpenSettings={onSettings}
            />
            <div className="stage">
              {view === 'code' ? (
                <FileView file={analysis.files.find((f) => f.path === selected?.path)} node={selected} lines={fileLines} />
              ) : currentStep ? (
                <Flow analysis={analysis} steps={steps} step={currentStep} marks={state.marks} selectedId={selectedId} onSelect={select} />
              ) : (
                <div className="canvas-empty">No changes here.</div>
              )}
              {project.loading && <div className="stage-loading"><Progress progress={project.progress} /></div>}
              {project.error && <div className="stage-error inline-error">{project.error}</div>}
            </div>
            {selected ? (
              <Inspector
                analysis={analysis} node={selected} fileLines={fileLines}
                marks={state.marks} saved={state.analyses[selected.id]} provider={provider}
                onMark={mark} onSelect={select} onSaved={project.saveAnalysis} onOpenSettings={onSettings}
              />
            ) : (
              <aside className="inspector inspector-empty muted">
                {ordered.length === 0 ? 'No changed functions to review.' : 'Select a card to see what changed. J / K walks through the steps.'}
              </aside>
            )}
          </div>
          <StatusBar analysis={analysis} nodes={ordered} marks={state.marks} />
        </>
      )}
    </div>
  )
}

function Progress({ progress }: { progress: { done: number; total: number } | null }) {
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : null
  return (
    <div className="progress">
      <span>{pct === null ? 'Reading changes…' : `Analyzing ${progress?.done} of ${progress?.total} files`}</span>
      <div className="bar"><div style={{ width: `${pct ?? 8}%` }} /></div>
    </div>
  )
}

function Loading({ error, loading, progress, onRetry, onClose }: { error: string | null; loading: boolean; progress: { done: number; total: number } | null; onRetry(): void; onClose(): void }) {
  return (
    <div className="loading-screen">
      {loading ? <Progress progress={progress} /> : (
        <div className="welcome-card">
          <h2>Couldn't analyze this folder</h2>
          <div className="inline-error">{error}</div>
          <div className="form-actions">
            <button className="btn ghost" onClick={onClose}>Back</button>
            <button className="btn primary" onClick={onRetry}>Try again</button>
          </div>
        </div>
      )}
    </div>
  )
}
