import type { Cup, Projectile } from './types'

/**
 * 物理参数（离散倾角累积模型）
 *
 * 手感规则：**每次击中从 3 个候选倾角里随机取一个，叠加到杯子上**；
 * 累计击中次数达到 minHitsToTopple，或累计倾角超过 hitTiltThreshold，杯子就倒。
 * 这两个条件都被调成"9 次以内无论怎么叠都到不了阈值"，所以**至少 10 次才可能倒**。
 */
export interface PhysicsConfig {
  /** 3 个候选倾角增量（rad），每次击中随机取一个 */
  hitTiltValues: [number, number, number]
  /** 累计倾角阈值：超过就倒（rad） */
  hitTiltThreshold: number
  /** 计数门：至少击中这么多次才可能倒 */
  minHitsToTopple: number
  /** 视觉倾角上限（rad）：累计再大也只显示到这个角度，避免"没倒却已经躺平" */
  tiltVisualCap: number
  /** 翻倒时传给同层邻居的横向倾角增量（rad）——很弱，只影响视觉，不会自己扩散 */
  chainTiltAdd: number
  /** 翻倒动画时长（ms） */
  fallDurationMs: number
  /** 倒定后停留多久再消失（ms） */
  settleHoldMs: number
  /** 环向完整性阈值（默认关闭 = 1） */
  hoopIntegrity: number
  /** 结构失效后排队倾倒的基础延时（ms）——错峰才有多米诺感 */
  staggerBaseMs: number
  /** 排队延时的随机抖动（ms） */
  staggerJitterMs: number
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  // 0.030 / 0.038 / 0.046；9 次全取最大值 = 0.414 < 阈值 0.42 → 9 次以内必不倒
  hitTiltValues: [0.03, 0.038, 0.046],
  hitTiltThreshold: 0.42,
  minHitsToTopple: 10,
  tiltVisualCap: 0.42,
  chainTiltAdd: 0.02,
  fallDurationMs: 780,
  settleHoldMs: 320,
  hoopIntegrity: 1,
  staggerBaseMs: 110,
  staggerJitterMs: 170,
}

export interface World {
  cups: Cup[]
  byId: Map<number, Cup>
  /** `${group}:${layer}` → 该圈该层（环向完整性判定用） */
  byGroupLayer: Map<string, Cup[]>
  cfg: PhysicsConfig
  /** 随机源（测试里注入确定性实现） */
  rand: () => number
  onTopple?: (cup: Cup) => void
}

export function isAlive(cup: Cup): boolean {
  return cup.state === 'standing' || cup.state === 'leaning'
}

/** 视觉倾角 = 累计倾角（带方向），封顶在 tiltVisualCap */
function syncTilt(cup: Cup, cfg: PhysicsConfig): void {
  cup.tilt = cup.dir * Math.min(cup.tiltSum, cfg.tiltVisualCap)
}

/** 从 3 个候选值里随机取一个 */
export function pickTilt(cfg: PhysicsConfig, rand: () => number): number {
  const i = Math.min(2, Math.max(0, Math.floor(rand() * 3)))
  return cfg.hitTiltValues[i]
}

/**
 * 一次命中：按 increments 次叠加随机倾角。
 * 每叠一次都检查两个判定：计数门（至少 N 次）或 累计超阈值。
 * 返回本次实际叠加的角度。
 */
export function applyHit(cup: Cup, increments: number, world: World, rand: () => number = world.rand): number {
  if (!isAlive(cup)) return 0
  let added = 0
  const times = Math.max(1, Math.floor(increments))
  for (let i = 0; i < times; i++) {
    if (!isAlive(cup)) break
    const v = pickTilt(world.cfg, rand)
    cup.tiltSum += v
    cup.hitCount++
    added += v
    if (cup.state === 'standing') cup.state = 'leaning'
    if (cup.hitCount >= world.cfg.minHitsToTopple || cup.tiltSum >= world.cfg.hitTiltThreshold) {
      topple(cup, world)
      break
    }
  }
  if (isAlive(cup)) syncTilt(cup, world.cfg)
  return added
}

/**
 * 倒向哪边：缺口方向。
 *
 * 同层里沿环向左右扫描，看哪一侧离"第一个已经不在了的杯子"更近——
 * 杯子就往那一侧倒（缺口会像 V 形一样向两边张开），而不是随机左右摆。
 * 两侧一样近（整圈还很完整 / 整圈都塌了）才退回建塔时给的默认方向。
 */
export function gapDir(cup: Cup, world: World): number {
  const ring = world.byGroupLayer.get(`${cup.group}:${cup.layer}`)
  if (!ring || ring.length < 3) return cup.dir || 1
  const n = ring.length
  const present = (c: Cup) => c.state !== 'fallen' && c.state !== 'toppled'

  let right = n
  let left = n
  for (let k = 1; k < n; k++) {
    if (!present(ring[(cup.index + k) % n])) {
      right = k
      break
    }
  }
  for (let k = 1; k < n; k++) {
    if (!present(ring[(cup.index - k + n) % n])) {
      left = k
      break
    }
  }
  if (right === left) return cup.dir || 1
  return right < left ? 1 : -1
}

