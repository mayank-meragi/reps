import { useSyncExternalStore } from 'react'
import { subscribeSync, getSyncState } from '@/lib/sync'

export function useSyncState() {
  return useSyncExternalStore(
    (onChange) => subscribeSync(() => onChange()),
    getSyncState,
  )
}
