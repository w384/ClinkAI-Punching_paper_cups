import type { TriggerEvent, TriggerSource } from '../engine/types'

export interface KeyBinding {
  /** KeyboardEvent.key，空格为 ' '；匹配时统一小写 */
  key: string
  event: TriggerEvent
  hint: string
  /** 长按连发间隔（ms）；0 或省略 = 只触发一次 */
  repeatMs?: number
}

/**
 * 键盘映射（演示用）
 * 事件形状与真实礼物/弹幕完全一致 → 规则层无需任何改动。
 * repeatMs 让"按住不放"变成持续火力压制，录制 demo 更好演示。
 */
export const DEFAULT_KEYMAP: KeyBinding[] = [
  { key: ' ', event: { type: 'barrage', payload: { name: '键盘·观众' } }, hint: '空格 免费击发（可长按）', repeatMs: 80 },
  { key: 'j', event: { type: 'gift', payload: { name: 'rose', amount: 1 } }, hint: 'J 礼物·多发一发（可长按）', repeatMs: 180 },
  { key: 'k', event: { type: 'gift', payload: { name: 'heart', amount: 1 } }, hint: 'K 礼物·双发（可长按）', repeatMs: 260 },
  { key: 'l', event: { type: 'gift', payload: { name: 'rocket', amount: 1 } }, hint: 'L 礼物·彩虹清杯（长按慢速）', repeatMs: 1200 },
]

/**
 * 键盘触发源：录制 demo / 无平台账号时的手动驱动。
 * 按住不放 → 按 repeatMs 间隔持续触发（模拟直播间持续火力）。
 * 接入平台后可与 PlatformTriggerSource 通过 CompositeTriggerSource 并行挂载。
 */
export class KeyboardTriggerSource implements TriggerSource {
  private readonly subs = new Set<(e: TriggerEvent) => void>()
  private readonly held = new Map<string, ReturnType<typeof setInterval>>()
  private readonly onDown: (e: Event) => void
  private readonly onUp: (e: Event) => void
  private readonly onBlur: () => void

  constructor(
    private readonly bindings: KeyBinding[] = DEFAULT_KEYMAP,
    private readonly target: EventTarget | null = typeof window !== 'undefined' ? window : null,
  ) {
    this.onDown = (raw: Event) => this.down(raw as KeyboardEvent)
    this.onUp = (raw: Event) => this.up(raw as KeyboardEvent)
    this.onBlur = () => this.releaseAll()
    this.target?.addEventListener('keydown', this.onDown)
    this.target?.addEventListener('keyup', this.onUp)
    this.target?.addEventListener('blur', this.onBlur)
  }

  subscribe(cb: (e: TriggerEvent) => void): () => void {
    this.subs.add(cb)
    return () => {
      this.subs.delete(cb)
    }
  }

  dispose(): void {
    this.releaseAll()
    this.target?.removeEventListener('keydown', this.onDown)
    this.target?.removeEventListener('keyup', this.onUp)
    this.target?.removeEventListener('blur', this.onBlur)
    this.subs.clear()
  }

  /** 正在连发的键（调试/测试用） */
  get activeKeys(): string[] {
    return [...this.held.keys()]
  }

  private emit(e: TriggerEvent): void {
    for (const s of [...this.subs]) s(e)
  }

  private bindingOf(e: KeyboardEvent): KeyBinding | undefined {
    const key = e.key.toLowerCase()
    return this.bindings.find((b) => b.key.toLowerCase() === key)
  }

  private down(e: KeyboardEvent): void {
    const binding = this.bindingOf(e)
    if (!binding) return
    e.preventDefault()
    if (e.repeat || this.held.has(binding.key)) return // 连发由自己的定时器负责
    this.emit(binding.event)
    const ms = binding.repeatMs ?? 0
    if (ms > 0) {
      this.held.set(
        binding.key,
        setInterval(() => this.emit(binding.event), ms),
      )
    }
  }

  private up(e: KeyboardEvent): void {
    const binding = this.bindingOf(e)
    if (!binding) return
    this.stop(binding.key)
  }

  private stop(key: string): void {
    const timer = this.held.get(key)
    if (timer !== undefined) {
      clearInterval(timer)
      this.held.delete(key)
    }
  }

  private releaseAll(): void {
    for (const key of [...this.held.keys()]) this.stop(key)
  }
}
