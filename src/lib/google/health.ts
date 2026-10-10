import { OfflineError } from '@/lib/github'
import { getGoogleToken, GoogleAuthError } from './auth'
import { kebabToCamel, kebabToSnake, type HealthDataType } from './dataTypes'

const BASE = 'https://health.googleapis.com/v4'

export class GoogleHealthApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export interface DataPoint {
  name?: string
  dataSource?: unknown
  [field: string]: unknown
}

interface ListResponse {
  dataPoints?: DataPoint[]
  nextPageToken?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = getGoogleToken()
  if (!token) throw new GoogleAuthError('Google Health is not connected, or the session expired — reconnect in Settings')
  const url = `${BASE}${path}?${new URLSearchParams(params)}`
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    } catch {
      throw new OfflineError('Google Health unreachable')
    }
    if (res.status === 401) throw new GoogleAuthError('Google rejected the token — reconnect in Settings')
    // Google asks clients to retry 429/504 with exponential backoff
    if ((res.status === 429 || res.status === 504) && attempt < 4) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    if (!res.ok) {
      let body = await res.text().catch(() => '')
      if (res.status === 403 && body.includes('DISALLOWED_OAUTH_SCOPES')) body += await describeTokenScopes(token)
      throw new GoogleHealthApiError(res.status, `GET ${path} failed: ${res.status} ${body.slice(0, 300)}`)
    }
    return (await res.json()) as T
  }
}

/** Appended to scope errors so the message shows which scopes the token really carries. */
async function describeTokenScopes(token: string): Promise<string> {
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`)
    const info = (await res.json()) as { scope?: string }
    return `\nToken scopes: ${info.scope?.split(' ').join(', ') ?? 'unknown'}`
  } catch {
    return ''
  }
}

/** Confirms the Google account is linked to Google Health (400 ACCOUNT_NOT_LINKED otherwise). */
export function getIdentity() {
  return get<{ healthUserId?: string; legacyUserId?: string }>('/users/me/identity', {})
}

/** Filter for "everything on or after `sinceDate`" (YYYY-MM-DD), using the field each record kind supports. */
export function buildFilter(type: HealthDataType, sinceDate: string, daily: 'snake' | 'camel' = 'snake'): string {
  const snake = kebabToSnake(type.id)
  switch (type.kind) {
    case 'interval':
      return `${snake}.interval.civil_start_time >= "${sinceDate}"`
    case 'sample':
      return `${snake}.sample_time.civil_time >= "${sinceDate}"`
    case 'daily':
      return `${daily === 'snake' ? snake : kebabToCamel(type.id)}.date >= "${sinceDate}"`
    case 'session':
      // Sleep is keyed by when it ended (a night spans two dates)
      return type.id === 'sleep'
        ? `sleep.interval.civil_end_time >= "${sinceDate}"`
        : `${snake}.interval.civil_start_time >= "${sinceDate}"`
  }
}

/**
 * Page through every point of a type on or after `sinceDate`, handing each page
 * to `onPage` so huge types (raw heart rate: ~38k points a day) never sit in
 * memory at once. Pages arrive newest-first.
 */
export async function forEachDataPointPage(
  type: HealthDataType,
  sinceDate: string,
  onPage: (points: DataPoint[]) => void,
): Promise<void> {
  let daily: 'snake' | 'camel' = 'snake'
  let pageToken: string | undefined
  do {
    // Default pages are tiny (50 records for per-minute types); ask for the maximum (the API truncates it per type)
    const params: Record<string, string> = { filter: buildFilter(type, sinceDate, daily), pageSize: '10000' }
    if (pageToken) params.pageToken = pageToken
    let page: ListResponse
    try {
      page = await get<ListResponse>(`/users/me/dataTypes/${type.id}/dataPoints`, params)
    } catch (e) {
      // The docs show daily filters in both snake_case and camelCase; retry once with the other spelling
      if (e instanceof GoogleHealthApiError && e.status === 400 && type.kind === 'daily' && daily === 'snake' && !pageToken) {
        daily = 'camel'
        continue
      }
      throw e
    }
    onPage(page.dataPoints ?? [])
    pageToken = page.nextPageToken || undefined
  } while (pageToken)
}

/** Every point of a type on or after `sinceDate`. Fine for small types; use forEachDataPointPage for big ones. */
export async function listAllDataPoints(type: HealthDataType, sinceDate: string): Promise<DataPoint[]> {
  const points: DataPoint[] = []
  await forEachDataPointPage(type, sinceDate, (page) => points.push(...page))
  return points
}

// ---- Mapping a DataPoint onto our indexed fields ----

interface Civil {
  year?: number
  month?: number
  day?: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const civilToDate = (c: unknown): string | null => {
  const d = c as Civil | undefined
  return d?.year && d.month && d.day ? `${d.year}-${pad(d.month)}-${pad(d.day)}` : null
}
const asObj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined)

export interface IndexedPoint {
  id: string
  date: string
  start: string | null
  end: string | null
}

/** Extract id, civil date and times from a point; null if the point has no usable date. */
export function indexDataPoint(type: HealthDataType, point: DataPoint): IndexedPoint | null {
  const body = asObj(point[kebabToCamel(type.id)])
  if (!body) return null
  const interval = asObj(body.interval)
  const sample = asObj(body.sampleTime)
  let start: string | null = null
  let end: string | null = null
  let date: string | null = null
  if (interval) {
    start = (interval.startTime as string) ?? null
    end = (interval.endTime as string) ?? null
    const civil = type.id === 'sleep' ? interval.civilEndTime : interval.civilStartTime
    date = civilToDate(asObj(civil)?.date)
  } else if (sample) {
    start = (sample.physicalTime as string) ?? null
    date = civilToDate(asObj(sample.civilTime)?.date)
  } else {
    date = civilToDate(body.date)
  }
  date ??= (end ?? start)?.slice(0, 10) ?? null
  if (!date) return null
  return { id: point.name ?? `${start ?? date}|${end ?? ''}`, date, start, end }
}
