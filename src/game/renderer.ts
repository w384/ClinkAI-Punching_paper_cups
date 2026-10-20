import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import type { Cup, Projectile, SessionPhase, SessionSummary, ShotOutcome, ToppleInfo } from '../engine/types'
import { cupAlpha, toppledTilt } from '../engine/physics'
import { HIT_POINT, PAPER_TOWER, PLATFORM_R, project, VIEW, type TowerConfig } from '../engine/tower'
import type { ThemePack } from '../engine/theme'

const VIEW_W = 1280
const VIEW_H = 720

const CUP_BASE_W = PAPER_TOWER.cupW
const CUP_BASE_H = PAPER_TOWER.cupH

/** 层高偏置：让上层杯底优先压住下层杯口（见 drawCups 注释） */
const LAYER_BIAS = 0.004

export interface RenderState {
  cups: Cup[]
  projectiles: Projectile[]
  phase: SessionPhase
  score: number
  combo: number
  timeLeftMs: number
  durationMs: number
  lastShot: ShotOutcome | null
  /** 最近一次小豆命中的杯子 id（null = 打空） */
  lastHitId: number | null
  lastTopple: ToppleInfo | null
  summary: SessionSummary
  loopCountdownMs: number
  worldAngle: number
  tower: TowerConfig
}

interface Fx {
  x: number
  y: number
  age: number
}

/** 旋转杯塔渲染：转盘 + 杯墙（对象池 + 纵深排序）+ 倾倒/翻倒 + 弹体 + 固定激光点 */
export class CupRenderer {
  readonly root = new Container()

  private readonly discLayer = new Graphics()
  private readonly cupLayer = new Container()
  private readonly projLayer = new Container()
  private readonly laserLayer = new Graphics()
  private readonly fxLayer = new Container()
  private readonly scoreText: Text
  private readonly comboText: Text
  private readonly phaseText: Text
  private readonly timeBar = new Graphics()
  private readonly bigWord: Text
  private readonly settleLayer = new Container()
  private readonly settleStats: Text
  private readonly settleHint: Text
  private readonly wordState = { text: '', color: '#ffffff', age: 1e9 }

  private readonly pool: Graphics[] = []
  private fx: Fx[] = []
  private pulse = 0

