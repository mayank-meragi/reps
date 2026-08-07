import type { Provider } from './types'

/**
 * Token usage tracking, local to this browser. Counts live in localStorage
 * (never the data repo) and accumulate per provider+model across all AI calls.
 */

const USAGE_KEY = 'reps.aiUsage'

export interface UsageEntry {
  provider: Provider
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
}

type UsageStore = Record<string, UsageEntry>

function load(): UsageStore {
  const raw = localStorage.getItem(USAGE_KEY)
  if (!raw) return {}
  try {
    return JSON.parse(raw) as UsageStore
  } catch {
    return {}
  }
}

export function recordUsage(provider: Provider, model: string, inputTokens: number, outputTokens: number): void {
  const store = load()
  const key = `${provider}:${model}`
  const entry = store[key] ?? { provider, model, calls: 0, inputTokens: 0, outputTokens: 0 }
  entry.calls += 1
  entry.inputTokens += inputTokens
  entry.outputTokens += outputTokens
  store[key] = entry
  localStorage.setItem(USAGE_KEY, JSON.stringify(store))
}

export function getUsage(): UsageEntry[] {
  return Object.values(load()).sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
}

export function resetUsage(): void {
  localStorage.removeItem(USAGE_KEY)
}

/** USD per 1M tokens. First substring match wins, so order specific → generic. */
const PRICING: { match: string; input: number; output: number }[] = [
  // Gemini
  { match: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4 },
  { match: 'flash-lite', input: 0.1, output: 0.4 },
  { match: 'gemini-2.5-pro', input: 1.25, output: 10 },
  { match: 'flash', input: 0.3, output: 2.5 }, // gemini-flash-latest / 2.5-flash
  { match: 'gemini', input: 0.3, output: 2.5 },
  // OpenAI
  { match: 'gpt-5-nano', input: 0.05, output: 0.4 },
  { match: 'gpt-5-mini', input: 0.25, output: 2 },
  { match: 'gpt-5', input: 1.25, output: 10 },
  { match: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { match: 'gpt-4o', input: 2.5, output: 10 },
  { match: 'gpt-4.1-mini', input: 0.4, output: 1.6 },
  { match: 'gpt-4.1', input: 2, output: 8 },
  // Anthropic
  { match: 'haiku', input: 1, output: 5 },
  { match: 'sonnet', input: 3, output: 15 },
  { match: 'opus-4-1', input: 15, output: 75 },
  { match: 'opus-4-0', input: 15, output: 75 },
  { match: 'opus', input: 5, output: 25 },
  { match: 'fable', input: 10, output: 50 },
]

/** Estimated cost in USD, or null when the model isn't in the pricing table. */
export function estimateCostUsd(entry: UsageEntry): number | null {
  const price = PRICING.find((p) => entry.model.includes(p.match))
  if (!price) return null
  return (entry.inputTokens * price.input + entry.outputTokens * price.output) / 1_000_000
}

export function formatUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
