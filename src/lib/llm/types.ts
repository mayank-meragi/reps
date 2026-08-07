/** Provider-neutral vocabulary for talking to an LLM. Adapters translate. */

export type Provider = 'gemini' | 'openai' | 'anthropic'

export class AiError extends Error {}
export class NoAiKeyError extends AiError {}

/** Base64 image payload (no data: prefix). */
export interface ImageAttachment {
  mimeType: string
  data: string
}

export interface ToolCall {
  /** Provider call id where one exists (OpenAI/Anthropic); synthesized for Gemini. */
  id: string
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>
}

export interface ToolResult {
  id: string
  name: string
  result: object
}

/**
 * Provider-native representation of an assistant turn, echoed back verbatim
 * when the same provider serializes the history (preserves thought signatures
 * and exact formatting). A different provider reconstructs from the neutral
 * fields instead.
 */
export interface RawAssistantTurn {
  provider: Provider
  payload: unknown
}

export type ChatMessage =
  | { role: 'user'; text: string; image?: ImageAttachment }
  | { role: 'assistant'; text?: string; toolCalls?: ToolCall[]; raw?: RawAssistantTurn }
  | { role: 'tool'; results: ToolResult[] }

/** Plain JSON Schema (lowercase types). Adapters convert to their dialect. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonSchema = Record<string, any>

export interface ToolDef {
  name: string
  description: string
  parameters: JsonSchema
}

export interface JsonRequest {
  system?: string
  text: string
  image?: ImageAttachment
  schema: JsonSchema
  /** Hard cap — degenerate generations otherwise run to the model's own limit. */
  maxOutputTokens: number
  temperature?: number
}

export interface ChatRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolDef[]
  maxOutputTokens: number
  temperature?: number
}

export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  /** The assistant message to append to the conversation history. */
  message: ChatMessage & { role: 'assistant' }
}

/** Every adapter implements this pair. */
export interface LlmAdapter {
  /** Structured output: returns the JSON text (parsing/salvage happens upstream). */
  generateJson(req: JsonRequest, key: string, model: string): Promise<string>
  /** One model turn of a tool-use conversation. */
  chat(req: ChatRequest, key: string, model: string): Promise<ChatResponse>
}

/**
 * Some providers require an object at the schema root. Wrap non-object roots
 * as { items: <schema> }; unwrapJsonRoot undoes it on the way out.
 */
export function needsRootWrap(schema: JsonSchema): boolean {
  return schema.type !== 'object'
}

export function wrapRootSchema(schema: JsonSchema): JsonSchema {
  return { type: 'object', properties: { items: schema }, required: ['items'] }
}

export function unwrapRootJson(text: string): string {
  try {
    const parsed = JSON.parse(text) as { items?: unknown }
    if (parsed && typeof parsed === 'object' && 'items' in parsed) return JSON.stringify(parsed.items)
  } catch {
    // Invalid JSON — hand it back untouched so upstream salvage can try.
  }
  return text
}
