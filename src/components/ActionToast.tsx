import { useSyncExternalStore } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dismissToast, getToast, subscribeToast } from '@/lib/commands/toast'

/** The visible half of the shared undo stack — any command's write surfaces here. */
export default function ActionToast() {
  const toast = useSyncExternalStore(subscribeToast, getToast)
  if (!toast) return null

  return (
    <div className="fixed inset-x-0 bottom-32 z-30 flex justify-center px-4 md:bottom-6">
      <div className="flex items-center gap-3 rounded-full bg-[var(--ink-900)] py-2 pl-4 pr-2 text-sm text-white shadow-lg">
        <span>{toast.label}</span>
        {toast.undo && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 rounded-full px-2 text-white hover:bg-white/10 hover:text-white"
            onClick={() => {
              void toast.undo?.()
              dismissToast()
            }}
          >
            <RotateCcw className="size-3.5" /> Undo
          </Button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismissToast}
          className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
