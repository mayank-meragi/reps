import { Card, CardContent } from '@/components/ui/card'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { HealthScores } from '@/lib/commands/health'
import ScoreRing, { type RingScheme } from './ScoreRing'

export type ScorePanel = 'strain' | 'recovery' | 'sleep'

/** Strain, Recovery and Sleep side by side; tapping one selects it (tap again to deselect) so its breakdown can open. */
export default function ScoreRings({ scores, selected, onSelect }: { scores?: HealthScores; selected: ScorePanel | null; onSelect: (panel: ScorePanel | null) => void }) {
  const recovery = scores?.recovery
  const recoveryScheme: RingScheme = `recovery-${recovery?.zone ?? 'green'}`
  const progress = recovery && (recovery.status === 'calibrating' || recovery.status === 'provisional') ? `${recovery.calibration.have}/${recovery.calibration.need}` : undefined
  return (
    <Card>
      <CardContent>
        <ToggleGroup type="single" value={selected ?? ''} onValueChange={(v) => onSelect((v || null) as ScorePanel | null)} className="w-full justify-between" aria-label="Daily scores">
          <ToggleGroupItem value="strain" aria-label="Strain" className="h-auto flex-1 p-2">
            <ScoreRing value={scores?.strain.score ?? null} label="Strain" scheme="strain" />
          </ToggleGroupItem>
          <ToggleGroupItem value="recovery" aria-label="Recovery" className="h-auto flex-1 p-2">
            <ScoreRing value={recovery?.score ?? null} label="Recovery" scheme={recoveryScheme} placeholder={progress} />
          </ToggleGroupItem>
          <ToggleGroupItem value="sleep" aria-label="Sleep" className="h-auto flex-1 p-2">
            <ScoreRing value={scores?.sleep.score ?? null} label="Sleep" scheme="sleep" />
          </ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}
