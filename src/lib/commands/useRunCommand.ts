import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { run } from './registry'
import { showToast } from './toast'

/**
 * The UI's entry point into the command spine — the same run() the AI agent
 * calls. Every button/form in the app should dispatch through this instead
 * of touching lib/sync directly (enforced by scripts/check-parity.mjs).
 */
export function useRunCommand() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  return useCallback(
    <A, R>(name: string, args: A): Promise<R> =>
      run<A, R>(name, args, {
        qc,
        navigate,
        source: 'ui',
        confirm: (description) => Promise.resolve(window.confirm(description)),
        onAction: (action) => showToast(action),
      }),
    [qc, navigate],
  )
}
