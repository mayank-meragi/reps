import {
  AiError,
  needsRootWrap,
  unwrapRootJson,
  wrapRootSchema,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type JsonRequest,
  type LlmAdapter,
  type ToolCall,
} from './types'
import { recordUsage } from './usage'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenAiMessage = Record<string, any>

/** gpt-5* / o* are reasoning models: no temperature knob, and reasoning tokens
 * eat into the completion budget, so they get minimal effort + headroom. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model)
}

async function request(body: { model: string } & Record<string, unknown>, key: string): Promise<OpenAiMessage> {
  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new AiError('OpenAI took too long — try again.')
    }
    throw new AiError('OpenAI unreachable — are you offline?')
  }
  if (res.status === 401 || res.status === 403) {
    throw new AiError('OpenAI rejected the API key. Check it in Settings.')
  }
  if (res.status === 404) throw new AiError('OpenAI does not know that model. Check it in Settings.')
  if (res.status === 429) throw new AiError('OpenAI rate limit hit — try again in a minute.')
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.error?.message
    throw new AiError(detail ? `OpenAI: ${detail}` : `OpenAI returned ${res.status}`)
  }
  const json = await res.json()
  if (json.usage) recordUsage('openai', body.model, json.usage.prompt_tokens ?? 0, json.usage.completion_tokens ?? 0)
  const message = json.choices?.[0]?.message
  if (!message) throw new AiError('OpenAI returned no content')
  return message
}

function baseParams(req: { maxOutputTokens: number; temperature?: number }, model: string): object {
  return isReasoningModel(model)
    ? { max_completion_tokens: req.maxOutputTokens * 4, reasoning_effort: 'minimal' }
    : { max_completion_tokens: req.maxOutputTokens, temperature: req.temperature ?? 0 }
}

function userContent(text: string, image?: { mimeType: string; data: string }): unknown {
  if (!image) return text
  return [
    { type: 'text', text },
    { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
  ]
}

function toMessages(system: string | undefined, messages: ChatMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = system ? [{ role: 'system', content: system }] : []
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContent(m.text, m.image) })
    } else if (m.role === 'assistant') {
      if (m.raw?.provider === 'openai') {
        out.push(m.raw.payload as OpenAiMessage)
      } else {
        out.push({
          role: 'assistant',
          content: m.text || null,
          ...(m.toolCalls?.length
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: JSON.stringify(c.args) },
                })),
              }
            : {}),
        })
      }
    } else {
      for (const r of m.results) {
        out.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) })
      }
    }
  }
  return out
}

export const openaiAdapter: LlmAdapter = {
  async generateJson(req: JsonRequest, key: string, model: string): Promise<string> {
    const wrap = needsRootWrap(req.schema)
    const message = await request(
      {
        model,
        messages: toMessages(req.system, [{ role: 'user', text: req.text, image: req.image }]),
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'result', strict: false, schema: wrap ? wrapRootSchema(req.schema) : req.schema },
        },
        ...baseParams(req, model),
      },
      key,
    )
    const text = typeof message.content === 'string' ? message.content : ''
    if (!text) throw new AiError('OpenAI returned no content')
    return wrap ? unwrapRootJson(text) : text
  },

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResponse> {
    const message = await request(
      {
        model,
        messages: toMessages(req.system, req.messages),
        tools: req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
        ...baseParams(req, model),
      },
      key,
    )
    const text = typeof message.content === 'string' ? message.content.trim() : ''
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawCalls: any[] = Array.isArray(message.tool_calls) ? message.tool_calls : []
    const toolCalls: ToolCall[] = rawCalls
      .filter((c) => c.type === 'function' && c.function?.name)
      .map((c) => {
        let args = {}
        try {
          args = JSON.parse(c.function.arguments || '{}')
        } catch {
          // Malformed args — executor will report missing fields back to the model
        }
        return { id: c.id, name: c.function.name, args }
      })
    return {
      text,
      toolCalls,
      message: { role: 'assistant', text, toolCalls, raw: { provider: 'openai', payload: message } },
    }
  },
}
