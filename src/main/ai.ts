import type { ChatMessage } from '../shared/types'

export interface Endpoint {
  baseUrl: string
  apiKey: string | null
}

const CONNECT_TIMEOUT_MS = 15_000
// Local models can take a while to load into memory before the first token arrives.
const IDLE_TIMEOUT_MS = 120_000

function headers(apiKey: string | null): Record<string, string> {
  return { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }
}

function url(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

async function request(endpoint: Endpoint, path: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url(endpoint.baseUrl, path), { ...init, headers: headers(endpoint.apiKey), signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new Error(`Can't reach ${endpoint.baseUrl}. Check that the server is running and the URL is correct.`)
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300)
    throw new Error(`${endpoint.baseUrl} returned ${response.status}${body ? `: ${body}` : ''}`)
  }
  return response
}

export async function listModels(endpoint: Endpoint): Promise<string[]> {
  const response = await request(endpoint, '/models', { method: 'GET' }, AbortSignal.timeout(CONNECT_TIMEOUT_MS))
  const body = (await response.json()) as { data?: { id?: unknown }[] }
  return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort()
}

function deltaOf(line: string): string {
  let event: { choices?: { delta?: { content?: unknown } }[] }
  try {
    event = JSON.parse(line) as typeof event
  } catch {
    throw new Error('The gateway sent a malformed streaming response.')
  }
  const content = event.choices?.[0]?.delta?.content
  return typeof content === 'string' ? content : ''
}

/** Streams an OpenAI-compatible chat completion (Ollama serves the same API under /v1). */
export async function streamChat(
  endpoint: Endpoint,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (text: string) => void,
  json = false,
): Promise<string> {
  const idle = new AbortController()
  let timer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS)
  const combined = AbortSignal.any([signal, idle.signal])
  try {
    const format = json ? { response_format: { type: 'json_object' } } : {}
    const body = JSON.stringify({ model, messages, stream: true, temperature: 0.2, ...format })
    const response = await request(endpoint, '/chat/completions', { method: 'POST', body }, combined)
    if (!response.body) throw new Error('The gateway returned an empty response.')
    const decoder = new TextDecoder()
    let buffered = ''
    let text = ''
    const reader = response.body.getReader()
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      clearTimeout(timer)
      timer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS)
      buffered += decoder.decode(chunk.value, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return text
        const delta = deltaOf(data)
        text += delta
        if (delta) onDelta(delta)
      }
    }
    return text
  } catch (error) {
    if (idle.signal.aborted && !signal.aborted) throw new Error(`No response from the model for ${IDLE_TIMEOUT_MS / 1000}s.`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
