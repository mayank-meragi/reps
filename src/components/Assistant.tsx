import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Check, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { runAgentTurn, type ChatMessage } from '@/lib/agent/agent'
import type { AgentAction } from '@/lib/commands/context'
import { AiError, hasAiKey, NoAiKeyError } from '@/lib/llm'

type ChatItem =
  | { kind: 'text'; id: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'action'; id: string; label: string; undo?: () => void | Promise<void>; undone?: boolean }

interface PendingConfirm {
  description: string
  resolve: (approved: boolean) => void
}

const SUGGESTIONS = [
  'Start a strength session',
  'Log bench 3x8 at 60kg',
  'Log a 30 minute walk',
  'What did I train this week?',
]

export default function Assistant() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ChatItem[]>([])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [items, pendingConfirm, busy])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    const openCoach = () => setOpen(true)
    window.addEventListener('reps:open-assistant', openCoach)
    return () => window.removeEventListener('reps:open-assistant', openCoach)
  }, [])

  function push(item: ChatItem) {
    setItems((prev) => [...prev, item])
  }

  async function send(message: string) {
    const text = message.trim()
    if (!text || busy) return
    setInput('')
    push({ kind: 'text', id: crypto.randomUUID(), role: 'user', text })
    setBusy(true)
    try {
      const result = await runAgentTurn(text, history, {
        qc,
        navigate,
        confirm: (description) =>
          new Promise<boolean>((resolve) => {
            setPendingConfirm({
              description,
              resolve: (approved) => {
                setPendingConfirm(null)
                resolve(approved)
              },
            })
          }),
        onAction: (action: AgentAction) => {
          const id = crypto.randomUUID()
          push({ kind: 'action', id, label: action.label, undo: action.undo })
        },
      })
      setHistory(result.history)
      push({ kind: 'text', id: crypto.randomUUID(), role: 'assistant', text: result.reply })
    } catch (e) {
      const message_ =
        e instanceof NoAiKeyError
          ? 'The assistant needs an AI key — add one in Settings.'
          : e instanceof AiError
            ? e.message
            : 'Something went wrong — try again.'
      push({ kind: 'text', id: crypto.randomUUID(), role: 'assistant', text: message_ })
    } finally {
      setBusy(false)
    }
  }

  function undoAction(id: string) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.kind !== 'action' || item.id !== id || item.undone || !item.undo) return item
        void item.undo()
        return { ...item, undone: true }
      }),
    )
  }

  return (
    <>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-40 md:inset-x-auto md:right-8 md:bottom-8 md:w-[420px]">
          <div className="mx-auto flex max-h-[80svh] w-full flex-col overflow-hidden rounded-t-[28px] bg-[var(--surface-card)] shadow-xl ring-1 ring-[var(--border-subtle)] md:h-[600px] md:max-h-[80vh] md:rounded-[28px]">
            {/* Header */}
            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-[var(--ink-900)] text-white">
                <Sparkles className="size-4" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--text-strong)]">Coach</p>
                <p className="text-[10px] text-muted-foreground">can do anything you can do in the app</p>
              </div>
              {items.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear conversation"
                  className="text-muted-foreground"
                  onClick={() => {
                    setItems([])
                    setHistory([])
                  }}
                >
                  <Trash2 />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
              {items.length === 0 && !busy && (
                <div className="space-y-2 py-4">
                  <p className="text-center text-xs text-muted-foreground">Ask anything, or tell me what to log.</p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => void send(s)}
                        className="rounded-full bg-[var(--surface-sunken)] px-3 py-1.5 text-xs font-medium text-[var(--text-body)] transition-colors hover:bg-[var(--ink-100)]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {items.map((item) =>
                item.kind === 'text' ? (
                  <div
                    key={item.id}
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
                      item.role === 'user'
                        ? 'ml-auto rounded-br-md bg-[var(--ink-900)] text-white'
                        : 'mr-auto rounded-bl-md bg-[var(--surface-sunken)] text-[var(--text-body)]',
                    )}
                  >
                    {item.text}
                  </div>
                ) : (
                  <div
                    key={item.id}
                    className={cn(
                      'mr-auto flex max-w-[92%] items-center gap-2 rounded-2xl px-3 py-2 text-xs font-medium ring-1',
                      item.undone
                        ? 'bg-[var(--surface-sunken)] text-muted-foreground line-through ring-[var(--border-subtle)]'
                        : 'bg-[var(--emerald-50)] text-[var(--emerald-700)] ring-[var(--emerald-200)]',
                    )}
                  >
                    <Check className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">{item.label}</span>
                    {item.undo && !item.undone && (
                      <button
                        type="button"
                        onClick={() => undoAction(item.id)}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[var(--text-body)] ring-1 ring-[var(--border-default)]"
                      >
                        <RotateCcw className="size-2.5" />
                        Undo
                      </button>
                    )}
                  </div>
                ),
              )}
              {pendingConfirm && (
                <div className="mr-auto max-w-[92%] space-y-2 rounded-2xl bg-[var(--negative-100)] px-3.5 py-2.5 text-sm text-[var(--negative-600)]">
                  <p className="font-medium">{pendingConfirm.description}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => pendingConfirm.resolve(true)}
                      className="rounded-full bg-[var(--negative-600)] px-3 py-1 text-xs font-bold text-white"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => pendingConfirm.resolve(false)}
                      className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[var(--text-body)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {busy && !pendingConfirm && (
                <div className="mr-auto flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-[var(--surface-sunken)] px-3.5 py-2.5">
                  <span className="size-1.5 animate-bounce rounded-full bg-[var(--ink-400)] [animation-delay:0ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-[var(--ink-400)] [animation-delay:120ms]" />
                  <span className="size-1.5 animate-bounce rounded-full bg-[var(--ink-400)] [animation-delay:240ms]" />
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-[var(--border-subtle)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] py-1.5 pr-1.5 pl-4">
                <input
                  ref={inputRef}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-strong)] outline-none placeholder:text-[var(--text-subtle)]"
                  placeholder={hasAiKey() ? 'Ask or command…' : 'Add an AI key in Settings first'}
                  value={input}
                  disabled={busy}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void send(input)
                  }}
                />
                <button
                  type="button"
                  onClick={() => void send(input)}
                  disabled={busy || !input.trim()}
                  aria-label="Send"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink-900)] text-white transition-transform active:scale-90 disabled:opacity-40"
                >
                  <ArrowUp className="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
