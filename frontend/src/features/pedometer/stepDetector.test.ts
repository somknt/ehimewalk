import { describe, expect, it } from 'vitest'
import { StepDetector } from './stepDetector'

const GRAVITY = 9.8
const RATE_HZ = 50

/** 歩行を模した加速度（縦方向に stepsPerSecond 回揺れる）を流し、数えた歩数を返す */
function simulate(detector: StepDetector, seconds: number, stepsPerSecond: number, amplitude: number, startMs = 0) {
  let counted = 0
  for (let i = 0; i < seconds * RATE_HZ; i++) {
    const t = startMs + (i * 1000) / RATE_HZ
    const vertical = GRAVITY + amplitude * Math.sin((2 * Math.PI * stepsPerSecond * t) / 1000)
    counted += detector.push(0.3, vertical, 0.5, t)
  }
  return counted
}

describe('歩数の検出', () => {
  it('1秒に2歩のペースで10秒歩くと、約20歩と数える', () => {
    const steps = simulate(new StepDetector(), 10, 2, 3)
    expect(steps).toBeGreaterThanOrEqual(18)
    expect(steps).toBeLessThanOrEqual(21)
  })

  it('ゆっくり歩き（1秒に1.4歩）も数える', () => {
    const steps = simulate(new StepDetector(), 10, 1.4, 2.5)
    expect(steps).toBeGreaterThanOrEqual(12)
    expect(steps).toBeLessThanOrEqual(15)
  })

  it('置いたままの小さな揺れは数えない', () => {
    expect(simulate(new StepDetector(), 10, 2, 0.5)).toBe(0)
  })

  it('1〜2回だけの揺れ（持ち上げただけ）は数えない', () => {
    const detector = new StepDetector()
    expect(simulate(detector, 1, 2, 3)).toBe(0)
    // 3 秒止まってから再び揺れても、続けて 4 歩になるまでは数えない
    for (let i = 0; i < 3 * RATE_HZ; i++) detector.push(0.3, GRAVITY, 0.5, 1000 + (i * 1000) / RATE_HZ)
    expect(simulate(detector, 1, 2, 3, 4000)).toBe(0)
  })

  it('1秒に4歩より速い揺れは、その速さのぶんだけ数えない', () => {
    // 1 秒に 8 回の揺れでも、0.25 秒より短い間隔は数えないため、多くても 1 秒に 4 歩
    expect(simulate(new StepDetector(), 5, 8, 4)).toBeLessThanOrEqual(21)
  })

  it('不正な値は無視する', () => {
    const detector = new StepDetector()
    expect(detector.push(Number.NaN, 1, 1, 0)).toBe(0)
    expect(detector.push(1, 1, 1, Number.NaN)).toBe(0)
  })
})