export function topple(cup: Cup, world: World): void {
  if (cup.state === 'toppled' || cup.state === 'fallen') return
  cup.state = 'toppled'
  cup.fallT = 0
  // 从当前倾角接着倒：否则动画会从 0 重新起算，视觉上"弹回直立再倒一次"
  cup.fallFrom = cup.tilt
  cup.pendingMs = 0
  // 倒向缺口，不随机左右
  cup.dir = gapDir(cup, world)
  cup.tilt = cup.dir * Math.min(cup.tiltSum, world.cfg.tiltVisualCap)
  world.onTopple?.(cup)

  // 横向多米诺（很弱）：只给倾倒方向那一侧的邻居加一点倾角，不会触发翻倒判定
  const sameLayer = cup.neighbors.filter((id) => {
    const n = world.byId.get(id)
    return n && n.layer === cup.layer && n.group === cup.group
  })
  if (sameLayer.length > 0) {
    const target = cup.dir > 0 ? sameLayer[0] : sameLayer[sameLayer.length - 1]
    const n = world.byId.get(target)
    if (n && isAlive(n)) {
      n.tiltSum += world.cfg.chainTiltAdd
      if (n.state === 'standing') n.state = 'leaning'
      syncTilt(n, world.cfg)
    }
  }
}

/** 结构失效：登记一个错峰倾倒（不是立刻倒） */
function scheduleTopple(cup: Cup, world: World, keyPrefix: number): boolean {
  if (!isAlive(cup) || cup.pendingMs > 0) return false
  const jitter = ((cup.id * 37 + keyPrefix * 13) % 1000) / 1000
  cup.pendingMs = world.cfg.staggerBaseMs + jitter * world.cfg.staggerJitterMs
  cup.state = 'leaning'
  return true
}

/**
 * 承重路径检查（结构判定，与"打多少下才倒"无关）：
 * 1) 环向完整性（默认关闭）
 * 2) 每只杯只由"两只支撑杯都活着"才站得住；丢一只 = 悬挑 = 坠
 * 3) 全部走"排队错峰"，视觉上是逐层多米诺
 */
export function relaxStructure(world: World): number {
  let scheduled = 0
  let changed = true
  let pass = 0
  while (changed) {
    changed = false
    pass++

    if (world.cfg.hoopIntegrity < 1) {
      for (const [key, ring] of world.byGroupLayer) {
        const layer = Number(key.split(':')[1])
        if (layer === 0) continue
        const alive = ring.filter(isAlive).length
        if (alive === 0 || alive / ring.length >= world.cfg.hoopIntegrity) continue
        for (const cup of ring) {
          if (scheduleTopple(cup, world, pass)) {
            scheduled++
            changed = true
          }
        }
      }
    }

    for (const cup of world.cups) {
      if (!isAlive(cup) || cup.layer === 0) continue
      const supporting = cup.supporters.every((id) => {
        const s = world.byId.get(id)
        return s ? isAlive(s) : false
      })
      if (!supporting && scheduleTopple(cup, world, pass)) {
        scheduled++
        changed = true
      }
    }
  }
  return scheduled
}

export function stepCup(cup: Cup, dtMs: number, world: World): void {
  if (cup.state === 'fallen') return

  if (cup.state === 'toppled') {
    if (cup.fallT < 1) {
      cup.fallT = Math.min(1, cup.fallT + dtMs / world.cfg.fallDurationMs)
    } else {
      // 倒定后停留一会儿再渐隐消失，别"一碰就没"
      cup.lieMs += dtMs
      if (cup.lieMs >= world.cfg.settleHoldMs) cup.state = 'fallen'
    }
    return
  }

  // 已判倒、正在排队：到点统一翻倒（错峰产生多米诺节奏）
  if (cup.pendingMs > 0) {
    cup.pendingMs -= dtMs
    if (cup.pendingMs <= 0) {
      cup.pendingMs = 0
      topple(cup, world)
    }
    return
  }

  // 站立：倾角完全由累计值决定（不回正、无角速度）
  syncTilt(cup, world.cfg)
}

/** 越过杯塔顶部后继续飞行的淡出距离（px）——很短，出了盘区就彻底没了 */
export const BEAN_FADE_PX = 40

/**
 * 直线弹体：匀速向上飞。
 * 空击时它会穿过杯墙中间的洞继续上升，但**越出杯塔/圆盘范围就结束**：
 * 从 `fadeTopY`（杯塔顶部）再往上走 BEAN_FADE_PX 就完全消失，不会一路飞到画面顶端。
 */
export function stepProjectile(p: Projectile, dtMs: number, fadeTopY = Number.NEGATIVE_INFINITY): void {
  const dt = dtMs / 1000
  p.age += dtMs
  p.x += p.vx * dt
  p.y += p.vy * dt

  if (fadeTopY > 0 && p.y < fadeTopY) {
    p.alpha = Math.max(0, (p.y - (fadeTopY - BEAN_FADE_PX)) / BEAN_FADE_PX)
    if (p.alpha <= 0) {
      p.dead = true
      p.alpha = 0
      return
    }
  }
  if (p.y < -80 || p.age > 4000) p.dead = true
}

/** 倒地后的渐隐时长（ms） */
const SETTLE_FADE_MS = 320

/** 翻倒动画的视觉倾角：从被打歪的角度接着倒到 ±90°，smoothstep 缓动 */
export function toppledTilt(cup: Cup): number {
  const t = cup.fallT
  const ease = t * t * (3 - 2 * t)
  const target = cup.dir * (Math.PI / 2)
  return cup.fallFrom + (target - cup.fallFrom) * ease
}

export function cupAlpha(cup: Cup): number {
  if (cup.state === 'fallen') return 0
  if (cup.state === 'toppled' && cup.lieMs > 0) {
    return Math.max(0, 1 - cup.lieMs / SETTLE_FADE_MS)
  }
  return 1
}
