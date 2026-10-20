import type {
  Cup,
  Projectile,
  SessionPhase,
  SessionSummary,
  ShotOutcome,
  ToppleInfo,
  TriggerEvent,
  TriggerSource,
} from '../engine/types'
import { pickTarget, projectileHitSwept, Scoreboard, spawnProjectile } from '../engine/rule'
import { applyImpulse, DEFAULT_PHYSICS, relaxStructure, stepCup, stepProjectile, type PhysicsConfig, type World } from '../engine/physics'
import { eventToShot } from '../engine/trigger'
import { buildTower, PAPER_TOWER, type TowerConfig } from '../engine/tower'
import type { ThemePack } from '../engine/theme'
import { paperCupTheme } from '../engine/theme'

export interface SessionOptions {
  tower?: TowerConfig
  physics?: PhysicsConfig
  durationMs?: number
  source?: TriggerSource | null
  theme?: ThemePack
  autoTimer?: boolean
  /** 结算后自动开下一局的倒计时（ms，0 = 关闭） */
  autoLoopMs?: number
  onTick?: (dtMs: number) => void
  onPhase?: (phase: SessionPhase) => void
  onShot?: (outcome: ShotOutcome) => void
  onTopple?: (info: ToppleInfo) => void
}

/**
 * 局内状态机：idle → running → settled
 * 一局 = 一段火力压制：弹体打底部 → 冲量累积 → 倾角超过阈值 → 翻倒 → 连锁
 */
export class Session {
  phase: SessionPhase = 'idle'
  cups: Cup[] = []
  projectiles: Projectile[] = []
  timeLeftMs: number
  loopCountdownMs = 0
  towerAngle = 0
  readonly tower: TowerConfig
  readonly physics: PhysicsConfig
  readonly scoreboard = new Scoreboard()

  private byId = new Map<number, Cup>()
  private byGroupLayer = new Map<string, Cup[]>()
  private toppledThisFrame = 0
  private readonly world: World
  private readonly durationMs: number
  private readonly theme: ThemePack
  private readonly autoTimer: boolean
  private timer: ReturnType<typeof setInterval> | null = null
  private loopTimer: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private unsubscribe: (() => void) | null = null
  private projectileSeq = 0

  constructor(private readonly opts: SessionOptions = {}) {
    this.tower = opts.tower ?? PAPER_TOWER
    this.physics = opts.physics ?? DEFAULT_PHYSICS
    this.durationMs = opts.durationMs ?? 45_000
    this.theme = opts.theme ?? paperCupTheme
    this.autoTimer = opts.autoTimer ?? true
    this.timeLeftMs = this.durationMs
    this.rebuildTower()

    this.world = {
      cups: this.cups,
      byId: this.byId,
      byGroupLayer: this.byGroupLayer,
      cfg: this.physics,
      onTopple: (cup) => {
        this.toppledThisFrame++
        const info = this.scoreboard.topple()
        this.opts.onTopple?.({ cupId: cup.id, ...info })
      },
    }
    if (opts.source) this.unsubscribe = opts.source.subscribe((e) => this.onEvent(e))
  }

  get durationMsValue(): number {
    return this.durationMs
  }

  private rebuildTower(): void {
    const built = buildTower(this.tower)
    this.cups = built.cups
    this.byId = new Map(this.cups.map((c) => [c.id, c]))
    this.byGroupLayer = built.byGroupLayer
    if (this.world) {
      this.world.cups = this.cups
      this.world.byId = this.byId
      this.world.byGroupLayer = this.byGroupLayer
    }
    this.projectiles = []
    this.toppledThisFrame = 0
  }

  private setPhase(p: SessionPhase): void {
    this.phase = p
    this.opts.onPhase?.(p)
  }

  start(): void {
    if (this.phase === 'running') return
    this.clearLoopTimer()
    this.scoreboard.reset()
    this.rebuildTower()
    this.towerAngle = 0
    this.timeLeftMs = this.durationMs
    this.setPhase('running')
    if (this.autoTimer) this.startTimer()
  }

