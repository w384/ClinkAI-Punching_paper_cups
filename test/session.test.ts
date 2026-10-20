import { describe, expect, it } from 'vitest'
import { LocalTriggerSource } from '../src/engine/trigger'
import { PAPER_TOWER, type TowerConfig } from '../src/engine/tower'
import type { ShotOutcome } from '../src/engine/types'
import { Session } from '../src/game/session'

const SMALL: TowerConfig = { ...PAPER_TOWER, rows: 6, ringCount: 10, outerLayers: 2, outerCount: 12 }

function run(s: Session, totalMs: number, stepMs = 16): void {
  for (let t = 0; t < totalMs; t += stepMs) s.advance(stepMs)
}

describe('Session（火力压制 + 多米诺）', () => {
  it('一局：开始 → 弹幕命中后杯子被推动', () => {
    const src = new LocalTriggerSource()
    let last: ShotOutcome | null = null
    const s = new Session({
      tower: SMALL,
      durationMs: 20_000,
      source: src,
      autoTimer: false,
      onShot: (o) => {
        last = o
      },
    })
    s.start()
    src.emitBarrage('观众A')
    expect(last!.contacted).toBe(true)
    run(s, 400)
    const target = s.cups.find((c) => c.id === last!.targetId)!
    expect(target.state === 'leaning' || target.state === 'toppled').toBe(true)
  })

  it('长按连发（80ms 一发）能打翻并触发同列倒塌', () => {
    const src = new LocalTriggerSource()
    const s = new Session({ tower: PAPER_TOWER, durationMs: 60_000, source: src, autoTimer: false })
    s.start()
    for (let i = 0; i < 60; i++) {
      src.emitBarrage('观众')
      run(s, 80)
    }
    run(s, 2500)
    expect(s.summary.totalHits).toBeGreaterThan(0)
  })

  it('100ms 粗步长下弹体不会穿模（扫掠碰撞）', () => {
    const src = new LocalTriggerSource()
    const s = new Session({ tower: SMALL, durationMs: 60_000, source: src, autoTimer: false })
    s.start()
    src.emitBarrage('观众')
    run(s, 400, 100)
    expect(s.cups.some((c) => Math.abs(c.tilt) > 0.001 || c.pendingMs > 0)).toBe(true)
  })

  it('单发弹幕打不翻（只有持续火力累积过临界）', () => {
    const src = new LocalTriggerSource()
    const s = new Session({ tower: SMALL, durationMs: 60_000, source: src, autoTimer: false })
    s.start()
    src.emitBarrage('观众')
    run(s, 1000)
    expect(s.summary.totalHits).toBe(0)
  })

  it('一记爱心单发就能打翻', () => {
    const src = new LocalTriggerSource()
    const s = new Session({ tower: SMALL, durationMs: 60_000, source: src, autoTimer: false })
    s.start()
    src.emitGift('heart')
    run(s, 2000)
    expect(s.summary.totalHits).toBeGreaterThan(0)
  })

  it('火箭彩虹清杯：整圈底层被打掉 → 大面积塌落', () => {
    const src = new LocalTriggerSource()
    const s = new Session({ tower: SMALL, durationMs: 60_000, source: src, autoTimer: false })
    s.start()
    src.emitGift('rocket')
    run(s, 4000)
    expect(s.summary.totalHits).toBeGreaterThan(s.cups.length * 0.3)
  })

  it('转盘持续旋转', () => {
    const s = new Session({ tower: SMALL, durationMs: 5000, autoTimer: false })
    s.start()
    s.advance(1000)
    expect(s.towerAngle).toBeCloseTo(SMALL.rotationSpeed, 5)
  })

  it('idle 阶段忽略事件', () => {
    const src = new LocalTriggerSource()
    const s = new Session({ tower: SMALL, durationMs: 1000, source: src, autoTimer: false })
    src.emitBarrage('观众A')
    expect(s.projectiles.length).toBe(0)
    expect(s.summary.totalShots).toBe(0)
  })

  it('时间到结算', () => {
    const s = new Session({ tower: SMALL, durationMs: 800, autoTimer: false })
    s.start()
    s.advance(800)
    expect(s.phase).toBe('settled')
  })

  it('重开一局重置杯墙与统计', () => {
    const s = new Session({ tower: SMALL, durationMs: 500, autoTimer: false })
    s.start()
    s.onEvent({ type: 'gift', payload: { name: 'rocket' } })
    run(s, 600)
    s.settle()
    s.start()
    expect(s.cups.every((c) => c.state === 'standing')).toBe(true)
    expect(s.summary.score).toBe(0)
    expect(s.projectiles.length).toBe(0)
  })
})
