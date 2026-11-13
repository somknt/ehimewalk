import { useSyncExternalStore } from 'react'
import { pedometer, type PedometerState } from './pedometer'

export function usePedometer(): PedometerState {
  return useSyncExternalStore(pedometer.subscribe, pedometer.getSnapshot)
}
