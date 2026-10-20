import { describe, expect, it } from 'vitest'
import { pickTarget, projectileHit, Scoreboard, SHOT_PROFILE, spawnProjectile } from '../src/engine/rule'
import { buildTower, GROUP_INNER, HIT_POINT, MUZZLE, PAPER_TOWER, project } from '../src/engine/tower'
import type { Cup, ShotSpec } from '../src/engine/types'

function barrageShot(): ShotSpec {
  const p = SHOT_PROFILE.free
  return { kind: 'free', effect: 'free', power: 1, label: '弹幕', mass: p.mass, speed: p.speed, spread: 'point' }
}

describe('rule（击发与计分）', () => {
  it('固定击发点只打最底层、当前转到正前方的杯子', () => {
    const cups = buildTower(PAPER_TOWER).cups
    const target = pickTarget(cups, 0)!
    const minLayer = Math.min(...cups.map((c) => c.layer))
    expect(target.layer).toBe(minLayer)
    const dist = Math.abs(Math.sin(target.angle) * target.radius)
    const minDist = Math.min(
      ...cups.filter((c) => c.layer === minLayer).map((c) => Math.abs(Math.sin(c.angle) * c.radius)),
    )
    expect(dist).toBeLessThanOrEqual(minDist + 1)
  })

  it('弹体走抛物线，约 170ms 后命中目标杯', () => {
    const cups = buildTower(PAPER_TOWER).cups
    const target = pickTarget(cups, 0)!
    const p = spawnProjectile(1, target, 0, PAPER_TOWER, barrageShot())
    expect(p.x).toBe(MUZZLE.x)
    expect(p.vy).toBeLessThan(0)
    const g = 2200
    let hitAt = -1
    for (let ms = 0; ms < 600; ms += 4) {
      p.vy += g * 0.004
      p.x += p.vx * 0.004
      p.y += p.vy * 0.004
      p.age += 4
      if (projectileHit(p, target, 0, PAPER_TOWER)) {
        hitAt = ms
        break
      }
    }
    expect(hitAt).toBeGreaterThan(80)
    expect(hitAt).toBeLessThan(400)
  })

  it('炮灰档案：礼物冲量 > 弹幕，火箭最大', () => {
    expect(SHOT_PROFILE.hit1.mass * SHOT_PROFILE.hit1.speed).toBeGreaterThan(
      SHOT_PROFILE.free.mass * SHOT_PROFILE.free.speed,
    )
    expect(SHOT_PROFILE.rainbow.mass * SHOT_PROFILE.rainbow.speed).toBeGreaterThan(
      SHOT_PROFILE.hit2.mass * SHOT_PROFILE.hit2.speed,
    )
  })

  it('计分板：连续翻倒累加连击，得分随连击倍率上升', () => {
    const sb = new Scoreboard()
    sb.fire()
    const a = sb.topple()
    const b = sb.topple()
    expect(a.combo).toBe(1)
    expect(b.combo).toBe(2)
    expect(b.scoreDelta).toBeGreaterThan(a.scoreDelta)
  })

  it('白打一发会在下一发断连击', () => {
    const sb = new Scoreboard()
    sb.fire()
    sb.topple()
    sb.fire()
    sb.fire()
    expect(sb.currentCombo).toBe(0)
  })

  it('连击 5 触发高光时刻', () => {
    const sb = new Scoreboard()
    sb.fire()
    let last = sb.topple()
    for (let i = 0; i < 5; i++) last = sb.topple()
    expect(last.isHighlight).toBe(true)
  })

  it('炮口在画面下方、瞄准点是底部正前方', () => {
    const cups = buildTower(PAPER_TOWER).cups
    const target = pickTarget(cups, 0)!
    const p = project(target, 0, PAPER_TOWER)
    expect(Math.abs(p.x - HIT_POINT.x)).toBeLessThan(8)
    expect(MUZZLE.y).toBeGreaterThan(HIT_POINT.y)
    expect(MUZZLE.x).toBe(HIT_POINT.x)
  })

  it('塔规模：内圈 12 层 × 27 只，没有外圈', () => {
    const built = buildTower(PAPER_TOWER)
    expect(built.cups.length).toBe(PAPER_TOWER.rows * PAPER_TOWER.ringCount)
    expect(built.cups.every((c: Cup) => c.group === GROUP_INNER)).toBe(true)
    expect(new Set(built.cups.map((c) => c.layer)).size).toBe(PAPER_TOWER.rows)
  })
})
