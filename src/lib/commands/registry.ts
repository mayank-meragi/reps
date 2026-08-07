import type { JsonSchema, ToolDef } from '@/lib/llm'
import type { CommandContext } from './context'
import { appendActivity } from './log'

/**
 * The command spine (docs/plan.md §3): every mutation and every meaningful
 * read is a Command. The UI dispatches through run(); the AI's tool list is
 * generated from this same registry via toolDefs(). Nothing gets to exist as
 * "UI-only" — that's the parity contract, and scripts/check-parity.mjs
 * enforces the import boundary that makes it stick (lib/sync and lib/github
 * are only importable from here and from lib/data).
 */

export interface Command<A = unknown, R = unknown> {
  /** 'namespace.verb_noun', e.g. 'workout.log_set' */
  name: string
  /** Shown in confirm dialogs and the activity log */
  title: string
  /** Fed verbatim to the LLM as the tool description — write it for the model, not for us */
  description: string
  parameters: JsonSchema
  kind: 'read' | 'write' | 'destructive'
  handler(args: A, ctx: CommandContext): R | Promise<R>
  /** Build the inverse action for the shared undo stack, given the args and result of a successful run. */
  undo?: (args: A, result: R, ctx: CommandContext) => void | Promise<void>
  /** One-line past-tense summary for the activity log and chat/UI action cards. */
  summarize?: (args: A, result: R) => string
}

const registry = new Map<string, Command<never, unknown>>()

export function defineCommand<A, R>(cmd: Command<A, R>): Command<A, R> {
  if (registry.has(cmd.name)) throw new Error(`Duplicate command: ${cmd.name}`)
  registry.set(cmd.name, cmd as Command<never, unknown>)
  return cmd
}

export function allCommands(): Command<never, unknown>[] {
  return [...registry.values()]
}

export class CommandNotFoundError extends Error {
  constructor(name: string) {
    super(`Unknown command: ${name}`)
  }
}

export class ConfirmDeclinedError extends Error {
  constructor(name: string) {
    super(`User declined to confirm: ${name}`)
  }
}

/**
 * Run a command by name. Both UI event handlers and the AI agent call this —
 * it is the ONLY entry point into a write. Destructive commands confirm
 * first (in the UI via a dialog, in chat via the same confirm() prompt).
 * Every write is appended to the activity log, and — when the command
 * defines one — an undo closure is handed to ctx.onAction for the caller
 * to surface (action card, toast, whatever the surface wants).
 */
export async function run<A, R>(name: string, args: A, ctx: CommandContext): Promise<R> {
  const cmd = registry.get(name) as Command<A, R> | undefined
  if (!cmd) throw new CommandNotFoundError(name)

  if (cmd.kind === 'destructive') {
    const approved = await ctx.confirm(cmd.title)
    if (!approved) throw new ConfirmDeclinedError(name)
  }

  const result = await cmd.handler(args, ctx)

  if (cmd.kind !== 'read') {
    const summary = cmd.summarize ? cmd.summarize(args, result) : cmd.title
    const undoFn = cmd.undo ? () => cmd.undo!(args, result, ctx) : undefined
    appendActivity(ctx.qc, {
      source: ctx.source,
      command: name,
      args: args as Record<string, unknown>,
      summary,
      undoable: Boolean(undoFn),
    })
    ctx.onAction?.({ label: summary, undo: undoFn })
  }

  return result
}

/** Tool definitions for the LLM — generated, never hand-written. */
export function toolDefs(): ToolDef[] {
  return allCommands()
    .map((c) => ({ name: c.name, description: c.description, parameters: c.parameters }))
}

/** For scripts/parity-report.mjs and a future Settings → coverage view. */
export function commandCoverage() {
  return allCommands().map((c) => ({
    name: c.name,
    kind: c.kind,
    aiExposed: true,
    hasUndo: Boolean(c.undo),
  }))
}
