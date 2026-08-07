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
type ContentBlock = Record<string, any>

async function request(body: { model: string } & Record<string, unknown>, key: string): Promise<ContentBlock[]> {
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // This app has no backend; the user's key stays in their own browser
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new AiError('Anthropic took too long — try again.')
    }
    throw new AiError('Anthropic unreachable — are you offline?')
  }
  if (res.status === 401 || res.status === 403) {
    throw new AiError('Anthropic rejected the API key. Check it in Settings.')
  }
  if (res.status === 404) throw new AiError('Anthropic does not know that model. Check it in Settings.')
  if (res.status === 429) throw new AiError('Anthropic rate limit hit — try again in a minute.')
  if (!res.ok) {
    const detail = (await res.json().catch(() => null))?.error?.message
    throw new AiError(detail ? `Anthropic: ${detail}` : `Anthropic returned ${res.status}`)
  }
  const json = await res.json()
  if (json.usage) recordUsage('anthropic', body.model, json.usage.input_tokens ?? 0, json.usage.output_tokens ?? 0)
  const content: ContentBlock[] | undefined = json.content
  if (!content || content.length === 0) throw new AiError('Anthropic returned no content')
  return content
}

function userContent(text: string, image?: { mimeType: string; data: string }): unknown {
  if (!image) return text
  return [
    { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
    { type: 'text', text },
  ]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMessages(messages: ChatMessage[]): Record<string, any>[] {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: userContent(m.text, m.image) }
    if (m.role === 'assistant') {
      if (m.raw?.provider === 'anthropic') return { role: 'assistant', content: m.raw.payload }
      const blocks: ContentBlock[] = []
      if (m.text) blocks.push({ type: 'text', text: m.text })
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args })
      return { role: 'assistant', content: blocks }
    }
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: JSON.stringify(r.result),
      })),
    }
  })
}

export const anthropicAdapter: LlmAdapter = {
  async generateJson(req: JsonRequest, key: string, model: string): Promise<string> {
    // Structured output via a forced tool: the schema becomes the tool's input
    const wrap = needsRootWrap(req.schema)
    const content = await request(
      {
        model,
        max_tokens: req.maxOutputTokens,
        ...(req.system ? { system: req.system } : {}),
        messages: [{ role: 'user', content: userContent(req.text, req.image) }],
        tools: [
          {
            name: 'emit',
            description: 'Emit the structured result.',
            input_schema: wrap ? wrapRootSchema(req.schema) : req.schema,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit' },
        temperature: req.temperature ?? 0,
      },
      key,
    )
    const call = content.find((b) => b.type === 'tool_use')
    if (!call) throw new AiError('Anthropic returned no content')
    const text = JSON.stringify(call.input ?? null)
    return wrap ? unwrapRootJson(text) : text
  },

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResponse> {
    const content = await request(
      {
        model,
        max_tokens: req.maxOutputTokens,
        system: req.system,
        messages: toMessages(req.messages),
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        temperature: req.temperature ?? 0.2,
      },
      key,
    )
    const text = content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    const toolCalls: ToolCall[] = content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, args: b.input ?? {} }))
    return {
      text,
      toolCalls,
      message: { role: 'assistant', text, toolCalls, raw: { provider: 'anthropic', payload: content } },
    }
  },
}
