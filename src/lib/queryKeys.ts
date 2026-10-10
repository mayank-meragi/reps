export function fileQueryKey(path: string) {
  return ['file', path] as const
}

/** Every Google Health query lives under ['health'], so one invalidation refreshes them all. */
export const healthKeys = {
  all: ['health'] as const,
  status: ['health', 'status'] as const,
  monitor: (date: string) => ['health', 'monitor', date] as const,
  scores: (date: string) => ['health', 'scores', date] as const,
}
