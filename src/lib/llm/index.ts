import { getConfig, type ConfigKey } from '../cache'
import { anthropicAdapter } from './anthropic'
import { geminiAdapter } from './gemini'
import { openaiAdapter } from './openai'
import { NoAiKeyError, type ChatRequest, type ChatResponse, type JsonRequest, type LlmAdapter, type Provider } from './types'

export * from './types'
export * from './usage'

export const PROVIDERS: Provider[] = ['gemini', 'openai', 'anthropic']

export const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
}

export const DEFAULT_MODEL: Record<Provider, string> = {
  // Stable alias — always points at the current flash model, so retired
  // versions (like gemini-2.0-flash) don't break the app
  gemini: 'gemini-flash-latest',
  openai: 'gpt-5-mini',
  anthropic: 'claude-haiku-4-5',
}

const KEY_CONFIG: Record<Provider, ConfigKey> = {
  gemini: 'geminiKey',
  openai: 'openaiKey',
  anthropic: 'anthropicKey',
}

const MODEL_CONFIG: Record<Provider, ConfigKey> = {
  gemini: 'geminiModel',
  openai: 'openaiModel',
  anthropic: 'anthropicModel',
}

const ADAPTERS: Record<Provider, LlmAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
}

export function activeProvider(): Provider {
  const raw = getConfig('aiProvider')
  return PROVIDERS.includes(raw as Provider) ? (raw as Provider) : 'gemini'
}

export function providerKey(provider: Provider): string | null {
  return getConfig(KEY_CONFIG[provider])
}

export function providerModel(provider: Provider): string {
  return getConfig(MODEL_CONFIG[provider]) || DEFAULT_MODEL[provider]
}

export function keyConfigFor(provider: Provider): ConfigKey {
  return KEY_CONFIG[provider]
}

export function modelConfigFor(provider: Provider): ConfigKey {
  return MODEL_CONFIG[provider]
}

/** True when the active provider has an API key configured. */
export function hasAiKey(): boolean {
  return Boolean(providerKey(activeProvider()))
}

function resolve(): { adapter: LlmAdapter; key: string; model: string; provider: Provider } {
  const provider = activeProvider()
  const key = providerKey(provider)
  if (!key) throw new NoAiKeyError(`No ${PROVIDER_LABEL[provider]} API key configured`)
  return { adapter: ADAPTERS[provider], key, model: providerModel(provider), provider }
}

/** Structured output from the active provider. Returns raw JSON text. */
export function generateJson(req: JsonRequest): Promise<string> {
  const { adapter, key, model } = resolve()
  return adapter.generateJson(req, key, model)
}

/** One tool-use turn from the active provider. */
export function chat(req: ChatRequest): Promise<ChatResponse> {
  const { adapter, key, model } = resolve()
  return adapter.chat(req, key, model)
}
