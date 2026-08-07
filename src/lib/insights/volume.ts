import { volumeByMuscle, sessionsInWindow, landmarks, type VolumeLandmarks } from '@/lib/engine'
import type { Exercise, Experience, Session } from '@/lib/types'

export interface MuscleVolumeStatus {
  muscle: string
  sets: number
  landmarks: VolumeLandmarks
}

/** This week's hard sets per muscle against MEV/MAV/MRV for the profile's experience level. */
export function weeklyVolumeVsLandmarks(
  sessions: Session[],
  today: string,
  byId: Map<string, Exercise>,
  experience: Experience,
): MuscleVolumeStatus[] {
  const thisWeek = sessionsInWindow(sessions, today, 7)
  const volumes = volumeByMuscle(thisWeek, byId)
  const bands = landmarks(experience)
  return volumes.map((v) => ({ muscle: v.muscle, sets: v.sets, landmarks: bands }))
}
