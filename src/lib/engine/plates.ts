export interface PlateResult {
  /** Plates for ONE side, largest first. */
  perSide: number[]
  achievedKg: number
}

/**
 * What to actually load on the bar. Greedily fills each side from the
 * available plate inventory (assumes at least two of everything, which is
 * how a home/gym plate set works) and reports the achievable weight when the
 * inventory can't hit the target exactly.
 */
export function plateMath(targetKg: number, barKg: number, inventory: number[]): PlateResult {
  const perSideTarget = (targetKg - barKg) / 2
  if (perSideTarget <= 0) return { perSide: [], achievedKg: barKg }

  const sorted = [...inventory].filter((p) => p > 0).sort((a, b) => b - a)
  const perSide: number[] = []
  let remaining = perSideTarget
  for (const plate of sorted) {
    while (remaining >= plate - 0.001) {
      perSide.push(plate)
      remaining -= plate
    }
  }
  const achievedKg = barKg + 2 * perSide.reduce((s, p) => s + p, 0)
  return { perSide, achievedKg: Math.round(achievedKg * 2) / 2 }
}

export const STANDARD_PLATE_INVENTORY_KG = [25, 20, 15, 10, 5, 2.5, 1.25]
export const STANDARD_BARBELL_KG = 20
