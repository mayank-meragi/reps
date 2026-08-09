import { lazy, Suspense, useEffect, useState } from 'react'
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { BarChart3, CalendarClock, ClipboardList, Dumbbell, Home as HomeIcon, Settings, Sparkles } from 'lucide-react'
import TodayPage from '@/pages/TodayPage'
import HistoryPage from '@/pages/HistoryPage'
import PlanPage from '@/pages/PlanPage'
import InsightsPage from '@/pages/InsightsPage'
import SettingsPage from '@/pages/SettingsPage'
import Onboarding from '@/components/Onboarding'
import SetupChat from '@/components/SetupChat'
import ActionToast from '@/components/ActionToast'
import Assistant from '@/components/Assistant'
import { isConfigured } from '@/lib/cache'
import { initSync, flush } from '@/lib/sync'
import { useSyncState } from '@/hooks/useSyncState'
import { useProfile } from '@/hooks/useProfile'
import SyncStatus from '@/components/SyncStatus'
import { cn } from '@/lib/utils'

const SessionPage = lazy(() => import('@/pages/SessionPage'))
const WorkoutPage = lazy(() => import('@/pages/WorkoutPage'))

const NAV = [
  { to: '/', label: 'Today', icon: HomeIcon, end: true },
  { to: '/plan', label: 'Plan', icon: ClipboardList },
  { to: '/history', label: 'History', icon: CalendarClock },
  { to: '/insights', label: 'Insights', icon: BarChart3 },
]

function openAssistant() {
  window.dispatchEvent(new Event('reps:open-assistant'))
}

function Shell() {
  const location = useLocation()
  const { profile, isReady } = useProfile()
  const [skipSetup, setSkipSetup] = useState(false)
  const immersive = /^\/session\/[^/]+\/train$/.test(location.pathname)

  if (isReady && !profile && !skipSetup) {
    return (
      <div className="min-h-screen bg-muted/40 text-foreground">
        <SetupChat onSkip={() => setSkipSetup(true)} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {!immersive && <header className="sticky top-0 z-20 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
          <NavLink to="/" className="flex items-center gap-1.5 font-display text-base font-bold tracking-tight text-[var(--ink-900)]">
            <Dumbbell className="size-4 text-[var(--brand)]" />
            Reps
          </NavLink>
          <nav className="hidden gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex h-9 items-center rounded-full px-4 text-sm font-semibold transition-colors',
                    isActive ? 'bg-[var(--ink-900)] text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <SyncStatus />
          <button
            type="button"
            aria-label="Open AI coach"
            onClick={openAssistant}
            className="hidden h-9 items-center gap-2 rounded-full bg-[var(--ink-900)] px-3 text-sm font-semibold text-white shadow-sm transition-transform active:scale-95 md:inline-flex"
          >
            <Sparkles className="size-4 text-[var(--emerald-300)]" /> Coach
          </button>
          <NavLink
            to="/settings"
            aria-label="Settings"
            className={({ isActive }) => cn(
              'flex size-9 shrink-0 items-center justify-center rounded-full transition-colors',
              isActive ? 'bg-[var(--ink-900)] text-white' : 'text-muted-foreground hover:bg-white hover:text-foreground',
            )}
          >
            <Settings className="size-4" />
          </NavLink>
        </div>
      </header>}
      <main className={cn(!immersive && 'mx-auto max-w-5xl px-4 py-3 pb-28 md:py-6 md:pb-10')}>
        <Suspense fallback={<div className={cn('animate-pulse bg-[var(--surface-sunken)] motion-reduce:animate-none', immersive ? 'min-h-dvh' : 'h-80 rounded-2xl')} />}>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/session/:sessionId" element={<SessionPage />} />
            <Route path="/session/:sessionId/train" element={<WorkoutPage />} />
          </Routes>
        </Suspense>
      </main>
      <ActionToast />
      <Assistant />
      {!immersive && <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-8 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:hidden">
        <div className="pointer-events-auto mx-auto grid max-w-xs grid-cols-5 items-center rounded-full bg-card p-1.5 shadow-lg ring-1 ring-foreground/[0.06]">
          {NAV.slice(0, 2).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  'mx-auto flex size-11 items-center justify-center rounded-full transition-colors',
                  isActive ? 'bg-[var(--ink-900)] text-white' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <item.icon className="size-5" aria-hidden />
            </NavLink>
          ))}
          <button
            type="button"
            aria-label="Open AI coach"
            onClick={openAssistant}
            className="mx-auto -mt-6 flex size-14 items-center justify-center rounded-full bg-[var(--ink-900)] text-white shadow-xl ring-4 ring-background transition-transform active:scale-90"
          >
            <Sparkles className="size-5 text-[var(--emerald-300)]" />
          </button>
          {NAV.slice(2).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              className={({ isActive }) =>
                cn(
                  'mx-auto flex size-11 items-center justify-center rounded-full transition-colors',
                  isActive ? 'bg-[var(--ink-900)] text-white' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <item.icon className="size-5" aria-hidden />
            </NavLink>
          ))}
        </div>
      </nav>}
    </div>
  )
}

export default function App() {
  const [configured, setConfigured] = useState(isConfigured)
  const sync = useSyncState()
  const queryClient = useQueryClient()

  useEffect(() => {
    initSync()
  }, [])

  if (!configured || sync.status === 'auth-error') {
    return (
      <div className="min-h-screen bg-muted/40 text-foreground">
        <Onboarding
          expired={sync.status === 'auth-error'}
          onDone={() => {
            setConfigured(true)
            void queryClient.invalidateQueries()
            void flush()
          }}
        />
      </div>
    )
  }

  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
