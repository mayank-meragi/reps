import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getConfig, setConfig } from '@/lib/cache'
import { validateToken } from '@/lib/github'
import { keyConfigFor, PROVIDER_LABEL, PROVIDERS, type Provider } from '@/lib/llm'
import { ensureSeedFiles } from '@/lib/sync'

const KEY_HELP: Record<Provider, { label: string; href: string }> = {
  gemini: { label: 'aistudio.google.com/apikey (free)', href: 'https://aistudio.google.com/apikey' },
  openai: { label: 'platform.openai.com/api-keys', href: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'console.anthropic.com', href: 'https://console.anthropic.com/settings/keys' },
}

interface Props {
  expired?: boolean
  onDone: () => void
}

export default function Onboarding({ expired, onDone }: Props) {
  const [repo, setRepo] = useState(getConfig('dataRepo') ?? '')
  const [branch, setBranch] = useState(getConfig('dataBranch') ?? 'main')
  const [token, setToken] = useState('')
  const [provider, setProvider] = useState<Provider>('gemini')
  const [aiKey, setAiKey] = useState(getConfig('geminiKey') ?? '')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect() {
    setError(null)
    if (!repo.includes('/')) {
      setError('Repo must be in the form owner/name, e.g. you/reps-data')
      return
    }
    setChecking(true)
    try {
      const check = await validateToken(repo.trim(), token.trim(), branch.trim())
      if (!check.ok) {
        setError(check.error ?? 'Connection failed')
        return
      }
      setConfig('dataRepo', repo.trim())
      setConfig('dataBranch', branch.trim())
      setConfig('githubToken', token.trim())
      setConfig('aiProvider', provider === 'gemini' ? null : provider)
      setConfig(keyConfigFor(provider), aiKey.trim() || null)
      await ensureSeedFiles()
      onDone()
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reps</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your training, programmed and tracked by AI, stored as files in your own private GitHub repo.
        </p>
      </div>
      {expired && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Your GitHub token was rejected — it has likely expired. Create a new one and paste it below.
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Create a fine-grained GitHub token</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open{' '}
              <a
                className="break-all text-primary underline underline-offset-4"
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
              >
                github.com/settings/personal-access-tokens/new
              </a>
            </li>
            <li>
              Repository access → <b className="text-foreground">Only select repositories</b> → pick your data repo
            </li>
            <li>
              Permissions → Repository permissions → <b className="text-foreground">Contents: Read and write</b>
            </li>
            <li>Set expiration (max 1 year), generate, and copy the token</li>
          </ol>
          <p className="mt-3 text-xs">
            The token is stored only in this browser's localStorage and sent only to api.github.com.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ob-repo">Data repo (owner/name)</Label>
            <Input id="ob-repo" placeholder="you/reps-data" value={repo} onChange={(e) => setRepo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-branch">Data branch</Label>
            <Input id="ob-branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-token">GitHub token</Label>
            <Input
              id="ob-token"
              type="password"
              placeholder="github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-ai">AI key (required — this app is AI-first)</Label>
            <div className="flex gap-2">
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm shadow-xs"
                value={provider}
                onChange={(e) => setProvider(e.target.value as Provider)}
              >
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABEL[p]}
                  </option>
                ))}
              </select>
              <Input
                id="ob-ai"
                type="password"
                placeholder={provider === 'gemini' ? 'AIza…' : provider === 'openai' ? 'sk-…' : 'sk-ant-…'}
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Get a key at{' '}
              <a
                className="text-primary underline underline-offset-4"
                href={KEY_HELP[provider].href}
                target="_blank"
                rel="noreferrer"
              >
                {KEY_HELP[provider].label}
              </a>
              .
            </p>
          </div>
          {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button className="w-full" disabled={checking || !repo || !token || !aiKey} onClick={() => void connect()}>
            {checking ? 'Checking…' : 'Connect'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
