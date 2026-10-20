import { Application } from 'pixi.js'
import { CompositeTriggerSource, LocalTriggerSource } from './engine/trigger'
import { paperCupTheme } from './engine/theme'
import type { ShotOutcome, ToppleInfo } from './engine/types'
import { KeyboardTriggerSource } from './input/keyboard-trigger'
import { CartoonAudio } from './game/audio'
import { CupRenderer } from './game/renderer'
import { Session } from './game/session'

async function main(): Promise<void> {
  const app = new Application()
  await app.init({
    resizeTo: window,
    antialias: true,
    background: '#0d1b26',
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  })
  const host = document.getElementById('app')
  if (!host) throw new Error('#app missing')
  host.appendChild(app.canvas)

  const local = new LocalTriggerSource()
  const keyboard = new KeyboardTriggerSource()
  const trigger = new CompositeTriggerSource([local, keyboard])
  const audio = new CartoonAudio()
  let lastShot: ShotOutcome | null = null
  let lastTopple: ToppleInfo | null = null

  const session = new Session({
    source: trigger,
    autoLoopMs: 5000,
    // 时间轴交给 Pixi ticker 推进（每帧 ~16ms）；内部 100ms 定时器会让高速弹体穿模
    autoTimer: false,
    onShot: (o) => {
      lastShot = o
    },
    onTopple: (info) => {
      lastTopple = info
      if (info.isHighlight) audio.highlight()
      else if (info.combo >= 2) audio.combo(info.combo)
      else audio.hit()
    },
    onPhase: (p) => {
      if (p === 'settled') audio.highlight()
    },
  })

  const renderer = new CupRenderer(paperCupTheme)
  app.stage.addChild(renderer.root)

  const fit = () => {
    const w = app.screen.width
    const h = app.screen.height
    const sc = Math.min(w / 1280, h / 720)
    renderer.root.scale.set(sc)
    renderer.root.position.set((w - 1280 * sc) / 2, (h - 720 * sc) / 2)
  }
  window.addEventListener('resize', fit)
  fit()

  const bind = (id: string, fn: () => void) => {
    document.getElementById(id)?.addEventListener('click', fn)
  }
  bind('btn-start', () => session.start())
  bind('btn-end', () => session.settle())
  bind('btn-free', () => local.emitBarrage('观众'))
  bind('btn-gift1', () => local.emitGift('rose'))
  bind('btn-gift2', () => local.emitGift('heart'))
  bind('btn-rainbow', () => local.emitGift('rocket'))

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return
    const k = e.key.toLowerCase()
    if (k === 's') session.start()
    else if (k === 'e') session.settle()
    else if (k === 'h') document.body.classList.toggle('clean')
  })

  app.ticker.add((ticker) => {
    const dt = Math.min(100, ticker.deltaMS)
    session.advance(dt)
    renderer.render(
      {
        cups: session.cups,
        projectiles: session.projectiles,
        phase: session.phase,
        score: session.summary.score,
        combo: session.combo,
        timeLeftMs: session.timeLeftMs,
        durationMs: session.durationMsValue,
        lastShot,
        lastTopple,
        summary: session.summary,
        loopCountdownMs: session.loopCountdownMs,
        worldAngle: session.towerAngle,
        tower: session.tower,
      },
      Math.min(100, ticker.deltaMS),
    )
    lastShot = null // 特效与大字只触发一次
    lastTopple = null
  })
}

void main()
