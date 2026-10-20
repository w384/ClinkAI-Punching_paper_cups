import { describe, expect, it } from 'vitest'
import {
  applyImpulse,
  DEFAULT_PHYSICS,
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

const SMALL: TowerConfig = { ...PAPER_TOWER, rows: 5, ringCount: 8, outerLayers: 2, outerCount: 10 }

function worldOf(built: BuiltTower, onTopple?: (c: Cup) => void): World {
  return {
    cups: built.cups,
    byId: new Map(built.cups.map((c) => [c.id, c])),
    byGroupLayer: built.byGroupLayer,
    cfg: CFG,
    onTopple,
  }
}

function stepAll(built: BuiltTower, w: World, frames: number, stepMs = 16): void {
  for (let i = 0; i < frames; i++) for (const c of built.cups) stepCup(c, stepMs, w)
}

describe('结构（砖缝错位、两圈）', () => {
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

describe('physics（倾倒与多米诺）', () => {
  it('小冲量只让杯子歪一下，不倾倒', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 4)!
    applyImpulse(cup, 90, 1, CFG)
    stepAll(built, w, 40)
    expect(cup.state).not.toBe('toppled')
    expect(Math.abs(cup.tilt)).toBeLessThan(CFG.toppleAngle)
  })

  it('冲量累积过临界 → 翻倒（单发打不倒）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 4)!
    let hits = 0
    while (cup.state !== 'toppled' && hits < 30) {
      applyImpulse(cup, 240, 1, CFG)
      stepAll(built, w, 4)
      hits++
    }
    expect(cup.state).toBe('toppled')
    expect(hits).toBeGreaterThan(1)
  })

  it('只剩一只支撑 = 悬挑 → 撑不住（倒三角判据）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    // 故意只打掉它的一个支撑杯
    const sup = built.cups.find((c) => c.id === cup.supporters[0])!
    sup.state = 'fallen'
    relaxStructure(w)
    expect(cup.pendingMs).toBeGreaterThan(0)
  })

  it('单只缺口只塌上方那一列，不向两侧扩散', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const ring0 = built.byGroupLayer.get(`${GROUP_INNER}:0`)!
    topple(ring0[0], w)
    relaxStructure(w)
    const affected = built.cups.filter((c) => c.pendingMs > 0 || c.state === 'toppled' || c.state === 'fallen')
    // 只涉及正上方那一列，不会横扫整层
    expect(affected.length).toBeLessThan(SMALL.ringCount)
  })

  it('相邻两只被打掉 → 上方那只失去全部支撑 → 排队倒塌（错峰，不是同一帧）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const ring0 = built.byGroupLayer.get(`${GROUP_INNER}:0`)!
    const a = ring0[0]
    const b = ring0[1]
    const above = built.cups.find(
      (c) => c.group === GROUP_INNER && c.layer === 1 && c.supporters.includes(a.id) && c.supporters.includes(b.id),
    )
    expect(above).toBeDefined()
    topple(a, w)
    topple(b, w)
    relaxStructure(w)
    expect(above!.state).not.toBe('toppled') // 先排队，不是立刻倒
    expect(above!.pendingMs).toBeGreaterThan(0)
    stepAll(built, w, 40)
    expect(['toppled', 'fallen']).toContain(above!.state)
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

  it('局部缺口不会把剩下的半圈一起清掉（环向完整性默认关闭）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const ring = built.byGroupLayer.get(`${GROUP_INNER}:2`)!
    // 打掉 60% 的杯：剩下 40% 仍然立在下面那一层上，不该被整层带走
    for (const c of ring.slice(0, Math.ceil(ring.length * 0.6))) topple(c, w)
    relaxStructure(w)
    const stillAlive = ring.filter((c) => c.state === 'standing' || c.state === 'leaning')
    expect(stillAlive.length).toBeGreaterThan(0)
    expect(stillAlive.every((c) => c.pendingMs === 0)).toBe(true)
  })

  it('翻倒动画从当前倾角接着倒，不会弹回直立再跌一次', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const cup = built.cups.find((c) => c.group === GROUP_INNER && c.layer === 2 && c.index === 0)!
    cup.tilt = 0.3
    cup.state = 'leaning'
    topple(cup, w)
    // 第一帧就应该是 0.3，不是 0
    expect(toppledTilt(cup)).toBeCloseTo(0.3, 6)
    let prev = toppledTilt(cup)
    for (let i = 0; i < 80; i++) {
      stepCup(cup, 16, w)
      const now = toppledTilt(cup)
      expect(now).toBeGreaterThanOrEqual(prev - 1e-9) // 单调
      expect(Math.abs(now - prev)).toBeLessThan(0.4) // 无跳变
      prev = now
    }
    expect(prev).toBeCloseTo(Math.PI / 2, 2)
  })

  it('只有支撑全没了才会塌，塌的范围不超过"上方楔形"', () => {
    const tower: TowerConfig = { ...SMALL, rows: 6, ringCount: 20 }
    const built = buildTower(tower)
    const w = worldOf(built)
    const ring0 = built.byGroupLayer.get(`${GROUP_INNER}:0`)!
    const hole = 3
    for (const c of ring0.slice(0, hole)) topple(c, w)
    for (let i = 0; i < 300; i++) {
      stepAll(built, w, 1)
      relaxStructure(w)
    }
    const down = (layer: number) =>
      built.byGroupLayer.get(`${GROUP_INNER}:${layer}`)!.filter((c) => c.state !== 'standing')
    const counts = Array.from({ length: tower.rows }, (_, l) => down(l).length)
    // 缺口只在缺口正上方扩散，任何一层都不会被整圈清空
    for (let l = 0; l < counts.length; l++) expect(counts[l]).toBeLessThan(tower.ringCount)
    // 越往上缺口越小（楔形收窄），不是越塌越宽
    expect(counts[tower.rows - 1]).toBeLessThan(tower.ringCount / 2)
  })

  it('每层失效都会向上传播（多米诺逐层）', () => {
    const built = buildTower(SMALL)
    const w = worldOf(built)
    const ring = built.byGroupLayer.get(`${GROUP_INNER}:1`)!
    for (const c of ring) topple(c, w)
    for (let i = 0; i < 200; i++) {
      stepAll(built, w, 1)
      relaxStructure(w)
    }
    const above = built.cups.filter((c) => c.group === GROUP_INNER && c.layer > 1)
    const down = above.filter((c) => c.state === 'toppled' || c.state === 'fallen').length
    expect(down).toBeGreaterThan(above.length * 0.5)
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
      spread: 'point',
      dead: false,
    }
    stepProjectile(p, 16, CFG)
    expect(p.vy).toBeGreaterThan(-420)
    for (let i = 0; i < 200 && !p.dead; i++) stepProjectile(p, 16, CFG)
    expect(p.dead).toBe(true)
  })

  it('搭建误差过大 → 开局自坍塌（"是我大意了"）', () => {
    const tower: TowerConfig = { ...SMALL, buildError: 0.5 }
    let n = 0
    const built = buildTower(tower, { rand: () => (n++ % 2 === 0 ? 1 : 0) })
    const w = worldOf(built)
    stepAll(built, w, 120)
    expect(built.cups.some((c) => c.state === 'toppled' || c.state === 'fallen')).toBe(true)
  })
})
