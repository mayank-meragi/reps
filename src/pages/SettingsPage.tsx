import { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getConfig, setConfig, clearFileCache } from '@/lib/cache'
import { keyConfigFor, modelConfigFor, PROVIDER_LABEL, PROVIDERS, DEFAULT_MODEL, type Provider } from '@/lib/llm'
import { commandCoverage } from '@/lib/commands'
import VenuesManager from '@/components/VenuesManager'
import GoogleHealthCard from '@/components/GoogleHealthCard'
import { PATHS } from '@/lib/paths'
import { useFileQuery } from '@/hooks/useData'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import type { CoachMemory } from '@/lib/types'

const emptyMemory: CoachMemory = { summary: '', updatedAt: '', sessionCount: 0 }

function CoachMemoryCard() {
  const runCommand = useRunCommand()
  const { data, isLoading } = useFileQuery<CoachMemory>(PATHS.coachMemory, emptyMemory)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setSummary(data?.summary ?? '')
  }, [data?.updatedAt, data?.summary])

  async function saveMemory() {
    setBusy(true)
    setNotice(null)
    try {
      await runCommand('memory.update', { summary })
      setNotice(summary.trim() ? 'Coach profile updated.' : 'Coach profile cleared.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not update the coach profile')
    } finally {
      setBusy(false)
    }
  }

  const changed = summary.trim() !== (data?.summary ?? '').trim()
  const updated = data?.updatedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.updatedAt))
    : null

  return (
    <Card className="overflow-hidden ring-1 ring-[var(--emerald-200)]">
      <div className="bg-[var(--emerald-50)] px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--emerald-600)] text-white"><Brain className="size-5" /></span>
          <div>
            <CardTitle className="text-base text-[var(--emerald-700)]">What your coach knows</CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-[var(--emerald-700)]/75">
              These durable notes help the AI remember your preferences, dislikes, working weights, limitations, and recurring patterns.
            </p>
          </div>
        </div>
      </div>
      <CardContent className="space-y-3 py-4">
        <textarea
          aria-label="Coach profile"
          value={summary}
          disabled={isLoading}
          onChange={(event) => {
            setSummary(event.target.value)
            setNotice(null)
          }}
          placeholder="Nothing has been learned yet. Tell the coach about a preference or training pattern and it can remember it here."
          className="min-h-52 w-full resize-y rounded-xl bg-[var(--surface-sunken)] px-3 py-3 text-sm leading-relaxed text-foreground outline-none ring-1 ring-[var(--border-subtle)] placeholder:text-muted-foreground focus:ring-2 focus:ring-[var(--focus-ring)] disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-[10px] text-muted-foreground">
            <p>Stored in your data repository as coach-memory.json.</p>
            {updated && <p>Last updated {updated}</p>}
          </div>
          <Button size="sm" disabled={busy || !changed} onClick={() => void saveMemory()}>
            {busy ? 'Saving…' : 'Save corrections'}
          </Button>
        </div>
        {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      </CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  const [provider, setProvider] = useState<Provider>((getConfig('aiProvider') as Provider) || 'gemini')
  const [aiKey, setAiKey] = useState(getConfig(keyConfigFor(provider)) ?? '')
  const [model, setModel] = useState(getConfig(modelConfigFor(provider)) ?? '')

  function selectProvider(p: Provider) {
    setProvider(p)
    setAiKey(getConfig(keyConfigFor(p)) ?? '')
    setModel(getConfig(modelConfigFor(p)) ?? '')
  }

  function save() {
    setConfig('aiProvider', provider)
    setConfig(keyConfigFor(provider), aiKey.trim() || null)
    setConfig(modelConfigFor(provider), model.trim() || null)
  }

  const coverage = commandCoverage()

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <CoachMemoryCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Data repo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            Repo: <span className="text-foreground">{getConfig('dataRepo') || '(not set)'}</span>
          </p>
          <p>
            Branch: <span className="text-foreground">{getConfig('dataBranch') || 'main'}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">AI provider</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => selectProvider(p)}
                className={
                  p === provider
                    ? 'rounded-full bg-[var(--ink-900)] px-3 py-1 text-xs font-semibold text-white'
                    : 'rounded-full border border-input px-3 py-1 text-xs text-muted-foreground'
                }
              >
                {PROVIDER_LABEL[p]}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-key">API key</Label>
            <Input id="settings-key" type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-model">Model</Label>
            <Input id="settings-model" placeholder={DEFAULT_MODEL[provider]} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </CardContent>
      </Card>

      <GoogleHealthCard />

      <VenuesManager />

      <details className="rounded-xl bg-card shadow-sm ring-1 ring-foreground/[0.045]">
        <summary className="cursor-pointer px-4 py-4 text-sm font-semibold">Advanced · AI capabilities</summary>
        <div className="border-t border-border px-4 py-4">
          <p className="mb-2 text-xs text-muted-foreground">
            Every registered action is available to both the interface and the AI coach.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Command</th>
                  <th className="py-1 pr-3 font-medium">Kind</th>
                  <th className="py-1 pr-3 font-medium">AI</th>
                  <th className="py-1 font-medium">Undo</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.name} className="border-t border-border">
                    <td className="py-1 pr-3 font-mono">{c.name}</td>
                    <td className="py-1 pr-3">{c.kind}</td>
                    <td className="py-1 pr-3">{c.aiExposed ? 'yes' : 'no'}</td>
                    <td className="py-1">{c.hasUndo ? 'yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-destructive">Danger zone</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => {
              if (window.confirm('Clear the local cache and re-sync from GitHub? Unsaved local changes will be lost.')) {
                clearFileCache()
                window.location.reload()
              }
            }}
          >
            Clear local cache
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
