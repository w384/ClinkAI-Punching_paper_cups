import type { Cup, Projectile, ShotSpec } from './types'
import { DEFAULT_PHYSICS } from './physics'
import { HIT_POINT, MUZZLE, project, VIEW, type TowerConfig } from './tower'

/** 弹体档案：质量 × 速度 = 冲量（对应"投射物质量速度可调"） */
export const SHOT_PROFILE: Record<string, { mass: number; speed: number }> = {
  free: { mass: 1.0, speed: 520 },
  hit1: { mass: 1.8, speed: 560 },
  hit2: { mass: 2.6, speed: 620 },
  rainbow: { mass: 26, speed: 900 },
}

/**
 * 固定击发点：打当前转到正前方的"最底层"杯子。
 * 不锁定目标：连续火力能不能凑满 10 次，靠转盘转速保证
 * （见 tower.ts 的 rotationSpeed 计算：一只杯在正前方停留约 1.2s）。
 */
export function pickTarget(cups: Cup[], worldAngle: number): Cup | null {
  let bottom = Number.POSITIVE_INFINITY
  for (const c of cups) {
    if (c.state === 'fallen' || c.state === 'toppled') continue
    if (c.layer < bottom) bottom = c.layer
  }
  if (!Number.isFinite(bottom)) return null

  let best: Cup | null = null
  let bestScore = -Infinity
  for (const cup of cups) {
    if (cup.state === 'fallen' || cup.state === 'toppled') continue
    if (cup.layer !== bottom) continue
    // 退化杯（半径 ≤ 0，比如误配的"外圈没给半径"）会被算成永远在正前方，直接排除
    if (cup.radius <= 0) continue
    const theta = cup.angle + worldAngle
    const depth = Math.cos(theta)
    const dist = Math.abs(Math.sin(theta) * cup.radius)
    const score = depth * 2 - dist * 0.008
    if (score > bestScore) {
      bestScore = score
      best = cup
    }
  }
  return best
}

/**
 * 生成抛物线弹体：给定飞行时间 T，反解初速度，
 * 使其在 T 后落在目标杯的位置上（屏幕空间）。
 */
export function spawnProjectile(
  id: number,
  target: Cup,
  worldAngle: number,
  tower: TowerConfig,
  shot: ShotSpec,
): Projectile {
  const T = 0.17
  const p = project(target, worldAngle, tower)
  const dx = p.x - MUZZLE.x
  const dy = p.y - tower.cupH * 0.55 - MUZZLE.y
  const g = DEFAULT_PHYSICS.projGravity
  return {
    id,
    x: MUZZLE.x,
    y: MUZZLE.y,
    vx: dx / T,
    vy: (dy - 0.5 * g * T * T) / T,
    age: 0,
    targetId: target.id,
    impulse: shot.mass * shot.speed,
    // 礼物 = 加量器：power 决定一次命中叠加几次随机倾角；彩虹清杯对每只杯只叠 1 次
    increments: shot.spread === 'ring' ? 1 : Math.max(1, Math.round(shot.power)),
    spread: shot.spread,
    dead: false,
  }
}

/** 计分板：连击 = 连续产生翻倒的击发；白打一发会断连击 */
export class Scoreboard {
  private combo = 0
  private score = 0
  private maxCombo = 0
  private highlights = 0
  private totalHits = 0
  private totalShots = 0
  private shotSeq = 0
  private current: { id: number; topples: number } | null = null

  get currentCombo(): number {
    return this.combo
  }

  get summary() {
    return {
      totalShots: this.totalShots,
      totalHits: this.totalHits,
      maxCombo: this.maxCombo,
      highlights: this.highlights,
      score: this.score,
    }
  }

  /** 记录一次击发；若上一发一个杯子都没打掉，连击清零 */
  fire(): number {
    if (this.current && this.current.topples === 0) this.combo = 0
    this.totalShots++
    this.shotSeq++
    this.current = { id: this.shotSeq, topples: 0 }
    return this.shotSeq
  }

  /** 记录一只杯子翻倒 */
  topple(): { scoreDelta: number; combo: number; isHighlight: boolean } {
    if (this.current) this.current.topples++
    this.combo++
    this.maxCombo = Math.max(this.maxCombo, this.combo)
    this.totalHits++
    const isHighlight = this.combo >= 5
    if (isHighlight) this.highlights++
    const mult = 1 + Math.min(this.combo - 1, 10) * 0.1
    const scoreDelta = Math.round(10 * mult)
    this.score += scoreDelta
    return { scoreDelta, combo: this.combo, isHighlight }
  }

  reset(): void {
    this.combo = 0
    this.score = 0
    this.maxCombo = 0
    this.highlights = 0
    this.totalHits = 0
    this.totalShots = 0
    this.shotSeq = 0
    this.current = null
  }
}

/** 弹体是否已经碰到目标杯（屏幕空间距离判定） */
export function projectileHit(p: Projectile, target: Cup, worldAngle: number, tower: TowerConfig): boolean {
  const proj = project(target, worldAngle, tower)
  const dx = p.x - proj.x
  const dy = p.y - (proj.y - tower.cupH * 0.55)
  return dx * dx + dy * dy < 18 * 18
}

/** 点到线段的距离 */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2))
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t))
}

/**
 * 扫掠碰撞：用"本帧走过的线段"与目标杯做距离判定。
 * 弹体速度快、帧步长大时（例如 100ms 一步走 100px），点判定会直接穿过目标。
 */
export function projectileHitSwept(
  p: Projectile,
  prevX: number,
  prevY: number,
  target: Cup,
  worldAngle: number,
  tower: TowerConfig,
  radius = 20,
): boolean {
  const proj = project(target, worldAngle, tower)
  const cx = proj.x
  const cy = proj.y - tower.cupH * 0.55
  return distToSegment(cx, cy, prevX, prevY, p.x, p.y) < radius
}

export { VIEW }