  onEvent(e: TriggerEvent): void {
    if (this.phase !== 'running') return
    const shot = eventToShot(e, this.theme)
    if (!shot) return

    this.scoreboard.fire()
    const target = pickTarget(this.cups, this.towerAngle)
    if (!target) {
      this.opts.onShot?.({ targetId: null, contacted: false, missed: true, impulse: 0 })
      return
    }

    const proj = spawnProjectile(this.projectileSeq++, target, this.towerAngle, this.tower, shot)
    this.projectiles.push(proj)
    this.opts.onShot?.({ targetId: target.id, contacted: true, missed: false, impulse: proj.impulse })
  }

  advance(dtMs: number): void {
    if (this.phase !== 'running') return
    this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs)
    this.towerAngle += (this.tower.rotationSpeed * dtMs) / 1000

    // 弹体飞行 + 扫掠命中判定（不依赖步长，避免高速弹体穿模）
    const alive: Projectile[] = []
    for (const p of this.projectiles) {
      if (p.dead) continue
      const prevX = p.x
      const prevY = p.y
      stepProjectile(p, dtMs, this.physics)
      if (p.dead) continue

      const target = this.byId.get(p.targetId)
      if (!target || target.state === 'fallen' || target.state === 'toppled') continue

      if (projectileHitSwept(p, prevX, prevY, target, this.towerAngle, this.tower)) {
        if (p.spread === 'ring') {
          // 彩虹清杯：打整圈最底层，随后整面墙失去支撑
          let bottom = Number.POSITIVE_INFINITY
          for (const c of this.cups) {
            if (c.state === 'standing' || c.state === 'leaning') bottom = Math.min(bottom, c.layer)
          }
          for (const c of this.cups) {
            if (c.layer !== bottom) continue
            if (c.state !== 'standing' && c.state !== 'leaning') continue
            applyImpulse(c, p.impulse, 1, this.physics)
          }
        } else {
          applyImpulse(target, p.impulse, 1, this.physics)
        }
        continue // 命中后弹体消失
      }
      alive.push(p)
    }
    this.projectiles = alive

    // 杯子物理步进：先算单杯倾倒，再做承重路径检查（缺口太宽 → 上方成片塌）
    this.toppledThisFrame = 0
    for (const cup of this.cups) stepCup(cup, dtMs, this.world)
    if (this.toppledThisFrame > 0) relaxStructure(this.world)

    // 整面墙塌完 → 补一面新塔
    if (this.cups.length > 0 && this.cups.every((c) => c.state === 'fallen')) this.rebuildTower()

    this.opts.onTick?.(dtMs)
    if (this.timeLeftMs <= 0) this.settle()
  }

  settle(): void {
    this.stopTimer()
    if (this.phase !== 'settled') {
      this.setPhase('settled')
      this.scheduleLoop()
    }
  }

  get summary(): SessionSummary {
    return this.scoreboard.summary
  }

  get combo(): number {
    return this.scoreboard.currentCombo
  }

  destroy(): void {
    this.stopTimer()
    this.clearLoopTimer()
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private scheduleLoop(): void {
    const loopMs = this.opts.autoLoopMs ?? 0
    if (loopMs <= 0) return
    this.loopCountdownMs = loopMs
    const startedAt = Date.now()
    this.clearLoopTimer()
    this.loopTimer = setInterval(() => {
      const left = loopMs - (Date.now() - startedAt)
      this.loopCountdownMs = Math.max(0, left)
      if (left <= 0) {
        this.clearLoopTimer()
        this.start()
      }
    }, 100)
  }

  private clearLoopTimer(): void {
    if (this.loopTimer) {
      clearInterval(this.loopTimer)
      this.loopTimer = null
    }
    this.loopCountdownMs = 0
  }

  private startTimer(): void {
    this.stopTimer()
    this.lastTick = Date.now()
    this.timer = setInterval(() => {
      const now = Date.now()
      this.advance(now - this.lastTick)
      this.lastTick = now
    }, 100)
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
