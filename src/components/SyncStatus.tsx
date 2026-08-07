import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useSyncState } from '@/hooks/useSyncState'
import { flush } from '@/lib/sync'

const styles: Record<string, { label: string; className: string }> = {
  idle: { label: 'Synced', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  pending: { label: 'Unsaved', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  syncing: { label: 'Syncing…', className: 'bg-sky-50 text-sky-700 border-sky-200' },
  offline: { label: 'Offline', className: 'bg-muted text-muted-foreground' },
  'auth-error': { label: 'Token expired', className: 'bg-red-50 text-red-700 border-red-200' },
  error: { label: 'Sync error', className: 'bg-red-50 text-red-700 border-red-200' },
}

export default function SyncStatus() {
  const state = useSyncState()
  const style = styles[state.status] ?? styles.idle
  const suffix = state.pendingCount > 0 && state.status !== 'syncing' ? ` (${state.pendingCount})` : ''
  return (
    <button type="button" onClick={() => void flush()} title={state.error ?? 'Click to sync now'} className="ml-auto">
      <Badge variant="outline" className={cn('font-medium', style.className)}>
        {style.label}
        {suffix}
      </Badge>
    </button>
  )
}
