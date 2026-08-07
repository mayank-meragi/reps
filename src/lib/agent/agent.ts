import type { QueryClient } from '@tanstack/react-query'
import { chat, AiError, type ChatMessage, type ToolResult } from '@/lib/llm'
import { run, toolDefs, type CommandContext } from '@/lib/commands'
import { buildOverview } from './overview'

export type { ChatMessage }

const MAX_ROUNDS = 6
const MAX_TOOL_CALLS = 12

function buildSystemPrompt(qc: QueryClient): string {
  return `You are the coach inside Reps, the user's AI-first training app. You can control the whole
app through your tools: start and log sessions (strength or cardio), manage exercises, venues,
and their training profile, and answer questions about their training.

Current state:
${buildOverview(qc)}

Rules:
- Use tools to act; never claim you did something without the tool call succeeding.
- Look up ids before using them — venue.list for venueId, exercise.search for exerciseId — never
  guess one.
- Weights are in the units the profile specifies (kg by default).
- Writes apply immediately and most can be undone, so act without asking permission on ordinary
  logging (starting a session, adding an exercise, logging a set). Deletions prompt the user
  automatically — you don't need to ask first, the tool call itself will surface the confirmation.
- If there's a session already in progress, prefer editing it (add_exercise, add_set, update_set)
  over starting a new one.
- Answer training questions from the state above or via session.list; be concrete with numbers.
- Keep replies short and plain — one or two sentences. No markdown headers, no emoji.`
}

export type AgentDeps = Omit<CommandContext, 'source'>

export interface AgentResult {
  reply: string
  /** Updated conversation to carry into the next turn. */
  history: ChatMessage[]
}

/**
 * One user turn of the agent: call the active AI provider with the command
 * registry's tools, execute any tool calls through run() — the same entry
 * point the UI uses — feed results back, and loop until it answers in text.
 *
 * `system`, when passed, replaces the default coach prompt entirely (still
 * with the full command registry as tools) — this is how setup's directed
 * interview reuses this exact loop instead of duplicating it.
 */
export async function runAgentTurn(userMessage: string, history: ChatMessage[], deps: AgentDeps, system?: string): Promise<AgentResult> {
  const messages: ChatMessage[] = [...history, { role: 'user', text: userMessage }]
  const ctx: CommandContext = { ...deps, source: 'ai' }
  let toolCalls = 0

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await chat({
      system: system ?? buildSystemPrompt(deps.qc),
      messages,
      tools: toolDefs(),
      temperature: 0.2,
      maxOutputTokens: 2048,
    })
    messages.push(response.message)

    if (response.toolCalls.length === 0) {
      const reply = response.text.trim()
      if (!reply) throw new AiError('The assistant returned an empty reply.')
      return { reply, history: messages }
    }

    const results: ToolResult[] = []
    for (const call of response.toolCalls) {
      toolCalls++
      if (toolCalls > MAX_TOOL_CALLS) {
        results.push({
          id: call.id,
          name: call.name,
          result: { error: 'tool budget exhausted — summarize what was done' },
        })
        continue
      }
      let result: object
      try {
        result = ((await run(call.name, call.args, ctx)) as object) ?? {}
      } catch (e) {
        result = { error: e instanceof Error ? e.message : 'tool failed' }
      }
      results.push({ id: call.id, name: call.name, result })
    }
    messages.push({ role: 'tool', results })
  }

  throw new AiError('The assistant took too many steps — try a simpler request.')
}
