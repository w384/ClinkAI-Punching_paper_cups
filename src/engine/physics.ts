import type { Cup, Projectile } from './types'

/**
 * 物理参数（对应"可调参数"清单：质量、倾覆角阈值、初始对齐误差、
 * 投射物质量速度、连锁传递、环向完整性）。
 */
export interface PhysicsConfig {
  /** 静摩擦临界角：倾角小于它时靠摩擦撑住 */
  frictionAngle: number
  /** 越过临界角后重力主导的倾覆加速度（rad/s²） */
  toppleAccel: number
  /** 静摩擦区角速度衰减 */
  damping: number
  /** 倾覆角阈值（rad）：倾角超过它就从"歪斜"转为"翻倒" */
  toppleAngle: number
  /** 静摩擦区倾角回正速率（1/s）：慢速单发打歪后会自动回正，只有连续火力才累积 */
  tiltRelax: number
  /** 冲量 → 角速度的换算系数 */
  impulseScale: number
  /** 翻倒动画时长（ms）：倒下过程，越长越"慢动作" */
  fallDurationMs: number
  /** 倒定后停留多久再消失（ms）：给眼睛一点确认时间 */
  settleHoldMs: number
  /** 投射物重力（px/s²，屏幕向下为正） */
  projGravity: number
  /** 单只翻倒杯横向传给同层邻居的角速度（必须小于摩擦临界，不会自己扩散） */
  chainSpin: number
  /**
   * 环向完整性阈值（默认关闭 = 1）。
   * 曾经设 0.5 时，一层掉过半就直接把剩下半圈全推倒，但那不符合现实：
   * 剩下的杯弧照样能立在台面上。现在统一走"每只杯只看自己的支撑"，
   * 只有真要判整层时（比如整个环都失去支撑）才会一层层掉。
   */
  hoopIntegrity: number
  /** 结构失效后排队倾倒的基础延时（ms）——错峰才有多米诺感 */
  staggerBaseMs: number
  /** 排队延时的随机抖动（ms） */
  staggerJitterMs: number
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  frictionAngle: 0.085,
  toppleAccel: 7.5,
  damping: 3.2,
  toppleAngle: 0.34,
  tiltRelax: 1.0,
  impulseScale: 0.00031,
  fallDurationMs: 780,
  settleHoldMs: 320,
  projGravity: 2200,
  chainSpin: 0.12,
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
  onTopple?: (cup: Cup) => void
}

function isAlive(cup: Cup): boolean {
  return cup.state === 'standing' || cup.state === 'leaning'
}

/** 冲量 → 角速度（质量越大越难推动） */
export function applyImpulse(cup: Cup, impulse: number, dir: number, cfg: PhysicsConfig): void {
  if (!isAlive(cup)) return
  cup.omega += (impulse * cfg.impulseScale * dir) / Math.max(0.5, cup.mass)
  if (cup.state === 'standing') cup.state = 'leaning'
}

/** 角冲量：直接叠加角速度（连锁传递用） */
export function addSpin(cup: Cup, omega: number): void {
  if (!isAlive(cup)) return
  cup.omega += omega
  if (cup.state === 'standing' && Math.abs(omega) > 0.05) cup.state = 'leaning'
}

export function topple(cup: Cup, world: World): void {
  if (cup.state === 'toppled' || cup.state === 'fallen') return
  cup.state = 'toppled'
  cup.fallT = 0
  // 从当前倾角接着倒：否则动画会从 0 重新起算，视觉上"弹回直立再倒一次"
  cup.fallFrom = cup.tilt
  cup.pendingMs = 0
  cup.dir = cup.tilt >= 0 ? 1 : -1
  world.onTopple?.(cup)

  // 横向多米诺（弱）：只推倒向方向的那一只同层邻居；正上方那只是靠"失去支撑"掉，
  // 不在这里硬推，否则会破坏"余料仍能承重"的判定顺序。
  const sameLayer = cup.neighbors.filter((id) => {
    const n = world.byId.get(id)
    return n && n.layer === cup.layer && n.group === cup.group
  })
  if (sameLayer.length > 0) {
    const target = cup.dir > 0 ? sameLayer[0] : sameLayer[sameLayer.length - 1]
    const n = world.byId.get(target)
    if (n) addSpin(n, cup.dir * world.cfg.chainSpin)
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
 * 承重路径检查（结定时调用）：
 * 1) 环向完整性：一圈缺弧超过阈值 → 剩下的弧自立不住 → 整层失效
 * 2) 支撑：每只杯只由"同列正下方"那一只支撑，支撑没了 → 失效
 * 3) 全部走"排队错峰"倾倒，所以视觉上是逐层传上去的多米诺，而不是同一帧齐倒
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
        if (layer === 0) continue // 最底层直接坐在转盘上
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
      // 必须"两只支撑都在"：杯要嵌在下层两只杯之间的杯缝里。
      // 只剩一只 = 单点接触 = 悬挑 → 撑不住（这就是"倒三角撑不住"的判据）。
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
  const dt = dtMs / 1000

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

  const sign = cup.tilt >= 0 ? 1 : -1
  const tilt = Math.abs(cup.tilt)

  if (tilt > world.cfg.frictionAngle) {
    // 越过摩擦临界：重力主导，倾倒加速
    cup.omega += world.cfg.toppleAccel * dt * sign
    cup.omega -= cup.omega * world.cfg.damping * 0.25 * dt
  } else {
    // 静摩擦区：角速度被吃掉；倾角缓慢回正（τ≈1s），慢速单发只会"打歪"
    cup.omega -= cup.omega * world.cfg.damping * dt
    cup.tilt *= Math.max(0, 1 - world.cfg.tiltRelax * dt)
    if (tilt < 0.004 && Math.abs(cup.omega) < 0.02) {
      cup.tilt = 0
      cup.omega = 0
      cup.state = 'standing'
    }
  }

  cup.tilt += cup.omega * dt
  if (Math.abs(cup.tilt) >= world.cfg.toppleAngle) topple(cup, world)
}

export function stepProjectile(p: Projectile, dtMs: number, cfg: PhysicsConfig): void {
  const dt = dtMs / 1000
  p.age += dtMs
  p.vy += cfg.projGravity * dt
  p.x += p.vx * dt
  p.y += p.vy * dt
  if (p.age > 2600 || p.y > 900) p.dead = true
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
