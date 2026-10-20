import type { Cup, Projectile, ShotSpec } from './types'
import { MUZZLE, project, type TowerConfig } from './tower'

/** 弹体档案：质量 × 速度 = 冲量（对应"投射物质量速度可调"） */
export const SHOT_PROFILE: Record<string, { mass: number; speed: number }> = {
  free: { mass: 1.0, speed: 520 },
  hit1: { mass: 1.8, speed: 560 },
  hit2: { mass: 2.6, speed: 620 },
  rainbow: { mass: 26, speed: 900 },
}

/** 小豆飞行速度（px/s）：直线上升，不做抛物线、不瞄准任何杯子 */
export const BEAN_SPEED = 900

/** 命中判定半径（屏幕像素，约半只杯宽） */
export const BEAN_HIT_RADIUS = 15

/**
 * 生成弹体：从固定击发点（底部正前方）**垂直向上**飞出。
 * 不锁定杯子——打中谁由它在屏幕上撞到的第一只杯决定。
 */
export function spawnProjectile(id: number, shot: ShotSpec): Projectile {
  return {
    id,
    x: MUZZLE.x,
    y: MUZZLE.y,
    vx: 0,
    vy: -BEAN_SPEED,
    age: 0,
    impulse: shot.mass * shot.speed,
    // 礼物 = 加量器：power 决定一次命中叠加几次随机倾角
    increments: shot.spread === 'ring' ? 1 : Math.max(1, Math.round(shot.power)),
    spread: shot.spread,
    alpha: 1,
    dead: false,
  }
}

export interface PathHit {
  cup: Cup
  /** 沿本帧线段的命中位置（0 = 起点，1 = 终点） */
  t: number
}

/**
 * 直线弹道命中：本帧走过的线段与**所有存活杯**求交，取最先碰到的那只。
 *
 * 因为小豆从下往上飞，而远处杯子的屏幕位置会被深度偏移抬得更高，
 * 所以"先碰到"天然等于"先打前排、前排空了才继续往上打后排"。
 * 什么都没碰到就返回 null（这一发就是空击）。
 */
export function firstCupOnPath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cups: Cup[],
  worldAngle: number,
  tower: TowerConfig,
  radius = BEAN_HIT_RADIUS,
): PathHit | null {
  const dx = bx - ax
  const dy = by - ay
  const segLen2 = dx * dx + dy * dy
  if (segLen2 < 1e-6) return null

  let best: PathHit | null = null
  let bestT = Number.POSITIVE_INFINITY
  let bestDepth = -Infinity

  for (const cup of cups) {
    if (cup.state === 'fallen' || cup.state === 'toppled') continue
    const proj = project(cup, worldAngle, tower)
    // 以杯身中部（约 55% 高度）为碰撞中心
    const cx = proj.x
    const cy = proj.y - tower.cupH * 0.55

    const fx = ax - cx
    const fy = ay - cy
    const b = 2 * (fx * dx + fy * dy)
    const c = fx * fx + fy * fy - radius * radius
    // 起点已经在杯内：按命中点 t=0 处理
    let t: number
    if (c <= 0) {
      t = 0
    } else {
      const disc = b * b - 4 * segLen2 * c
      if (disc < 0) continue
      t = (-b - Math.sqrt(disc)) / (2 * segLen2)
      if (t < 0 || t > 1) continue
    }

    // 同一位置重叠时，取更靠前（depth 更大）的那只
    if (t < bestT - 1e-6 || (Math.abs(t - bestT) <= 1e-6 && proj.depth > bestDepth)) {
      bestT = t
      bestDepth = proj.depth
      best = { cup, t }
    }
  }
  return best
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
