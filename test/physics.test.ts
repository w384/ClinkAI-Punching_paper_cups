import { describe, expect, it } from 'vitest'
import {
  applyHit,
  DEFAULT_PHYSICS,
  pickTilt,
  relaxStructure,
  stepCup,
  stepProjectile,
  topple,
  toppledTilt,
  type World,
} from '../src/engine/physics'
import { buildTower, GROUP_INNER, PAPER_TOWER, type BuiltTower, type TowerConfig } from '../src/engine/tower'
import type { Cup, Projectile } from '../src/engine/types'

const CFG = DEFAULT_PHYSICS
/** 小场地：环向密度放大，避免"缺口绕环一周"的假象 */
const SMALL: TowerConfig = { ...PAPER_TOWER, rows: 5, ringCount: 8 }

function worldOf(built: BuiltTower, rand: () => number = () => 0.99, onTopple?: (c: Cup) => void): World {
  return {
    cups: built.cups,
    byId: new Map(built.cups.map((c) => [c.id, c])),
    byGroupLayer: built.byGroupLayer,
    cfg: CFG,
    rand,
    onTopple,
  }
}

function stepAll(built: BuiltTower, w: World, frames: number, stepMs = 16): void {
  for (let i = 0; i < frames; i++) for (const c of built.cups) stepCup(c, stepMs, w)
}

describe('结构（砖缝错位）', () => {
  it('砖缝错位：每只杯压在下面两只杯的杯缝上', () => {
    const built = buildTower(PAPER_TOWER)
    for (const cup of built.cups.filter((c) => c.layer > 0)) {
      expect(cup.supporters).toHaveLength(2)
      for (const sid of cup.supporters) {
        const sup = built.cups.find((c) => c.id === sid)!
        expect(sup.layer).toBe(cup.layer - 1)
        expect(sup.group).toBe(cup.group)
      }
    }
  })

  it('相邻层整体错半格（不是竖直对齐的格子）', () => {
    const built = buildTower(PAPER_TOWER)
    const l0 = built.byGroupLayer.get(`${GROUP_INNER}:0`)!
    const l1 = built.byGroupLayer.get(`${GROUP_INNER}:1`)!
    const shift = ((l1[0].angle - l0[0].angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
    expect(shift).toBeCloseTo(Math.PI / l0.length, 6)
  })

  it('只有内圈一座塔（外圈已取消）', () => {
    const built = buildTower(PAPER_TOWER)
    expect(built.cups.every((c) => c.group === GROUP_INNER)).toBe(true)
    expect(new Set(built.cups.map((c) => c.layer)).size).toBe(PAPER_TOWER.rows)
    expect(built.cups.every((c) => c.radius === PAPER_TOWER.radius)).toBe(true)
  })
})

describe('击倒规则（随机倾角叠加）', () => {
  it('每次命中从 3 个候选值里随机取一个', () => {
    expect(pickTilt(CFG, () => 0)).toBe(CFG.hitTiltValues[0])
    expect(pickTilt(CFG, () => 0.5)).toBe(CFG.hitTiltValues[1])
    expect(pickTilt(CFG, () => 0.99)).toBe(CFG.hitTiltValues[2])
  })

  it('单次命中只累积倾角，不会倒', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    applyHit(cup, 1, w, () => 0.99)
    expect(cup.state).toBe('leaning')
    expect(cup.hitCount).toBe(1)
    expect(cup.tiltSum).toBeCloseTo(CFG.hitTiltValues[2], 9)
    expect(Math.abs(cup.tilt)).toBeCloseTo(CFG.hitTiltValues[2], 9)
  })

  it('9 次命中（即使每次都是最大值）也绝不倒 —— 至少 10 次', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    for (let i = 0; i < 9; i++) applyHit(cup, 1, w, () => 0.99)
    expect(cup.hitCount).toBe(9)
    expect(cup.tiltSum).toBeLessThan(CFG.hitTiltThreshold)
    expect(cup.state).toBe('leaning')
  })

  it('第 10 次命中必倒（计数门）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    for (let i = 0; i < 9; i++) applyHit(cup, 1, w, () => 0.99)
    applyHit(cup, 1, w, () => 0.99)
    expect(cup.state).toBe('toppled')
  })

  it('累计倾角超过阈值也会倒（与 10 次计数门是"或"关系）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    cup.tiltSum = CFG.hitTiltThreshold - CFG.hitTiltValues[0] / 2
    applyHit(cup, 1, w, () => 0.99)
    expect(cup.hitCount).toBe(1)
    expect(cup.state).toBe('toppled')
  })

  it('倾角叠加后视觉角度单调增大，且封顶不躺平', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    let prev = 0
    for (let i = 0; i < 9; i++) {
      applyHit(cup, 1, w, () => 0.5)
      const now = Math.abs(cup.tilt)
      expect(now).toBeGreaterThanOrEqual(prev)
      expect(now).toBeLessThanOrEqual(CFG.tiltVisualCap + 1e-9)
      prev = now
    }
  })

  it('礼物加量：increments = 2 时一次命中叠两次', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    applyHit(cup, 2, w, () => 0.5)
    expect(cup.hitCount).toBe(2)
    expect(cup.tiltSum).toBeCloseTo(CFG.hitTiltValues[1] * 2, 9)
  })

  it('翻倒动画从当前倾角接着倒，不会弹回直立再跌一次', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    cup.dir = 1
    cup.tilt = 0.3
    cup.tiltSum = 0.3
    topple(cup, w)
    expect(toppledTilt(cup)).toBeCloseTo(0.3, 6)
    let prev = toppledTilt(cup)
    for (let i = 0; i < 80; i++) {
      stepCup(cup, 16, w)
      const now = toppledTilt(cup)
      expect(now).toBeGreaterThanOrEqual(prev - 1e-9)
      expect(Math.abs(now - prev)).toBeLessThan(0.4)
      prev = now
    }
    expect(prev).toBeCloseTo(Math.PI / 2, 2)
  })
})

