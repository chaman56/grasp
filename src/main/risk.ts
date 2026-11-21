import type { Sink, Tier } from '../shared/types'

const SINK_PATTERNS: Record<Sink, RegExp> = {
  money: /charge|payment|price|amount|invoice|refund|billing|balance|currency|cents|wallet|payout/i,
  auth: /auth|token|password|passwd|secret|credential|session|permission|login|jwt|oauth|encrypt|decrypt/i,
  persistence: /\b(insert|update|delete|commit|rollback|query|sql|save|persist|migrat\w*|transaction|writeFile|write_file)\b/i,
  network: /\b(fetch|https?|request|axios|socket|websocket|grpc|exec|spawn|subprocess|urlopen)\b/i,
}

export function detectSinks(text: string): Sink[] {
  return (Object.keys(SINK_PATTERNS) as Sink[]).filter((sink) => SINK_PATTERNS[sink].test(text))
}

export interface RiskInput {
  callers: number
  sinks: Sink[]
  complexity: number
  tests: number | null
  changed: number
}

/**
 * 0–100. Weights favour what makes a bug expensive (sensitive sinks, many callers) over raw size.
 * Untested only counts when tests apply to the node.
 */
export function riskScore({ callers, sinks, complexity, tests, changed }: RiskInput): number {
  const score =
    0.2 * Math.min(1, Math.log2(1 + callers) / 4) +
    0.3 * Math.min(1, sinks.length / 2) +
    0.2 * Math.min(1, (complexity - 1) / 14) +
    0.2 * (tests === 0 ? 1 : 0) +
    0.1 * Math.min(1, Math.log2(1 + changed) / 7)
  return Math.round(score * 100)
}

export function tierOf(risk: number): Tier {
  if (risk >= 65) return 'critical'
  if (risk >= 45) return 'high'
  if (risk >= 20) return 'medium'
  return 'low'
}
