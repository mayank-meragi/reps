export function fileQueryKey(path: string) {
  return ['file', path] as const
}
