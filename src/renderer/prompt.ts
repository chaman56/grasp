import type { Analysis, ChatMessage, DiffLine, FnNode } from '../shared/types'
import { displayName } from './review'

const MAX_LINES = 400

const SYSTEM = `You help a developer understand code before they approve it. Be concise and concrete.
Only state what the code shows; say "unclear" rather than guess. Use this markdown structure:
### What it does
1–2 sentences.
### What changed
Only if the code has +/- diff markers: the behavioural difference, not a line-by-line recap.
### Risks
Bullets: edge cases, error handling, security, data integrity. Omit the section if none.
### Questions for the author
1–3 bullets worth asking before merging.`

export function explainPrompt(node: FnNode, lines: DiffLine[], callers: FnNode[], callees: FnNode[]): ChatMessage[] {
  const shown = lines.slice(0, MAX_LINES)
  const code = shown.map((l) => `${l.kind === ' ' ? ' ' : l.kind} ${l.text}`).join('\n')
  const names = (list: FnNode[]) => (list.length ? list.map(displayName).join(', ') : 'none in this change')
  const user = [
    `File: ${node.path} (lines ${node.startLine}–${node.endLine})`,
    `${node.kind === 'file' ? 'File-level code' : `Function: ${node.name}`}`,
    `Called by: ${names(callers)}`,
    `Calls: ${names(callees)}`,
    `Signals: ${node.callers} call sites, cyclomatic complexity ${node.after?.complexity ?? node.before?.complexity ?? 1}, touches ${node.sinks.join(', ') || 'nothing sensitive'}, ${node.tests === null ? 'tests n/a' : `${node.tests} test call sites`}`,
    '',
    'Code (+ added, - removed):',
    '```',
    code,
    '```',
    lines.length > MAX_LINES ? `(truncated: showing ${MAX_LINES} of ${lines.length} lines)` : '',
  ].join('\n')
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]
}

const MAX_STORY_NODES = 400

const STORY_SYSTEM = `You turn a code change into a short guided walkthrough for a reviewer.
Reply with JSON only, exactly this shape:
{"summary": "2-3 sentences: what the change does and why it matters",
 "steps": [{"title": "at most 6 words", "why": "one sentence: what this step does and what to check", "nodes": ["n0", "n4"]}]}
Rules: 3-7 steps in the order a reviewer should read them: entry points and public API first, core logic next,
tests and config last. Group by purpose, not by file. Put every node id in exactly one step. Use only ids from the list.`

function describe(node: FnNode, i: number): string {
  const { before, after } = node
  const added = after?.calls.filter((c) => !before?.calls.includes(c)) ?? []
  const removed = before?.calls.filter((c) => !after?.calls.includes(c)) ?? []
  const what = (after ?? before)?.signature || `${node.kind} ${node.name}`
  const calls = [added.length ? `+calls ${added.slice(0, 8).join(',')}` : '', removed.length ? `-calls ${removed.slice(0, 8).join(',')}` : '']
  return [`n${i} [${node.change}${node.isTest ? ', test' : ''}] ${node.path}`, what.slice(0, 140), ...calls.filter(Boolean)].join(' | ')
}

export function storyPrompt(analysis: Analysis): ChatMessage[] {
  const index = new Map(analysis.nodes.map((n, i) => [n.id, i]))
  const nodes = analysis.nodes.slice(0, MAX_STORY_NODES).map(describe)
  const edges = analysis.edges
    .filter((e) => index.has(e.from) && index.has(e.to))
    .map((e) => `n${index.get(e.from)}->n${index.get(e.to)}${e.change === 'same' ? '' : ` (${e.change})`}`)
  const user = [
    `Change: ${analysis.git ? `${analysis.git.branch} ${analysis.git.baseLabel}` : 'whole project'}`,
    'Nodes:', ...nodes,
    analysis.nodes.length > MAX_STORY_NODES ? `(${analysis.nodes.length - MAX_STORY_NODES} more nodes omitted)` : '',
    'Calls between nodes:', edges.join(', ') || 'none',
  ].join('\n')
  return [{ role: 'system', content: STORY_SYSTEM }, { role: 'user', content: user }]
}
