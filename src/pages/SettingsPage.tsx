import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getConfig, setConfig, clearFileCache } from '@/lib/cache'
import { keyConfigFor, modelConfigFor, PROVIDER_LABEL, PROVIDERS, DEFAULT_MODEL, type Provider } from '@/lib/llm'
import { commandCoverage } from '@/lib/commands'
import VenuesManager from '@/components/VenuesManager'

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

      <VenuesManager />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Command coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-2 text-xs text-muted-foreground">
            Every registered command — the parity contract in practice. Same list `npm run parity` prints.
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
        </CardContent>
      </Card>

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
