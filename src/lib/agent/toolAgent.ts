import { AiError, chat, type ChatMessage, type ToolResult } from '@/lib/llm'
import { run, toolDefs } from '@/lib/commands/registry'
import type { CommandContext } from '@/lib/commands/context'

export interface ToolAgentRequest {
  system: string
  user: string
  allowedTools: string[]
  finalTool: string
  ctx: CommandContext
  maxRounds?: number
  maxToolCalls?: number
}

/**
 * A bounded, task-specific agent loop. It can inspect state through an
 * allowlisted subset of the shared command registry and must finish by
 * calling one typed command that persists the result.
 */
export async function runToolAgent<R>({
  system,
  user,
  allowedTools,
  finalTool,
  ctx,
  maxRounds = 8,
  maxToolCalls = 18,
}: ToolAgentRequest): Promise<R> {
  const allowed = new Set([...allowedTools, finalTool])
  const tools = toolDefs().filter((tool) => allowed.has(tool.name))
  const registered = new Set(tools.map((tool) => tool.name))
  if (!registered.has(finalTool)) throw new Error(`Final agent tool is not registered: ${finalTool}`)

  const messages: ChatMessage[] = [{ role: 'user', text: user }]
  const agentCtx: CommandContext = { ...ctx, source: 'ai' }
  let toolCallCount = 0

  const progressLabel = (name: string): string => {
    if (name === finalTool) return 'Finishing your recommendation…'
    if (name.startsWith('body.')) return 'Checking readiness and recovery…'
    if (name.startsWith('session.')) return 'Reviewing recent training…'
    if (name.startsWith('exercise.')) return 'Searching the exercise catalog…'
    if (name.startsWith('insights.')) return 'Reading your training patterns…'
    if (name.startsWith('venue.')) return 'Checking available equipment…'
    if (name.startsWith('program.')) return 'Reviewing your plan…'
    return 'Gathering coaching context…'
  }

  ctx.onProgress?.('Planning the next steps…')

  for (let round = 0; round < maxRounds; round++) {
    const response = await chat({ system, messages, tools, temperature: 0.2, maxOutputTokens: 2600 })
    messages.push(response.message)
    if (response.toolCalls.length === 0) {
      messages.push({ role: 'user', text: `You must finish by calling ${finalTool}. Use the available read tools first if more evidence is needed.` })
      continue
    }

    const results: ToolResult[] = []
    for (const call of response.toolCalls) {
      ctx.onProgress?.(progressLabel(call.name))
      toolCallCount++
      if (toolCallCount > maxToolCalls) throw new AiError('The coaching agent exhausted its tool budget. Try a simpler request.')
      if (!registered.has(call.name)) {
        results.push({ id: call.id, name: call.name, result: { error: `Tool not allowed in this workflow: ${call.name}` } })
        continue
      }
      try {
        const result = await run(call.name, call.args, agentCtx)
        if (call.name === finalTool) return result as R
        results.push({ id: call.id, name: call.name, result: (result as object) ?? {} })
      } catch (error) {
        results.push({ id: call.id, name: call.name, result: { error: error instanceof Error ? error.message : 'Tool failed' } })
      }
    }
    messages.push({ role: 'tool', results })
  }

  throw new AiError(`The coaching agent did not complete ${finalTool}. Try again.`)
}
