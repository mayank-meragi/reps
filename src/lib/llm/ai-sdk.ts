import type { ModelMessage, ToolSet } from 'ai'
import {
  AiError,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type JsonRequest,
  type LlmAdapter,
  type Provider,
  type ToolCall,
} from './types'
import { recordUsage } from './usage'

async function providerModel(provider: Provider, key: string, model: string) {
  if (provider === 'gemini') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    return createGoogleGenerativeAI({ apiKey: key })(model)
  }
  if (provider === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai')
    return createOpenAI({ apiKey: key })(model)
  }
  const { createAnthropic } = await import('@ai-sdk/anthropic')
  return createAnthropic({
    apiKey: key,
    // Reps deliberately runs provider calls in the user's browser; this is
    // Anthropic's explicit opt-in header for that architecture.
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  })(model)
}

function userMessage(text: string, image?: { mimeType: string; data: string }): ModelMessage {
  if (!image) return { role: 'user', content: text }
  return {
    role: 'user',
    content: [
      { type: 'file', mediaType: image.mimeType, data: { type: 'data', data: image.data } },
      { type: 'text', text },
    ],
  }
}

function toModelMessages(messages: ChatMessage[], provider: Provider): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === 'user') return userMessage(message.text, message.image)

    if (message.role === 'assistant') {
      // Preserve provider metadata such as Gemini thought signatures for a
      // same-provider follow-up. Reconstruct neutral content after a switch.
      if (message.raw?.provider === provider) return message.raw.payload as ModelMessage
      const content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool-call'; toolCallId: string; toolName: string; input: Record<string, unknown> }
      > = []
      if (message.text) content.push({ type: 'text', text: message.text })
      for (const call of message.toolCalls ?? []) {
        content.push({ type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.args })
      }
      return { role: 'assistant', content }
    }

    return {
      role: 'tool',
      content: message.results.map((result) => ({
        type: 'tool-result' as const,
        toolCallId: result.id,
        toolName: result.name,
        // Text-wrapped JSON is accepted uniformly by all three providers and
        // naturally drops optional undefined fields at the network boundary.
        output: { type: 'text' as const, value: JSON.stringify(result.result ?? {}) },
      })),
    }
  })
}

async function toTools(definitions: ChatRequest['tools']): Promise<ToolSet> {
  const { jsonSchema, tool } = await import('ai')
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: jsonSchema(definition.parameters),
      }),
    ]),
  )
}

function recordResultUsage(provider: Provider, model: string, usage: { inputTokens?: number; outputTokens?: number }): void {
  recordUsage(provider, model, usage.inputTokens ?? 0, usage.outputTokens ?? 0)
}

function nestedError(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined
  if ('lastError' in error && error.lastError) return error.lastError
  if ('cause' in error && error.cause) return error.cause
  return undefined
}

function statusOf(error: unknown): number | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    const direct = 'statusCode' in current ? current.statusCode : 'status' in current ? current.status : undefined
    if (typeof direct === 'number') return direct
    current = nestedError(current)
  }
  return undefined
}

function detailOf(error: unknown): string | undefined {
  let current: unknown = error
  let detail: string | undefined
  for (let depth = 0; depth < 4 && current; depth++) {
    if (current instanceof Error && current.message.trim()) detail = current.message.trim()
    current = nestedError(current)
  }
  return detail
}

function temperatureFor(provider: Provider, model: string, temperature: number): number | undefined {
  // OpenAI reasoning models reject the temperature parameter altogether.
  return provider === 'openai' && /^(gpt-5|o\d)/.test(model) ? undefined : temperature
}

function providerError(error: unknown, provider: Provider): AiError {
  if (error instanceof AiError) return error
  const label = provider === 'gemini' ? 'Gemini' : provider === 'openai' ? 'OpenAI' : 'Anthropic'
  const status = statusOf(error)
  const detail = detailOf(error)
  if (status === 401 || status === 403) return new AiError(`${label} rejected the API key. Check it in Settings.`)
  if (status === 404) return new AiError(`${label} does not know that model. Check it in Settings.`)
  if (status === 429) return new AiError(`${label} rate limit hit — try again in a minute.`)
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return new AiError(`${label} took too long — try again.`)
  }
  return new AiError(detail ? `${label}: ${detail}` : `${label} request failed`)
}

function lastAssistantMessage(messages: ModelMessage[], fallback: ModelMessage): ModelMessage {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i]
  }
  return fallback
}

export function createAiSdkAdapter(provider: Provider): LlmAdapter {
  return {
    async generateJson(req: JsonRequest, key: string, model: string): Promise<string> {
      try {
        const [{ generateText, jsonSchema, Output }, resolvedModel] = await Promise.all([import('ai'), providerModel(provider, key, model)])
        const result = await generateText({
          model: resolvedModel,
          system: req.system,
          messages: [userMessage(req.text, req.image)],
          output: Output.object({ schema: jsonSchema(req.schema), name: 'result' }),
          maxOutputTokens: req.maxOutputTokens,
          temperature: temperatureFor(provider, model, req.temperature ?? 0),
          maxRetries: 1,
          timeout: provider === 'gemini' ? 30_000 : 60_000,
        })
        recordResultUsage(provider, model, result.usage)
        return JSON.stringify(result.output)
      } catch (error) {
        throw providerError(error, provider)
      }
    },

    async chat(req: ChatRequest, key: string, model: string): Promise<ChatResponse> {
      try {
        const [{ generateText }, resolvedModel, resolvedTools] = await Promise.all([
          import('ai'),
          providerModel(provider, key, model),
          toTools(req.tools),
        ])
        const result = await generateText({
          model: resolvedModel,
          system: req.system,
          messages: toModelMessages(req.messages, provider),
          tools: resolvedTools,
          maxOutputTokens: req.maxOutputTokens,
          temperature: temperatureFor(provider, model, req.temperature ?? 0.2),
          maxRetries: 1,
          timeout: provider === 'gemini' ? 30_000 : 60_000,
        })
        recordResultUsage(provider, model, result.usage)
        const toolCalls: ToolCall[] = result.toolCalls.map((call) => ({
          id: call.toolCallId,
          name: call.toolName,
          args: call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {},
        }))
        const text = result.text.trim()
        const fallback: ModelMessage = {
          role: 'assistant',
          content: [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...toolCalls.map((call) => ({
              type: 'tool-call' as const,
              toolCallId: call.id,
              toolName: call.name,
              input: call.args,
            })),
          ],
        }
        return {
          text,
          toolCalls,
          message: {
            role: 'assistant',
            text,
            toolCalls,
            raw: { provider, payload: lastAssistantMessage(result.responseMessages, fallback) },
          },
        }
      } catch (error) {
        throw providerError(error, provider)
      }
    },
  }
}
