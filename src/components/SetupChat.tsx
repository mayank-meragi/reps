import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Dumbbell } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AiError, NoAiKeyError } from '@/lib/llm'
import { runAgentTurn, type ChatMessage } from '@/lib/agent/agent'

const SETUP_SYSTEM = `You are a friendly coach doing a first consultation inside Reps, an AI-first
training app. Interview the user to build their profile and venues, then wrap up. You have the
full command set available, not a special setup tool — use profile.update, venue.add, and
memory.update directly.

How to interview:
- Ask ONE short question at a time (one or two sentences, no lists, no markdown, no emoji).
- Cover, roughly in this order: their goal; experience level; how many days a week they can
  realistically train; where they train — call venue.add for each place (a gym with its
  equipment, home, a park for walks, a pool, etc; "a normal gym" means broad equipment access);
  injuries or movements to avoid; and their rough current working weights on 2-3 main lifts IF
  they know them off-hand. If they say they don't know, that's completely fine — don't push,
  just move on. This becomes a calibration week where the app starts conservative and learns
  their real numbers from what they log.
- Adapt to what they say; don't re-ask what they already told you.
- Call profile.update as soon as you have goal/experience/daysPerWeek — you can call it again
  later to add injuries/preferences as they come up, rather than waiting to have everything.
- Call venue.add once per place they mention.
- After 5-8 exchanges, call memory.update with everything else worth remembering as "- " bullets
  (age, body weight, sport background, schedule constraints, known working weights, motivation)
  — only what they actually shared — then give a one-or-two sentence wrap-up telling them you're
  ready to build their first program.
- Weights are in kg. Speak plainly, like a good coach, not a form.`

interface Bubble {
  id: string
  role: 'user' | 'assistant'
  text: string
}

interface Props {
  onSkip: () => void
}

/** One-time AI intake: the coach interviews the user, then saves profile + venues + notes. */
export default function SetupChat({ onSkip }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [bubbles, busy])

  async function turn(message: string, show: boolean) {
    setBusy(true)
    if (show) setBubbles((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: message }])
    try {
      const result = await runAgentTurn(
        message,
        history,
        { qc, navigate, confirm: async () => true, onAction: () => {} },
        SETUP_SYSTEM,
      )
      setHistory(result.history)
      setBubbles((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text: result.reply }])
    } catch (e) {
      const text =
        e instanceof NoAiKeyError
          ? 'Setup needs an AI key — add one in Settings, then come back here.'
          : e instanceof AiError
            ? e.message
            : 'Something went wrong — try again.'
      setBubbles((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', text }])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void turn('Hi — set up my training profile.', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    void turn(text, true)
  }

  return (
    <div className="mx-auto max-w-lg space-y-3 px-4 py-10">
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-[var(--ink-900)] text-white">
              <Dumbbell className="size-4" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[var(--text-strong)]">Your coach</p>
              <p className="text-[10px] text-muted-foreground">a few quick questions, once</p>
            </div>
          </div>

          <div ref={scrollRef} className="max-h-[55svh] space-y-2 overflow-y-auto">
            {bubbles.map((b) => (
              <div
                key={b.id}
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
                  b.role === 'user'
                    ? 'ml-auto rounded-br-md bg-[var(--ink-900)] text-white'
                    : 'mr-auto rounded-bl-md bg-[var(--surface-sunken)] text-[var(--text-body)]',
                )}
              >
                {b.text}
              </div>
            ))}
            {busy && (
              <div className="mr-auto flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-[var(--surface-sunken)] px-3.5 py-2.5">
                <span className="size-1.5 animate-bounce rounded-full bg-[var(--ink-400)] [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-[var(--ink-400)] [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-[var(--ink-400)] [animation-delay:240ms]" />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] py-1.5 pr-1.5 pl-4">
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-strong)] outline-none placeholder:text-[var(--text-subtle)]"
              placeholder="Type your answer…"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send()
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ink-900)] text-white transition-transform active:scale-90 disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </CardContent>
      </Card>
      <button type="button" onClick={onSkip} className="w-full text-center text-xs text-muted-foreground underline underline-offset-4">
        Skip for now
      </button>
    </div>
  )
}
