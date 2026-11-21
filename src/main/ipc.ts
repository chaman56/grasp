import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { DiffLine, Result } from '../shared/types'
import { listModels, streamChat } from './ai'
import { analyze, Cancelled } from './analyze'
import { parseDiff } from './diff'
import { diffAgainst } from './git'
import { parseStory } from './story'
import * as store from './store'

const root = z.string().min(1).refine(isAbsolute)
const relativePath = z.string().min(1).refine((p) => !isAbsolute(p) && !normalize(p).split(sep).includes('..'))
const commit = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/)
const httpUrl = z.url({ protocol: /^https?$/ })
const mode = z.enum(['branch', 'uncommitted', 'all'])
const mark = z.object({ hash: z.string(), status: z.enum(['understood', 'flagged']), at: z.number() })
const provider = z.object({
  id: z.string().nullable(),
  name: z.string().trim().min(1).max(80),
  baseUrl: httpUrl,
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().max(4096).optional(),
})
const messages = z.array(z.object({ role: z.enum(['system', 'user']), content: z.string().max(200_000) })).min(1)

function handle<A extends z.ZodType[], T>(
  channel: string,
  args: [...A],
  run: (event: IpcMainInvokeEvent, ...values: { [K in keyof A]: z.infer<A[K]> }) => Promise<T>,
): void {
  const schema = z.tuple(args as unknown as [z.ZodType, ...z.ZodType[]])
  ipcMain.handle(channel, async (event, ...raw: unknown[]): Promise<Result<T>> => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: `Invalid request to ${channel}` }
    try {
      return { ok: true, value: await run(event, ...(parsed.data as { [K in keyof A]: z.infer<A[K]> })) }
    } catch (error) {
      if (error instanceof Cancelled || (error instanceof Error && error.name === 'AbortError')) return { ok: false, error: 'cancelled' }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

// Renderer-supplied roots are only honoured if the user picked them through the folder dialog.
async function knownRoot(path: string): Promise<string> {
  if (!(await store.isKnownRoot(path))) throw new Error('This folder has not been opened in Grasp.')
  return path
}

async function fileLines(projectRoot: string, path: string, base: string | null): Promise<DiffLine[]> {
  if (base) {
    const [diff] = parseDiff(await diffAgainst(projectRoot, base, 1_000_000, [path]))
    if (diff && diff.lines.length > 0) return diff.lines
  }
  const full = resolve(projectRoot, path)
  if (!full.startsWith(projectRoot + sep)) throw new Error('Path is outside the project.')
  const text = await readFile(full, 'utf8')
  return text.split('\n').map((line, i) => ({ kind: ' ' as const, no: i + 1, old: null, text: line }))
}

let analysis: AbortController | null = null
let explanation: AbortController | null = null
let storyRun: AbortController | null = null

async function activeProvider(): Promise<store.ResolvedProvider> {
  const provider = await store.resolveProvider(null)
  if (!provider) throw new Error('Add an AI provider in Settings first.')
  return provider
}

export function registerIpc(): void {
  handle('folder:pick', [], async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const], title: 'Open project' }
    const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const path = picked.canceled ? undefined : picked.filePaths[0]
    if (!path) return null
    await store.addRecent(path)
    return path
  })

  handle('project:analyze', [root, mode], async (event, path, requested) => {
    await knownRoot(path)
    if (!(await stat(path)).isDirectory()) throw new Error('Folder no longer exists.')
    analysis?.abort()
    const controller = (analysis = new AbortController())
    const result = await analyze(path, requested, (p) => event.sender.send('project:progress', p), controller.signal)
    await store.addRecent(path)
    await store.pruneAnalyses(path, new Map(result.nodes.map((n) => [n.id, n.hash])))
    return result
  })

  handle('project:file', [root, relativePath, commit.nullable()], async (_event, path, file, base) =>
    fileLines(await knownRoot(path), file, base),
  )
  handle('project:state', [root], async (_event, path) => store.getProject(await knownRoot(path)))
  handle('project:mark', [root, z.string(), mark.nullable()], async (_event, path, id, value) => {
    await store.setMark(await knownRoot(path), id, value)
    return null
  })

  handle('settings:get', [], () => store.getSettings())
  handle('settings:saveProvider', [provider], (_event, input) => store.saveProvider(input))
  handle('settings:deleteProvider', [z.string()], (_event, id) => store.deleteProvider(id))
  handle('settings:setActive', [z.string()], (_event, id) => store.setActiveProvider(id))

  handle('ai:models', [httpUrl, z.string().nullable(), z.string().nullable()], async (_event, baseUrl, apiKey, id) => {
    const saved = id ? await store.resolveProvider(id) : null
    // A saved key only ever goes to the URL it was saved for.
    const savedKey = saved?.baseUrl === baseUrl ? saved.apiKey : null
    return listModels({ baseUrl, apiKey: apiKey ?? savedKey })
  })

  handle('ai:explain', [root, z.string(), z.string(), messages], async (event, path, nodeId, hash, prompt) => {
    await knownRoot(path)
    const provider = await activeProvider()
    explanation?.abort()
    const controller = (explanation = new AbortController())
    const text = await streamChat(provider, provider.model, prompt, controller.signal, (delta) =>
      event.sender.send('ai:delta', nodeId, delta),
    )
    const saved = { hash, model: `${provider.name} · ${provider.model}`, text }
    await store.saveAnalysis(path, nodeId, saved)
    return saved
  })

  handle('ai:story', [root, z.string(), z.array(z.string()).max(5000), messages], async (_event, path, key, nodeIds, prompt) => {
    await knownRoot(path)
    const provider = await activeProvider()
    storyRun?.abort()
    const controller = (storyRun = new AbortController())
    const text = await streamChat(provider, provider.model, prompt, controller.signal, () => undefined, true)
    const story = parseStory(text, key, `${provider.name} · ${provider.model}`, nodeIds)
    await store.saveStory(path, story)
    return story
  })

  handle('ai:cancel', [], async () => {
    explanation?.abort()
    storyRun?.abort()
    return null
  })
}
