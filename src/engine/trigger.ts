import type { ShotSpec, TriggerEvent, TriggerSource } from './types'
import type { ThemePack } from './theme'
import { SHOT_PROFILE } from './rule'

/** 触发层：把"弹幕/礼物/键盘"事件翻译为一发弹体参数 */
export function eventToShot(e: TriggerEvent, theme: ThemePack): ShotSpec | null {
  const profileOf = (effect: string) => SHOT_PROFILE[effect] ?? SHOT_PROFILE.free

  if (e.type === 'barrage') {
    const p = profileOf('free')
    return {
      kind: 'free',
      effect: 'free',
      power: 1,
      label: '弹幕 · 免费击发',
      mass: p.mass,
      speed: p.speed,
      spread: 'point',
    }
  }
  const mapping = theme.giftMap[e.payload.name ?? '']
  const effect = mapping?.effect ?? 'hit1'
  const p = profileOf(effect)
  return {
    kind: 'gift',
    effect,
    power: mapping?.power ?? 1,
    label: mapping?.label ?? '礼物 · 多发一发',
    mass: p.mass,
    speed: p.speed,
    spread: effect === 'rainbow' ? 'ring' : 'point',
  }
}

/** 本地模拟触发源：按钮 → 事件 */
export class LocalTriggerSource implements TriggerSource {
  private readonly subs = new Set<(e: TriggerEvent) => void>()

  subscribe(cb: (e: TriggerEvent) => void): () => void {
    this.subs.add(cb)
    return () => {
      this.subs.delete(cb)
    }
  }

  emitBarrage(name = '观众'): void {
    this.fire({ type: 'barrage', payload: { name } })
  }

  emitGift(name: string, amount = 1): void {
    this.fire({ type: 'gift', payload: { name, amount } })
  }

  private fire(e: TriggerEvent): void {
    for (const s of [...this.subs]) s(e)
  }
}

/** 合流触发源：键盘 + 平台推送 + 本地按钮 并行挂载 */
export class CompositeTriggerSource implements TriggerSource {
  constructor(private readonly sources: TriggerSource[]) {}

  subscribe(cb: (e: TriggerEvent) => void): () => void {
    const offs = this.sources.map((s) => s.subscribe(cb))
    return () => {
      for (const off of offs) off()
    }
  }
}
