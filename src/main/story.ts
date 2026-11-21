import { z } from 'zod'
import type { Step, Story } from '../shared/types'

const schema = z.object({
  summary: z.string().min(1),
  steps: z
    .array(z.object({ title: z.string().min(1), why: z.string().optional(), nodes: z.array(z.string()) }))
    .min(1),
})

// Models often wrap JSON in prose or code fences even in JSON mode.
function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Turns the model's `{summary, steps: [{title, why, nodes: ["n3", ...]}]}` into a Story over real node ids.
 * Unknown keys are dropped, each node lands in its first step, and anything the model skipped goes in a final step.
 */
export function parseStory(text: string, key: string, model: string, nodeIds: string[]): Story {
  const parsed = schema.safeParse(extractJson(text))
  if (!parsed.success) throw new Error('The model did not return a usable story. Try again, or use a larger model.')
  const placed = new Set<string>()
  const steps: Step[] = parsed.data.steps.flatMap((s, i) => {
    const ids = s.nodes.flatMap((ref) => {
      const id = nodeIds[Number(/^n(\d+)$/.exec(ref.trim())?.[1] ?? -1)]
      if (!id || placed.has(id)) return []
      placed.add(id)
      return [id]
    })
    return ids.length ? [{ id: `ai:${i}`, title: s.title, why: s.why?.trim() || null, nodeIds: ids }] : []
  })
  const missed = nodeIds.filter((id) => !placed.has(id))
  if (missed.length) steps.push({ id: 'ai:rest', title: 'Everything else', why: null, nodeIds: missed })
  return { key, model, summary: parsed.data.summary, steps }
}
