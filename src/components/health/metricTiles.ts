import { Activity, BedDouble, Droplet, HeartPulse, Thermometer, Wind, type LucideIcon } from 'lucide-react'
import type { MonitorMetricId } from '@/lib/selectors/healthMonitor'

/** Order and look of the Health Monitor tiles. The numbers behind them come from health.get_monitor. */
export const METRIC_TILES: { id: MonitorMetricId; short: string; icon: LucideIcon }[] = [
  { id: 'rr', short: 'RR', icon: Wind },
  { id: 'rhr', short: 'RHR', icon: HeartPulse },
  { id: 'hrv', short: 'HRV', icon: Activity },
  { id: 'spo2', short: 'SpO2', icon: Droplet },
  { id: 'temp', short: 'Temp', icon: Thermometer },
  { id: 'sleep', short: 'Sleep', icon: BedDouble },
]
