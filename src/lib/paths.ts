/** Every path in the reps-data repo. One flat namespace — this is a single-purpose app. */

export const PATHS = {
  profile: 'profile.json',
  venues: 'venues.json',
  programsDir: 'programs',
  programsIndex: 'programs/index.json',
  program: (id: string) => `programs/${id}.json`,
  sessionsDir: 'sessions',
  sessions: (month: string) => `sessions/${month}.json`,
  bodyMetrics: 'body/metrics.json',
  readiness: 'body/readiness.json',
  customExercises: 'exercises/custom.json',
  records: 'records.json',
  coachMemory: 'coach-memory.json',
  weeklyReviews: 'weekly-reviews.json',
  activityDir: 'activity',
  activity: (month: string) => `activity/${month}.json`,
  settings: 'settings.json',
} as const
