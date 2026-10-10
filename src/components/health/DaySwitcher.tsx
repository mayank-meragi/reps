import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { addDays, formatDateLabel } from '@/lib/dates'

/** Previous / next day around a date label; tapping the label jumps back to today. */
export default function DaySwitcher({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <Button variant="secondary" size="icon" aria-label="Previous day" onClick={() => onChange(addDays(date, -1))}>
        <ChevronLeft />
      </Button>
      <Button variant="ghost" onClick={() => onChange(today)}>
        {date === today ? 'Today' : formatDateLabel(date)}
      </Button>
      <Button variant="secondary" size="icon" aria-label="Next day" disabled={date >= today} onClick={() => onChange(addDays(date, 1))}>
        <ChevronRight />
      </Button>
    </div>
  )
}
