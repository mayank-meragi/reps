import type { AgentAction } from './context'

/**
 * Tiny external store for the "last write" toast — the visible half of the
 * undo mechanism. Any surface that calls run() can pass this as onAction and
 * get a consistent Undo affordance for free (see useRunCommand).
 */
export interface ActionToast extends AgentAction {
  id: string
}

let current: ActionToast | null = null
const listeners = new Set<() => void>()
let dismissTimer: ReturnType<typeof setTimeout> | null = null

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getToast(): ActionToast | null {
  return current
}

export function showToast(action: AgentAction): void {
  if (dismissTimer) clearTimeout(dismissTimer)
  current = { ...action, id: crypto.randomUUID() }
  listeners.forEach((l) => l())
  dismissTimer = setTimeout(dismissToast, 6000)
}

export function dismissToast(): void {
  current = null
  listeners.forEach((l) => l())
}
