import type { ReactNode } from 'react'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Shared frame for the Strain, Recovery and Sleep detail cards. */
export function BreakdownCard({ title, aside, note, children }: { title: string; aside?: ReactNode; note?: string; children?: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {aside && <CardAction className="text-sm text-muted-foreground">{aside}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-4">
        {note && <p className="text-sm text-muted-foreground">{note}</p>}
        {children}
      </CardContent>
    </Card>
  )
}

/** One labelled line in a breakdown, with an optional bar (children) and an explanation underneath. */
export function BreakdownRow({ label, aside, detail, children }: { label: string; aside?: ReactNode; detail?: string; children?: ReactNode }) {
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        {aside && <span className="text-muted-foreground">{aside}</span>}
      </div>
      {children}
      {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
    </li>
  )
}
