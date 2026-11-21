export type Mode = 'branch' | 'uncommitted' | 'all'
export type Tier = 'critical' | 'high' | 'medium' | 'low'
export type Sink = 'money' | 'auth' | 'persistence' | 'network'
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary'

export type Change = 'added' | 'modified' | 'removed'
export type EdgeChange = 'added' | 'removed' | 'same'

/** What a function does structurally, so before/after can be compared without reading lines. */
export interface Shape {
  signature: string
  /** Names it calls, deduplicated. */
  calls: string[]
  /** return / throw / raise statements. */
  exits: number
  complexity: number
}

export interface FnNode {
  id: string
  name: string
  /** module = top-level code of a source file; file = a non-code file. */
  kind: 'function' | 'module' | 'file'
  path: string
  /** Lines in the current file, or in the base file for removed functions. */
  startLine: number
  endLine: number
  hash: string
  added: number
  removed: number
  change: Change
  /** null when there is no earlier version to compare with. */
  before: Shape | null
  /** null for removed functions and for non-function nodes. */
  after: Shape | null
  callers: number
  sinks: Sink[]
  /** Call sites in test files; null when tests don't apply (test code itself, non-code files). */
  tests: number | null
  isTest: boolean
  risk: number
  tier: Tier
}

export interface FileEntry {
  path: string
  status: FileStatus
  added: number
  removed: number
}

export interface Edge {
  from: string
  to: string
  change: EdgeChange
}

export interface Step {
  id: string
  title: string
  /** Why this step matters; only an AI story provides one. */
  why: string | null
  nodeIds: string[]
}

export interface GitInfo {
  branch: string
  /** Commit the diff is taken against; null when the repository has no commits. */
  base: string | null
  baseLabel: string
}

export interface Analysis {
  root: string
  name: string
  mode: Mode
  git: GitInfo | null
  files: FileEntry[]
  /** Changed code to review. */
  nodes: FnNode[]
  /** Unchanged functions that call or are called by changed ones, shown for orientation. */
  context: FnNode[]
  edges: Edge[]
  /** Deterministic grouping of `nodes` into reading steps. */
  steps: Step[]
  skippedFiles: number
}

export interface DiffLine {
  kind: '+' | '-' | ' '
  /** Line number in the current file; null for removed lines. */
  no: number | null
  /** Line number in the base file; null for added lines and files without a base. */
  old: number | null
  text: string
}

export type MarkStatus = 'understood' | 'flagged'

export interface Mark {
  hash: string
  status: MarkStatus
  at: number
}

export interface SavedAnalysis {
  hash: string
  model: string
  text: string
}

export interface Story {
  /** Identifies the change set the story was written for. */
  key: string
  model: string
  summary: string
  steps: Step[]
}

export interface ProjectState {
  marks: Record<string, Mark>
  analyses: Record<string, SavedAnalysis>
  story: Story | null
}

export interface Provider {
  id: string
  name: string
  baseUrl: string
  model: string
  hasKey: boolean
}

export interface Settings {
  providers: Provider[]
  activeProviderId: string | null
  recent: string[]
}

export interface ProviderInput {
  id: string | null
  name: string
  baseUrl: string
  model: string
  /** undefined keeps the stored key, '' removes it. */
  apiKey?: string
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface Progress {
  done: number
  total: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

export interface LensApi {
  pickFolder(): Promise<Result<string | null>>
  analyze(root: string, mode: Mode): Promise<Result<Analysis>>
  onProgress(listener: (progress: Progress) => void): () => void
  fileLines(root: string, path: string, base: string | null): Promise<Result<DiffLine[]>>
  projectState(root: string): Promise<Result<ProjectState>>
  setMark(root: string, id: string, mark: Mark | null): Promise<Result<null>>
  settings(): Promise<Result<Settings>>
  saveProvider(input: ProviderInput): Promise<Result<Settings>>
  deleteProvider(id: string): Promise<Result<Settings>>
  setActiveProvider(id: string): Promise<Result<Settings>>
  listModels(baseUrl: string, apiKey: string | null, providerId: string | null): Promise<Result<string[]>>
  explain(root: string, nodeId: string, hash: string, messages: ChatMessage[]): Promise<Result<SavedAnalysis>>
  onExplainDelta(listener: (nodeId: string, text: string) => void): () => void
  cancelExplain(): Promise<Result<null>>
  /** `nodeIds[i]` is the node the prompt refers to as `n<i>`. */
  story(root: string, key: string, nodeIds: string[], messages: ChatMessage[]): Promise<Result<Story>>
}
