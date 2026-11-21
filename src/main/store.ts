import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { Mark, ProjectState, Provider, ProviderInput, SavedAnalysis, Settings, Story } from '../shared/types'

interface StoredProvider extends Omit<Provider, 'hasKey'> {
  encryptedKey: string | null
}

interface StoredSettings {
  providers: StoredProvider[]
  activeProviderId: string | null
  recent: string[]
}

const MAX_RECENT = 12
const MAX_CACHED_PROJECTS = 8

// The main process is the single owner of persisted state: everything is read once into memory,
// mutated synchronously, and written through a per-file queue so writes never interleave.
const writes = new Map<string, Promise<void>>()
let settings: StoredSettings | null = null
const projects = new Map<string, ProjectState>()

function dataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return fallback
    throw error
  }
}

function persist(path: string, data: unknown): Promise<void> {
  const body = JSON.stringify(data)
  const next = (writes.get(path) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${randomUUID()}.tmp`
    await writeFile(temp, body, { mode: 0o600 })
    await rename(temp, path)
  })
  writes.set(path, next.catch(() => undefined))
  return next
}

async function loadSettings(): Promise<StoredSettings> {
  settings ??= await readJson<StoredSettings>(dataPath('settings.json'), { providers: [], activeProviderId: null, recent: [] })
  return settings
}

function publicSettings(stored: StoredSettings): Settings {
  return {
    providers: stored.providers.map(({ encryptedKey, ...rest }) => ({ ...rest, hasKey: encryptedKey !== null })),
    activeProviderId: stored.activeProviderId,
    recent: stored.recent,
  }
}

export async function getSettings(): Promise<Settings> {
  return publicSettings(await loadSettings())
}

async function updateSettings(change: (s: StoredSettings) => void): Promise<Settings> {
  const stored = await loadSettings()
  change(stored)
  await persist(dataPath('settings.json'), stored)
  return publicSettings(stored)
}

export function addRecent(root: string): Promise<Settings> {
  return updateSettings((s) => {
    s.recent = [root, ...s.recent.filter((r) => r !== root)].slice(0, MAX_RECENT)
  })
}

export async function isKnownRoot(root: string): Promise<boolean> {
  return (await loadSettings()).recent.includes(root)
}

function encryptKey(apiKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is unavailable on this system; API keys cannot be saved.')
  return safeStorage.encryptString(apiKey).toString('base64')
}

export function saveProvider(input: ProviderInput): Promise<Settings> {
  return updateSettings((s) => {
    const existing = s.providers.find((p) => p.id === input.id)
    const encryptedKey = input.apiKey === undefined ? (existing?.encryptedKey ?? null) : input.apiKey ? encryptKey(input.apiKey) : null
    const provider: StoredProvider = { id: existing?.id ?? randomUUID(), name: input.name, baseUrl: input.baseUrl, model: input.model, encryptedKey }
    s.providers = existing ? s.providers.map((p) => (p === existing ? provider : p)) : [...s.providers, provider]
    s.activeProviderId ??= provider.id
  })
}

export function deleteProvider(id: string): Promise<Settings> {
  return updateSettings((s) => {
    s.providers = s.providers.filter((p) => p.id !== id)
    if (s.activeProviderId === id) s.activeProviderId = s.providers[0]?.id ?? null
  })
}

export function setActiveProvider(id: string): Promise<Settings> {
  return updateSettings((s) => {
    if (s.providers.some((p) => p.id === id)) s.activeProviderId = id
  })
}

export interface ResolvedProvider {
  name: string
  baseUrl: string
  model: string
  apiKey: string | null
}

export async function resolveProvider(id: string | null): Promise<ResolvedProvider | null> {
  const stored = await loadSettings()
  const provider = stored.providers.find((p) => p.id === (id ?? stored.activeProviderId))
  if (!provider) return null
  const apiKey = provider.encryptedKey ? safeStorage.decryptString(Buffer.from(provider.encryptedKey, 'base64')) : null
  return { name: provider.name, baseUrl: provider.baseUrl, model: provider.model, apiKey }
}

function projectPath(root: string): string {
  return dataPath('projects', `${createHash('sha1').update(root).digest('hex')}.json`)
}

export async function getProject(root: string): Promise<ProjectState> {
  let state = projects.get(root)
  if (!state) {
    state = { marks: {}, analyses: {}, story: null, ...(await readJson<Partial<ProjectState>>(projectPath(root), {})) }
    projects.set(root, state)
    if (projects.size > MAX_CACHED_PROJECTS) projects.delete(projects.keys().next().value as string)
  }
  return state
}

export async function setMark(root: string, id: string, mark: Mark | null): Promise<void> {
  const state = await getProject(root)
  if (mark) state.marks[id] = mark
  else delete state.marks[id]
  await persist(projectPath(root), state)
}

export async function saveAnalysis(root: string, id: string, analysis: SavedAnalysis): Promise<void> {
  const state = await getProject(root)
  state.analyses[id] = analysis
  await persist(projectPath(root), state)
}

export async function saveStory(root: string, story: Story): Promise<void> {
  const state = await getProject(root)
  state.story = story
  await persist(projectPath(root), state)
}

/** Drops cached AI analyses of code that has since changed. */
export async function pruneAnalyses(root: string, live: Map<string, string>): Promise<void> {
  const state = await getProject(root)
  const stale = Object.keys(state.analyses).filter((id) => live.has(id) && live.get(id) !== state.analyses[id]?.hash)
  if (stale.length === 0) return
  for (const id of stale) delete state.analyses[id]
  await persist(projectPath(root), state)
}
