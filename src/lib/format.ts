/** 417 → "6h 57m", 480 → "8h", 45 → "45m" */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Fixed-decimals string, 1 decimal by default */
export function formatFixed(n: number, digits = 1): string {
  return n.toFixed(digits)
}
