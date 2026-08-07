import { getConfig, getDataBranch } from './cache'

export class TokenInvalidError extends Error {}
export class ConflictError extends Error {}
export class OfflineError extends Error {}
export class GitHubApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const API = 'https://api.github.com'

/** UTF-8-safe base64 — naive btoa throws on non-ASCII characters */
export function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function fromB64(b64: string): string {
  // The Contents API wraps base64 with newlines
  const clean = b64.replace(/\s/g, '')
  return new TextDecoder().decode(Uint8Array.from(atob(clean), (c) => c.charCodeAt(0)))
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function requireAuth(): { token: string; repo: string; branch: string } {
  const token = getConfig('githubToken')
  const repo = getConfig('dataRepo')
  if (!token || !repo) throw new TokenInvalidError('GitHub token or repo not configured')
  return { token, repo, branch: getDataBranch() }
}

async function request(url: string, token: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { ...authHeaders(token), ...(init?.headers ?? {}) } })
  } catch {
    throw new OfflineError('GitHub unreachable')
  }
  if (res.status === 401) throw new TokenInvalidError('GitHub token rejected or expired')
  return res
}

export interface RemoteFile {
  content: string
  sha: string
}

/** Read a file from the data branch. Returns null if it does not exist. */
export async function getFile(path: string): Promise<RemoteFile | null> {
  const { token, repo, branch } = requireAuth()
  const res = await request(
    `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    token,
  )
  if (res.status === 404) return null
  if (!res.ok) throw new GitHubApiError(res.status, `GET ${path} failed: ${res.status}`)
  const json = await res.json()
  return { content: fromB64(json.content), sha: json.sha }
}

/**
 * Create or update a file on the data branch. Pass the current sha when
 * updating; a stale sha raises ConflictError.
 */
export async function putFile(
  path: string,
  content: string,
  sha: string | null,
  message: string,
): Promise<{ sha: string }> {
  const { token, repo, branch } = requireAuth()
  const res = await request(`${API}/repos/${repo}/contents/${path}`, token, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toB64(content), branch, ...(sha ? { sha } : {}) }),
  })
  if (res.status === 409 || res.status === 422) {
    throw new ConflictError(`sha conflict writing ${path}`)
  }
  if (!res.ok) throw new GitHubApiError(res.status, `PUT ${path} failed: ${res.status}`)
  const json = await res.json()
  return { sha: json.content.sha }
}

/** Delete a file on the data branch. Requires the current blob sha. */
export async function deleteFile(path: string, sha: string, message: string): Promise<void> {
  const { token, repo, branch } = requireAuth()
  const res = await request(`${API}/repos/${repo}/contents/${path}`, token, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch }),
  })
  if (!res.ok && res.status !== 404) {
    throw new GitHubApiError(res.status, `DELETE ${path} failed: ${res.status}`)
  }
}

/** List a directory on the data branch. Returns [] if it does not exist. */
export async function listDir(path: string): Promise<{ name: string; sha: string }[]> {
  const { token, repo, branch } = requireAuth()
  const res = await request(
    `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    token,
  )
  if (res.status === 404) return []
  if (!res.ok) throw new GitHubApiError(res.status, `GET ${path} failed: ${res.status}`)
  const json = await res.json()
  if (!Array.isArray(json)) return []
  return json.map((f: { name: string; sha: string }) => ({ name: f.name, sha: f.sha }))
}

export interface TokenCheck {
  ok: boolean
  error?: string
}

/** Validate explicit credentials before saving them (onboarding). */
export async function validateToken(repo: string, token: string, branch: string): Promise<TokenCheck> {
  let res: Response
  try {
    res = await fetch(`${API}/repos/${repo}`, { headers: authHeaders(token) })
  } catch {
    return { ok: false, error: 'Network error — are you offline?' }
  }
  if (res.status === 401) return { ok: false, error: 'Token rejected. Check that you copied the full token.' }
  if (res.status === 404) {
    return {
      ok: false,
      error: `Repo "${repo}" not found. Check the name, and that the token has access to this repository.`,
    }
  }
  if (!res.ok) return { ok: false, error: `GitHub returned ${res.status}.` }
  const json = await res.json()
  if (!json.permissions?.push) {
    return { ok: false, error: 'Token does not have write (Contents: Read and write) permission on this repo.' }
  }
  const branchRes = await fetch(`${API}/repos/${repo}/branches/${encodeURIComponent(branch)}`, {
    headers: authHeaders(token),
  })
  if (branchRes.status === 404) {
    return { ok: false, error: `Branch "${branch}" does not exist in ${repo}.` }
  }
  return { ok: true }
}
