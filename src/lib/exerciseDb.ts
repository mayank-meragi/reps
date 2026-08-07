import type { Exercise } from './types'

/**
 * free-exercise-db: 873 exercises, public domain, step images. One static
 * JSON + images from a CDN — no key, no rate limits. Cached via the Cache
 * API so the library works offline in the gym after first load.
 */
const DB_URL = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/dist/exercises.json'
const IMG_BASE = 'https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/'
const CACHE_NAME = 'reps-exercise-db'

export function exerciseImageUrl(imagePath: string): string {
  if (/^https?:\/\//.test(imagePath)) return imagePath
  return IMG_BASE + imagePath
}

let inMemory: Exercise[] | null = null

/** The base library only — custom exercises are merged in by commands/exercises.ts. */
export async function fetchExerciseLibrary(): Promise<Exercise[]> {
  if (inMemory) return inMemory
  try {
    const cache = await caches.open(CACHE_NAME)
    const hit = await cache.match(DB_URL)
    if (hit) {
      inMemory = (await hit.json()) as Exercise[]
      return inMemory
    }
    const res = await fetch(DB_URL)
    if (!res.ok) throw new Error(`exercise db ${res.status}`)
    await cache.put(DB_URL, res.clone())
    inMemory = (await res.json()) as Exercise[]
    return inMemory
  } catch {
    // Cache API unavailable (or a stale failure) — plain fetch
    const res = await fetch(DB_URL)
    if (!res.ok) throw new Error(`exercise db ${res.status}`)
    inMemory = (await res.json()) as Exercise[]
    return inMemory
  }
}

export function exerciseById(exercises: Exercise[]): Map<string, Exercise> {
  return new Map(exercises.map((e) => [e.id, e]))
}

/** Timed (duration-mode) vs rep-mode, from the library category. */
export function isTimedCategory(category: string): boolean {
  return category === 'cardio' || category === 'stretching'
}
