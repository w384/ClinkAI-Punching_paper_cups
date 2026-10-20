import { describe, expect, it } from 'vitest'
import { BEAN_SPEED, firstCupOnPath, Scoreboard, SHOT_PROFILE, spawnProjectile } from '../src/engine/rule'
import { stepProjectile } from '../src/engine/physics'
import { buildTower, GROUP_INNER, HIT_POINT, MUZZLE, PAPER_TOWER, project, VIEW } from '../src/engine/tower'
import type { Cup, ShotSpec } from '../src/engine/types'

function barrageShot(): ShotSpec {
  const p = SHOT_PROFILE.free
  return { kind: 'free', effect: 'free', power: 1, label: '弹幕', mass: p.mass, speed: p.speed, spread: 'point' }
}

/** 只留一层底圈，方便验证"前排空了打后排" */
const ONE_LAYER = { ...PAPER_TOWER, rows: 1 }

describe('rule（直线小豆与计分）', () => {
  it('小豆是直线：无横向速度、无重力，匀速上升', () => {
    const p = spawnProjectile(1, barrageShot())
    expect(p.x).toBe(MUZZLE.x)
    expect(p.y).toBe(MUZZLE.y)
    expect(p.vx).toBe(0)
    expect(p.vy).toBe(-BEAN_SPEED)
    const vy0 = p.vy
    stepProjectile(p, 16)
    stepProjectile(p, 16)
    expect(p.vy).toBe(vy0) // 直线：速度不变（没有重力加速度）
    expect(p.x).toBe(MUZZLE.x)
    expect(p.y).toBeLessThan(MUZZLE.y)
  })

  it('直线命中前排：先碰到最靠前（depth 最大）的那只杯', () => {
    const cups = buildTower(PAPER_TOWER).cups
    // 从击发点向上扫过底圈高度
    const hit = firstCupOnPath(MUZZLE.x, MUZZLE.y, MUZZLE.x, HIT_POINT.y - 60, cups, 0, PAPER_TOWER)
    expect(hit).not.toBeNull()
    expect(hit!.cup.layer).toBe(0)
    const p = project(hit!.cup, 0, PAPER_TOWER)
    expect(Math.abs(p.x - HIT_POINT.x)).toBeLessThan(20)
    expect(p.depth).toBeGreaterThan(0) // 前排
  })

  it('前排没有杯子时继续往后走，打到后排', () => {
    const built = buildTower(ONE_LAYER)
    const cups = built.cups
    // 把正前方那一列（|x - 击发点| 很小）的杯子全部拿掉
    for (const c of cups) {
      const p = project(c, 0, ONE_LAYER)
      if (Math.abs(p.x - MUZZLE.x) < 20 && p.depth > 0) c.state = 'fallen'
    }
    const hit = firstCupOnPath(MUZZLE.x, MUZZLE.y, MUZZLE.x, HIT_POINT.y - 90, cups, 0, ONE_LAYER, 20)
    expect(hit).not.toBeNull()
    const p = project(hit!.cup, 0, ONE_LAYER)
    expect(p.depth).toBeLessThan(0) // 打到后排了
  })

  it('前后都没有杯子 → 空击（返回 null）', () => {
    const built = buildTower(ONE_LAYER)
    for (const c of built.cups) c.state = 'fallen'
    const hit = firstCupOnPath(MUZZLE.x, MUZZLE.y, MUZZLE.x, HIT_POINT.y - 90, built.cups, 0, ONE_LAYER, 20)
    expect(hit).toBeNull()
  })

  it('弹体飞出画面即销毁（空击不残留）', () => {
    const p = spawnProjectile(1, barrageShot())
    for (let i = 0; i < 200 && !p.dead; i++) stepProjectile(p, 16)
    expect(p.dead).toBe(true)
    expect(p.y).toBeLessThan(0)
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

  it('炮口在画面下方、击发点固定在底部正前方', () => {
    expect(MUZZLE.x).toBe(HIT_POINT.x)
    expect(MUZZLE.y).toBeGreaterThan(HIT_POINT.y)
    expect(VIEW.cx).toBe(HIT_POINT.x)
  })

  it('塔规模：内圈 12 层 × 27 只，没有外圈', () => {
    const built = buildTower(PAPER_TOWER)
    expect(built.cups.length).toBe(PAPER_TOWER.rows * PAPER_TOWER.ringCount)
    expect(built.cups.every((c: Cup) => c.group === GROUP_INNER)).toBe(true)
    expect(new Set(built.cups.map((c) => c.layer)).size).toBe(PAPER_TOWER.rows)
  })
})
