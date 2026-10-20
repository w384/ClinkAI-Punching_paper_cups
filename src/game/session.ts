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
import { firstCupOnPath, Scoreboard, spawnProjectile } from '../engine/rule'
import { applyHit, DEFAULT_PHYSICS, relaxStructure, stepCup, stepProjectile, type PhysicsConfig, type World } from '../engine/physics'
import { eventToShot } from '../engine/trigger'
import { buildTower, PAPER_TOWER, VIEW, type TowerConfig } from '../engine/tower'
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
  /** 随机源（默认 Math.random；测试注入确定性序列） */
  rand?: () => number
  onTick?: (dtMs: number) => void
  onPhase?: (phase: SessionPhase) => void
  onShot?: (outcome: ShotOutcome) => void
  /** 小豆打到（或打空）时回调；cupId 为 null 表示这一发没碰到任何杯子 */
  onHit?: (cupId: number | null) => void
  onTopple?: (info: ToppleInfo) => void
}

/**
 * 局内状态机：idle → running → settled
 * 一局 = 一段火力压制：弹体打底部 → 每次命中叠加一次随机倾角 → 满 10 次或超阈值 → 翻倒 → 结构连锁
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
  /** 杯塔顶部：小豆越过这里就开始淡出，不再一路飞到画面顶端 */
  private readonly fadeTopY: number
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
    this.durationMs = opts.durationMs ?? 3 * 60_000
    this.theme = opts.theme ?? paperCupTheme
    this.autoTimer = opts.autoTimer ?? true
    this.timeLeftMs = this.durationMs
    this.fadeTopY = VIEW.baseY - this.tower.rows * this.tower.layerH - 30
    this.rebuildTower()

    this.world = {
      cups: this.cups,
      byId: this.byId,
      byGroupLayer: this.byGroupLayer,
      cfg: this.physics,
      rand: opts.rand ?? Math.random,
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
    // 不选目标：小豆直线上升，打到谁由碰撞决定
    const proj = spawnProjectile(this.projectileSeq++, shot)
    this.projectiles.push(proj)
    this.opts.onShot?.({ targetId: null, contacted: false, missed: false, impulse: proj.impulse })
  }

  advance(dtMs: number): void {
    if (this.phase !== 'running') return
    this.timeLeftMs = Math.max(0, this.timeLeftMs - dtMs)
    this.towerAngle += (this.tower.rotationSpeed * dtMs) / 1000
    // 必须在"命中结算"之前清零：命中造成的翻倒也要触发同一帧的结构重算，
    // 否则打掉底层后上方要等到下一次别的原因产生翻倒才开始塌。
    this.toppledThisFrame = 0

    // 小豆直线上升：与所有存活杯做"本帧线段 vs 圆"求交，取最先碰到的那只
    const alive: Projectile[] = []
    for (const p of this.projectiles) {
      if (p.dead) continue
      const prevX = p.x
      const prevY = p.y
      stepProjectile(p, dtMs, this.fadeTopY)

      const hit = firstCupOnPath(prevX, prevY, p.x, p.y, this.cups, this.towerAngle, this.tower)
      if (hit) {
        if (p.spread === 'ring') {
          // 彩虹清杯：撞到任何杯子后，清整圈最底层
          let bottom = Number.POSITIVE_INFINITY
          for (const c of this.cups) {
            if (c.state === 'standing' || c.state === 'leaning') bottom = Math.min(bottom, c.layer)
          }
          for (const c of this.cups) {
            if (c.layer !== bottom) continue
            if (c.state !== 'standing' && c.state !== 'leaning') continue
            // 彩虹清杯 = 直接把底层每只杯叠满计数门 → 必倒
            applyHit(c, this.physics.minHitsToTopple, this.world)
          }
        } else {
          applyHit(hit.cup, p.increments, this.world)
        }
        p.dead = true
        this.opts.onHit?.(hit.cup.id)
        continue
      }

      if (p.dead) {
        // 飞出画面都没碰到杯子 = 空击
        this.opts.onHit?.(null)
        continue
      }
      alive.push(p)
    }
    this.projectiles = alive

    // 杯子物理步进：先算单杯倾倒，再做承重路径检查（缺口太宽 → 上方成片塌）
    for (const cup of this.cups) stepCup(cup, dtMs, this.world)
    if (this.toppledThisFrame > 0) relaxStructure(this.world)

    this.opts.onTick?.(dtMs)

    // 结束条件：全部击倒（清杯）或到时间上限（默认 3 分钟）
    const cleared = this.cups.length > 0 && this.cups.every((c) => c.state === 'fallen')
    if (cleared || this.timeLeftMs <= 0) this.settle()
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
