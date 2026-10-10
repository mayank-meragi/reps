import { getConfig, setConfig } from '@/lib/cache'

/**
 * Google sign-in for the browser-only app: the Identity Services token client
 * needs just the OAuth client ID (Settings), no client secret and no backend.
 * It yields a ~1h access token with no refresh token; reconnecting re-issues one.
 *
 * Security boundary: the consent popup and token storage stay local to the UI
 * (like entering an API key). Everything the token unlocks is exposed through
 * the health.* commands.
 */

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/googlehealth.'
export const GOOGLE_HEALTH_SCOPES = [
  'activity_and_fitness.readonly',
  'health_metrics_and_measurements.readonly',
  'sleep.readonly',
].map((s) => SCOPE_PREFIX + s)

const GSI_SRC = 'https://accounts.google.com/gsi/client'

export class GoogleAuthError extends Error {}

interface TokenResponse {
  access_token?: string
  expires_in?: number | string
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string
        scope: string
        include_granted_scopes?: boolean
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type?: string; message?: string }) => void
      }): TokenClient
      revoke(token: string, done?: () => void): void
    }
  }
}

let gsiLoading: Promise<GoogleGlobal> | null = null

function loadGsi(): Promise<GoogleGlobal> {
  const existing = (window as unknown as { google?: GoogleGlobal }).google
  if (existing?.accounts?.oauth2) return Promise.resolve(existing)
  gsiLoading ??= new Promise<GoogleGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.onload = () => resolve((window as unknown as { google: GoogleGlobal }).google)
    script.onerror = () => {
      gsiLoading = null
      reject(new GoogleAuthError('Could not load Google sign-in (offline?)'))
    }
    document.head.appendChild(script)
  })
  return gsiLoading
}

export function getGoogleClientId(): string | null {
  return getConfig('googleClientId')
}

/** The stored access token, or null when absent or within a minute of expiry. */
export function getGoogleToken(): string | null {
  const token = getConfig('googleToken')
  const expiry = Number(getConfig('googleTokenExpiry') ?? 0)
  if (!token || Date.now() > expiry - 60_000) return null
  return token
}

export function googleTokenExpiry(): string | null {
  const expiry = Number(getConfig('googleTokenExpiry') ?? 0)
  return expiry ? new Date(expiry).toISOString() : null
}

/** Open the consent popup (must run from a user gesture the first time) and store the token. */
export async function connectGoogle(opts: { silent?: boolean } = {}): Promise<void> {
  const clientId = getGoogleClientId()
  if (!clientId) throw new GoogleAuthError('Set the Google OAuth client ID in Settings first')
  const google = await loadGsi()
  await new Promise<void>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_HEALTH_SCOPES.join(' '),
      // GIS merges earlier grants into new tokens by default; the Health API rejects tokens carrying other scopes
      include_granted_scopes: false,
      callback: (r) => {
        if (!r.access_token) {
          reject(new GoogleAuthError(r.error_description ?? r.error ?? 'Google did not return a token'))
          return
        }
        setConfig('googleToken', r.access_token)
        setConfig('googleTokenExpiry', String(Date.now() + Number(r.expires_in ?? 3600) * 1000))
        resolve()
      },
      error_callback: (e) => reject(new GoogleAuthError(e.message ?? e.type ?? 'Google sign-in was cancelled')),
    })
    client.requestAccessToken(opts.silent ? { prompt: 'none' } : {})
  })
}

export async function disconnectGoogle(): Promise<void> {
  const token = getConfig('googleToken')
  setConfig('googleToken', null)
  setConfig('googleTokenExpiry', null)
  if (token) {
    try {
      const google = await loadGsi()
      google.accounts.oauth2.revoke(token)
    } catch {
      /* offline: the token is forgotten locally and expires on its own */
    }
  }
}
