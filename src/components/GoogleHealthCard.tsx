import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useHealthStatus } from '@/hooks/useHealth'
import { getConfig, setConfig } from '@/lib/cache'
import { useRunCommand } from '@/lib/commands/useRunCommand'
import { connectGoogle, disconnectGoogle } from '@/lib/google/auth'
import { healthKeys } from '@/lib/queryKeys'

/**
 * Credential entry and the Google consent popup stay local to the UI (a
 * security boundary); everything else dispatches through the health.* commands.
 */
export default function GoogleHealthCard() {
  const runCommand = useRunCommand()
  const qc = useQueryClient()
  const { data: status } = useHealthStatus()
  const [clientId, setClientId] = useState(getConfig('googleClientId') ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: healthKeys.all })

  async function attempt(label: string, fn: () => Promise<unknown>) {
    setBusy(true)
    setNotice(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setNotice(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  function saveClientId() {
    setConfig('googleClientId', clientId.trim() || null)
    void refresh()
    setNotice('Saved.')
  }

  const synced = status?.types.filter((t) => t.lastSyncAt) ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Google Health</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="google-client-id">OAuth client ID</Label>
          <Input id="google-client-id" placeholder="123456789-abc.apps.googleusercontent.com" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <p className="text-xs text-muted-foreground">Web application client with this site's origin under Authorized JavaScript origins. Stored only in this browser.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={saveClientId}>
            Save
          </Button>
          {status?.connected ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void attempt('Disconnect', disconnectGoogle)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" disabled={busy || !status?.clientIdConfigured} onClick={() => void attempt('Connect', () => connectGoogle())}>
              Connect Google
            </Button>
          )}
          <Button size="sm" disabled={busy || !status?.connected} onClick={() => void attempt('Sync', () => runCommand('health.sync', {}))}>
            {busy ? 'Working…' : 'Sync now'}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {status?.connected
            ? `Connected until ${new Date(status.sessionExpiresAt ?? '').toLocaleTimeString()} — reconnect after that to keep syncing.`
            : status?.clientIdConfigured
              ? 'Not connected.'
              : 'Add the client ID to connect.'}
        </p>
        {synced.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Records</TableHead>
                <TableHead>Newest</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {synced.map((t) => (
                <TableRow key={t.type} title={t.error ?? undefined}>
                  <TableCell className="font-mono">{t.type}</TableCell>
                  <TableCell>{t.count}</TableCell>
                  <TableCell>{t.error ? <span className="text-destructive">error</span> : (t.newestDate ?? '—')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
