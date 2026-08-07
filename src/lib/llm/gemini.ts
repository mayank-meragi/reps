import {
  AiError,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type JsonRequest,
  type JsonSchema,
  type LlmAdapter,
  type ToolCall,
} from './types'
import { recordUsage } from './usage'

/** One content part in a Gemini request/response (text, functionCall, …). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeminiPart = Record<string, any>

interface GeminiContent {
  role: 'user' | 'model'
  parts: GeminiPart[]
}

/** Gemini's schema dialect wants UPPERCASE type names. */
function toGeminiSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type' && typeof v === 'string') out.type = v.toUpperCase()
    else if (k === 'properties') {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, JsonSchema>).map(([name, s]) => [name, toGeminiSchema(s)]),
      )
    } else if (k === 'items') out.items = toGeminiSchema(v as JsonSchema)
    else if (k === 'additionalProperties') continue
    else out[k] = v
  }
  return out
}

async function request(body: object, key: string, model: string): Promise<GeminiPart[]> {
  let res: Response
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      // A runaway generation otherwise leaves the UI stuck forever
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new AiError('Gemini took too long — try again.')
    }
    throw new AiError('Gemini unreachable — are you offline?')
  }
  if (res.status === 400 || res.status === 403) {
    throw new AiError('Gemini rejected the API key. Check it in Settings.')
  }
  if (res.status === 404) throw new AiError('Gemini does not know that model. Check it in Settings.')
  if (res.status === 429) throw new AiError('Gemini rate limit hit — try again in a minute.')
  if (!res.ok) throw new AiError(`Gemini returned ${res.status}`)
  const json = await res.json()
  const usage = json.usageMetadata
  if (usage) {
    // Thought tokens bill as output even though they never reach the parts
    recordUsage(
      'gemini',
      model,
      usage.promptTokenCount ?? 0,
      (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    )
  }
  const parts: GeminiPart[] | undefined = json.candidates?.[0]?.content?.parts
  if (!parts || parts.length === 0) throw new AiError('Gemini returned no content')
  return parts
}

function toContents(messages: ChatMessage[]): GeminiContent[] {
  return messages.map((m): GeminiContent => {
    if (m.role === 'user') {
      const parts: GeminiPart[] = []
      if (m.image) parts.push({ inline_data: { mime_type: m.image.mimeType, data: m.image.data } })
      parts.push({ text: m.text })
      return { role: 'user', parts }
    }
    if (m.role === 'assistant') {
      // Same-provider history: replay the exact parts (keeps thought signatures)
      if (m.raw?.provider === 'gemini') return { role: 'model', parts: m.raw.payload as GeminiPart[] }
      const parts: GeminiPart[] = []
      if (m.text) parts.push({ text: m.text })
      for (const call of m.toolCalls ?? []) parts.push({ functionCall: { name: call.name, args: call.args } })
      return { role: 'model', parts }
    }
    // Tool results travel as functionResponse parts in a user turn
    return {
      role: 'user',
      parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: r.result } })),
    }
  })
}

export const geminiAdapter: LlmAdapter = {
  async generateJson(req: JsonRequest, key: string, model: string): Promise<string> {
    const parts: GeminiPart[] = []
    if (req.image) parts.push({ inline_data: { mime_type: req.image.mimeType, data: req.image.data } })
    parts.push({ text: req.text })
    const out = await request(
      {
        ...(req.system ? { system_instruction: { parts: [{ text: req.system }] } } : {}),
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxOutputTokens,
          response_mime_type: 'application/json',
          response_schema: toGeminiSchema(req.schema),
          // Flash is a thinking model now; thoughts silently eat the token cap
          // on structured extraction (seen: memory summaries truncating). Off.
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
      key,
      model,
    )
    const text = out.find((p) => typeof p.text === 'string')?.text as string | undefined
    if (!text) throw new AiError('Gemini returned no content')
    return text
  },

  async chat(req: ChatRequest, key: string, model: string): Promise<ChatResponse> {
    const parts = await request(
      {
        system_instruction: { parts: [{ text: req.system }] },
        contents: toContents(req.messages),
        tools: [
          {
            function_declarations: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: toGeminiSchema(t.parameters),
            })),
          },
        ],
        generationConfig: { temperature: req.temperature ?? 0.2, maxOutputTokens: req.maxOutputTokens },
      },
      key,
      model,
    )
    const text = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: `${p.functionCall.name}#${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} }))
    return {
      text,
      toolCalls,
      message: { role: 'assistant', text, toolCalls, raw: { provider: 'gemini', payload: parts } },
    }
  },
}