  constructor(private readonly theme: ThemePack) {
    const bg = new Graphics()
    bg.rect(0, 0, VIEW_W, VIEW_H).fill('#0b1620')
    bg.rect(0, 0, VIEW_W, 360).fill('#13293c')
    bg.circle(180, 96, 42).fill('#1d3b52')
    bg.circle(242, 116, 28).fill('#1d3b52')
    bg.circle(1052, 84, 36).fill('#1d3b52')
    bg.circle(1104, 100, 24).fill('#1d3b52')
    bg.rect(0, 470, VIEW_W, 250).fill('#0e1c27')

    this.scoreText = new Text({ text: '得分 0', style: this.hudStyle(28) })
    this.scoreText.position.set(32, 26)
    this.comboText = new Text({ text: '', style: this.hudStyle(26) })
    this.comboText.anchor.set(0.5, 0)
    this.comboText.position.set(VIEW_W / 2, 62)
    this.phaseText = new Text({ text: '', style: this.hudStyle(20, '#9fc4dd') })
    this.phaseText.anchor.set(0.5, 1)
    this.phaseText.position.set(VIEW_W / 2, VIEW_H - 16)
    this.bigWord = new Text({ text: '', style: this.hudStyle(72) })
    this.bigWord.anchor.set(0.5, 0.5)
    this.bigWord.position.set(VIEW_W / 2, 190)
    this.bigWord.alpha = 0

    const veil = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: '#04121c', alpha: 0.66 })
    const panel = new Graphics()
      .roundRect(VIEW_W / 2 - 300, 176, 600, 320, 26)
      .fill('#0f2536')
      .stroke({ width: 4, color: this.theme.colors.cup })
    const title = new Text({ text: '本局完成', style: this.hudStyle(46) })
    title.anchor.set(0.5, 0.5)
    title.position.set(VIEW_W / 2, 236)
    this.settleStats = new Text({ text: '', style: this.settleStatsStyle() })
    this.settleStats.anchor.set(0.5, 0.5)
    this.settleStats.position.set(VIEW_W / 2, 336)
    this.settleHint = new Text({ text: '', style: this.hudStyle(22, '#8fb8d4') })
    this.settleHint.anchor.set(0.5, 0.5)
    this.settleHint.position.set(VIEW_W / 2, 446)
    this.settleLayer.addChild(veil, panel, title, this.settleStats, this.settleHint)
    this.settleLayer.visible = false

    this.ensurePool(420)

    this.root.addChild(
      bg,
      this.discLayer,
      this.cupLayer,
      this.projLayer,
      this.laserLayer,
      this.fxLayer,
      this.bigWord,
      this.timeBar,
      this.scoreText,
      this.comboText,
      this.phaseText,
      this.settleLayer,
    )
  }

  private hudStyle(size: number, fill = '#eaf4ff'): TextStyle {
    return new TextStyle({
      fontSize: size,
      fill,
      fontWeight: 'bold',
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
    })
  }

  private settleStatsStyle(): TextStyle {
    return new TextStyle({
      fontSize: 30,
      fill: '#eaf4ff',
      fontWeight: 'bold',
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      align: 'center',
      lineHeight: 52,
    })
  }

  private ensurePool(n: number): void {
    while (this.pool.length < n) {
      const g = new Graphics()
      this.drawCupShape(g)
      g.visible = false
      this.pool.push(g)
      this.cupLayer.addChild(g)
    }
  }

  /** 杯形只画一次：杯口朝上、上宽下窄、白口沿 + 侧面暗部；原点在杯底 */
  private drawCupShape(g: Graphics): void {
    const w = CUP_BASE_W
    const h = CUP_BASE_H
    const bw = w * 0.74
    g.clear()
    g.poly([-bw / 2, 0, bw / 2, 0, w / 2, -h, -w / 2, -h]).fill(this.theme.colors.cup)
    g.poly([bw * 0.08, 0, bw / 2, 0, w / 2, -h, w * 0.18, -h]).fill({ color: '#000000', alpha: 0.18 })
    g.ellipse(0, -h, w / 2, w * 0.17).fill(this.theme.colors.cupStripe)
    g.ellipse(0, -h, w / 2 - 2, w * 0.17 - 2).fill({ color: '#0b1620', alpha: 0.5 })
  }

  render(s: RenderState, dtMs: number): void {
    this.pulse += dtMs / 1000
    this.drawDisc(s)
    this.drawCups(s)
    this.drawProjectiles(s)
    this.drawLaser(s)
    this.updateFx(s, dtMs)
    this.renderBigWord(s, dtMs)
    this.renderHud(s)
    this.renderSettle(s)
  }

  private drawDisc(s: RenderState): void {
    const g = this.discLayer
    g.clear()
    const rx = PLATFORM_R
    const ry = PLATFORM_R * 0.26
    g.ellipse(VIEW.cx, VIEW.baseY + 10, rx * 1.02, ry * 1.02).fill({ color: '#000000', alpha: 0.35 })
    g.ellipse(VIEW.cx, VIEW.baseY + 4, rx, ry).fill('#e8eef4')
    g.ellipse(VIEW.cx, VIEW.baseY + 4, rx, ry).stroke({ width: 3, color: '#b9c8d6' })
    g.ellipse(VIEW.cx, VIEW.baseY + 4, rx * 0.93, ry * 0.93).fill('#dbe6f0')
    for (let i = 0; i < 4; i++) {
      const a = s.worldAngle + (i / 4) * Math.PI * 2
      const x = VIEW.cx + Math.sin(a) * rx * 0.9
      const y = VIEW.baseY + 4 + Math.cos(a) * ry * 0.9
      g.circle(x, y, 5).fill('#8aa6bd')
    }
  }

  private drawCups(s: RenderState): void {
    this.ensurePool(s.cups.length)
    for (const g of this.pool) g.visible = false

    const alive = s.cups.filter((c) => c.state !== 'fallen')
    const sortable = alive
      .map((cup) => ({ cup, p: project(cup, s.worldAngle, s.tower) }))
      // 远 → 近绘制。层高偏置让"上层杯底"稳定压住"下层杯口"：
      // 砖缝错位会带来 ~0.007 的深度抖动，偏置取 0.004/层（12 层合计 0.048）刚好盖过它，
      // 又不至于打乱整圈的远近距离关系。
      .sort((a, b) => a.p.depth + a.cup.layer * LAYER_BIAS - (b.p.depth + b.cup.layer * LAYER_BIAS))

    let idx = 0
    for (const { cup, p } of sortable) {
      const g = this.pool[idx++]
      if (!g) break
      g.visible = true

      // 完全不通明：靠调亮/调暗表现纵深，避免后面的杯口从前面杯体里透出来
      const lit = 0.72 + 0.28 * ((p.depth + 1) / 2)
      const v = Math.round(255 * lit)
      g.tint = (v << 16) | (v << 8) | v

      if (cup.state === 'toppled') {
        // 翻倒：绕杯底旋转到 ±90°，向外侧滑一点，末尾淡出
        g.position.set(p.x + cup.dir * 16 * cup.fallT, p.y)
        g.rotation = toppledTilt(cup)
        g.alpha = cupAlpha(cup)
        g.scale.set(p.scale)
      } else {
        // 站立 / 歪斜：绕杯底倾斜
        g.position.set(p.x, p.y)
        g.rotation = cup.tilt
        g.alpha = 1
        g.scale.set(p.scale)
      }
    }
  }

  private drawProjectiles(s: RenderState): void {
    this.projLayer.removeChildren()
    for (const p of s.projectiles) {
      const g = new Graphics()
      g.alpha = p.alpha
      // 拖尾：沿速度反方向
      const len = Math.min(26, Math.hypot(p.vx, p.vy) * 0.03)
      const nx = p.vx / (Math.hypot(p.vx, p.vy) || 1)
      const ny = p.vy / (Math.hypot(p.vx, p.vy) || 1)
      g.moveTo(p.x, p.y).lineTo(p.x - nx * len, p.y - ny * len).stroke({
        width: 5,
        color: '#bfe6ff',
        alpha: 0.35,
      })
      g.circle(p.x, p.y, 6).fill('#eaf7ff')
      g.circle(p.x, p.y, 3.4).fill('#ffffff')
      this.projLayer.addChild(g)
    }
  }

  /** 固定击发点：底部正前方一颗绿色激光点（呼吸闪烁 + 击发瞬间增强） */
  private drawLaser(s: RenderState): void {
    const g = this.laserLayer
    g.clear()
    const firing = s.lastHitId != null ? 1.6 : 1
    const glow = (0.55 + 0.25 * Math.sin(this.pulse * 5)) * firing
    const active = s.phase === 'running'
    g.circle(HIT_POINT.x, HIT_POINT.y, 17 * firing).fill({ color: '#3dff92', alpha: active ? 0.16 * glow : 0.05 })
    g.circle(HIT_POINT.x, HIT_POINT.y, 9).fill({ color: '#3dff92', alpha: active ? 0.32 * glow : 0.1 })
    g.circle(HIT_POINT.x, HIT_POINT.y, 4).fill({ color: '#7dffb8', alpha: active ? 0.95 : 0.25 })
    g.moveTo(HIT_POINT.x, HIT_POINT.y)
      .lineTo(HIT_POINT.x, HIT_POINT.y - 32)
      .stroke({ width: 2, color: '#3dff92', alpha: active ? 0.3 : 0.07 })
  }

  /** 命中火花：落在被打的那只杯子上 */
  private updateFx(s: RenderState, dtMs: number): void {
    if (s.lastHitId != null) {
      const cup = s.cups.find((c) => c.id === s.lastHitId)
      if (cup) {
        const p = project(cup, s.worldAngle, s.tower)
        this.fx.push({ x: p.x, y: p.y - s.tower.cupH * 0.55, age: 0 })
      }
    }

    this.fxLayer.removeChildren()
    this.fx = this.fx.filter((f) => f.age < 320)
    for (const f of this.fx) {
      f.age += dtMs
      const t = Math.min(1, f.age / 220)
      const r = 5 + t * 22
      const g = new Graphics()
      g.circle(f.x, f.y, r).stroke({ width: 3 * (1 - t) + 1, color: '#ffe9a8', alpha: 1 - t })
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + t
        g.moveTo(f.x + Math.cos(a) * r * 0.5, f.y + Math.sin(a) * r * 0.5)
        g.lineTo(f.x + Math.cos(a) * (r + 9), f.y + Math.sin(a) * (r + 9))
        g.stroke({ width: 2.5, color: '#fff6cf', alpha: 1 - t })
      }
      this.fxLayer.addChild(g)
    }
  }

  private renderBigWord(s: RenderState, dtMs: number): void {
    if (s.lastTopple) {
      if (s.lastTopple.isHighlight) {
        this.wordState.text = this.theme.words.highlight
        this.wordState.color = this.theme.colors.accent
      } else if (s.lastTopple.combo >= 2) {
        this.wordState.text = `${this.theme.words.combo} x${s.lastTopple.combo}`
        this.wordState.color = '#ffd166'
      } else {
        this.wordState.text = '倒下！'
        this.wordState.color = '#9fe6c0'
      }
      this.wordState.age = 0
    }
    this.wordState.age += dtMs
    if (this.wordState.age < 900 && this.wordState.text) {
      this.bigWord.text = this.wordState.text
      this.bigWord.style.fill = this.wordState.color
      this.bigWord.alpha = Math.max(0, 1 - this.wordState.age / 900)
      this.bigWord.scale.set(1 + 0.15 * Math.min(1, this.wordState.age / 120))
    } else {
      this.bigWord.alpha = 0
    }
  }

  private renderHud(s: RenderState): void {
    this.scoreText.text = `得分 ${s.score}`
    this.comboText.text = s.combo >= 2 ? `${this.theme.words.combo} x${s.combo}` : ''
    const frac = s.durationMs > 0 ? Math.max(0, s.timeLeftMs / s.durationMs) : 0
    this.timeBar.clear()
    const w = 560 * frac
    if (w > 1) this.timeBar.roundRect(VIEW_W / 2 - w / 2, 30, w, 12, 6).fill(this.theme.colors.accent)
    this.timeBar.roundRect(VIEW_W / 2 - 280, 30, 560, 12, 6).stroke({ width: 2, color: '#3d6b8c' })
    this.phaseText.text = this.phaseLabel(s.phase)
  }

  private renderSettle(s: RenderState): void {
    if (s.phase !== 'settled') {
      this.settleLayer.visible = false
      return
    }
    this.settleLayer.visible = true
    const sum = s.summary
    this.settleStats.text = `命中 ${sum.totalHits}    最高连击 ${sum.maxCombo}\n高光时刻 ${sum.highlights}    得分 ${sum.score}`
    const secs = Math.ceil(s.loopCountdownMs / 1000)
    this.settleHint.text = secs > 0 ? `下一局 ${secs}s 后自动开始` : '按 S 开始下一局'
  }

  private phaseLabel(p: SessionPhase): string {
    if (p === 'running') return '转盘旋转 · 固定激光点从底部击发 · 火力压制到整墙坍塌'
    if (p === 'settled') return '本局完成'
    return '待开始 · 按 S 开一局'
  }
}