describe('结构塌落（与击倒规则解耦）', () => {
  it('局部缺口不会把剩下的半圈一起清掉', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const ring = built.byGroupLayer.get(`${GROUP_INNER}:2`)!
    for (const c of ring.slice(0, Math.ceil(ring.length * 0.6))) topple(c, w)
    relaxStructure(w)
    const stillAlive = ring.filter((c) => c.state === 'standing' || c.state === 'leaning')
    expect(stillAlive.length).toBeGreaterThan(0)
    expect(stillAlive.every((c) => c.pendingMs === 0)).toBe(true)
  })

  it('只有支撑全没了才会塌，塌的范围不超过"上方楔形"', () => {
    const tower: TowerConfig = { ...SMALL, rows: 6, ringCount: 20 }
    const built = buildTower(tower)
    const w = worldOf(built)
    const ring0 = built.byGroupLayer.get(`${GROUP_INNER}:0`)!
    for (const c of ring0.slice(0, 3)) topple(c, w)
    for (let i = 0; i < 300; i++) {
      stepAll(built, w, 1)
      relaxStructure(w)
    }
    const down = (layer: number) =>
      built.byGroupLayer.get(`${GROUP_INNER}:${layer}`)!.filter((c) => c.state !== 'standing')
    const counts = Array.from({ length: tower.rows }, (_, l) => down(l).length)
    for (let l = 0; l < counts.length; l++) expect(counts[l]).toBeLessThan(tower.ringCount)
    expect(counts[tower.rows - 1]).toBeLessThan(tower.ringCount / 2)
  })

  it('只剩一只支撑 = 悬挑 → 撑不住（倒三角判据）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    const sup = built.cups.find((c) => c.id === cup.supporters[0])!
    sup.state = 'fallen'
    relaxStructure(w)
    expect(cup.pendingMs).toBeGreaterThan(0)
  })

  it('排队延时错峰：不同杯子的 pendingMs 不同', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const ring = built.byGroupLayer.get(`${GROUP_INNER}:0`)!
    for (const c of ring.slice(0, 3)) topple(c, w)
    relaxStructure(w)
    const pendings = built.cups.filter((c) => c.pendingMs > 0).map((c) => c.pendingMs)
    expect(pendings.length).toBeGreaterThan(0)
    expect(new Set(pendings).size).toBeGreaterThan(1)
  })

  it('弹体抛物线：有重力、最终销毁', () => {
    const p: Projectile = {
      id: 0,
      x: 640,
      y: 640,
      vx: 100,
      vy: -420,
      age: 0,
      targetId: 0,
      impulse: 500,
      increments: 1,
      spread: 'point',
      dead: false,
    }
    stepProjectile(p, 16, CFG)
    expect(p.vy).toBeGreaterThan(-420)
    for (let i = 0; i < 200 && !p.dead; i++) stepProjectile(p, 16, CFG)
    expect(p.dead).toBe(true)
  })
})
