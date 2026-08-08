import type { QueryClient } from '@tanstack/react-query'

export interface AgentAction {
  label: string
  undo?: () => void | Promise<void>
}

export interface CommandContext {
  qc: QueryClient
  navigate: (path: string) => void
  /** Ask the user before a destructive step; resolves false on decline. */
  confirm: (description: string) => Promise<boolean>
  source: 'ui' | 'ai' | 'system'
  /** Report a completed write so the UI can render an action card with undo. */
  onAction?: (action: AgentAction) => void
  /** Report meaningful progress from a multi-step AI workflow. */
  onProgress?: (message: string) => void
}
