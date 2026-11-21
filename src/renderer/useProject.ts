import { useCallback, useEffect, useState } from 'react'
import type { Analysis, DiffLine, FnNode, Mark, MarkStatus, Mode, ProjectState, Progress, SavedAnalysis, Story } from '../shared/types'
import { lens } from './api'

export interface ProjectView {
  analysis: Analysis | null
  state: ProjectState
  loading: boolean
  progress: Progress | null
  error: string | null
  reload(): void
  setMark(node: FnNode, status: MarkStatus | null): Promise<void>
  saveAnalysis(nodeId: string, analysis: SavedAnalysis): void
  saveStory(story: Story): void
}

const EMPTY: ProjectState = { marks: {}, analyses: {}, story: null }

export function useProject(root: string, mode: Mode, onError: (message: string) => void): ProjectView {
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [state, setState] = useState<ProjectState>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    setProgress(null)
    const off = lens.onProgress((p) => live && setProgress(p))
    void Promise.all([lens.analyze(root, mode), lens.projectState(root)]).then(([result, saved]) => {
      if (!live) return
      setLoading(false)
      if (!result.ok) {
        if (result.error !== 'cancelled') setError(result.error)
        return
      }
      setAnalysis(result.value)
      setState(saved.ok ? saved.value : EMPTY)
      if (!saved.ok) onError(`Couldn't load review progress: ${saved.error}`)
    })
    return () => {
      live = false
      off()
    }
  }, [root, mode, generation, onError])

  const setMark = useCallback(
    async (node: FnNode, status: MarkStatus | null) => {
      const mark = status ? { hash: node.hash, status, at: Date.now() } : null
      const put = (value: Mark | null | undefined) =>
        setState((s) => {
          const marks = { ...s.marks }
          if (value) marks[node.id] = value
          else delete marks[node.id]
          return { ...s, marks }
        })
      const before = state.marks[node.id]
      put(mark)
      const result = await lens.setMark(root, node.id, mark)
      if (!result.ok) {
        put(before)
        onError(`Couldn't save: ${result.error}`)
      }
    },
    [root, onError, state.marks],
  )

  const saveAnalysis = useCallback((nodeId: string, saved: SavedAnalysis) => {
    setState((s) => ({ ...s, analyses: { ...s.analyses, [nodeId]: saved } }))
  }, [])

  const saveStory = useCallback((story: Story) => setState((s) => ({ ...s, story })), [])

  const reload = useCallback(() => setGeneration((g) => g + 1), [])

  return { analysis, state, loading, progress, error, reload, setMark, saveAnalysis, saveStory }
}

/** Lines of one file, merged with its diff. Files that are entirely new render as all-added. */
export function useFileLines(analysis: Analysis | null, path: string | null): DiffLine[] | null {
  const [lines, setLines] = useState<{ path: string; lines: DiffLine[] } | null>(null)
  const file = analysis?.files.find((f) => f.path === path)
  const base = analysis?.git?.base ?? null
  const wholeAdded = analysis?.git !== null && file?.status === 'added'

  useEffect(() => {
    if (!analysis || !path) return
    let live = true
    void lens.fileLines(analysis.root, path, base).then((result) => {
      if (!live) return
      const value = result.ok ? result.value : [{ kind: ' ' as const, no: null, old: null, text: `Couldn't read file: ${result.error}` }]
      const allAdded = wholeAdded && value.every((l) => l.kind === ' ')
      setLines({ path, lines: allAdded ? value.map((l) => ({ ...l, kind: '+' as const })) : value })
    })
    return () => {
      live = false
    }
  }, [analysis, path, base, wholeAdded])

  return lines && lines.path === path ? lines.lines : null
}
