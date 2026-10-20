import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompositeTriggerSource, LocalTriggerSource } from '../src/engine/trigger'
import type { TriggerEvent } from '../src/engine/types'
import { DEFAULT_KEYMAP, KeyboardTriggerSource } from '../src/input/keyboard-trigger'

/** 简易假 EventTarget：按类型分桶，支持按下 / 松开 */
class FakeTarget {
  private listeners = new Map<string, Array<(e: unknown) => void>>()

  addEventListener(type: string, cb: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(cb)
    this.listeners.set(type, list)
  }

  removeEventListener(type: string, cb: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? []
    this.listeners.set(
      type,
      list.filter((l) => l !== cb),
    )
  }

  press(key: string, repeat = false): void {
    const e = { key, repeat, preventDefault: () => {} }
    for (const l of this.listeners.get('keydown') ?? []) l(e)
  }

  release(key: string): void {
    const e = { key, repeat: false, preventDefault: () => {} }
    for (const l of this.listeners.get('keyup') ?? []) l(e)
  }

  blur(): void {
    for (const l of this.listeners.get('blur') ?? []) l({})
  }
}

describe('KeyboardTriggerSource', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('空格 → 弹幕事件，J/K → 对应礼物事件；L 已移除', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    for (const k of [' ', 'j', 'k', 'l']) {
      target.press(k)
      target.release(k)
    }

    expect(got.map((e) => e.type)).toEqual(['barrage', 'gift', 'gift'])
    expect(got[1].payload.name).toBe('rose')
    expect(got[2].payload.name).toBe('heart')
  })

  it('大写与未知键处理正确', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press('J')
    target.press('z')
    expect(got).toHaveLength(1)
    expect(got[0].payload.name).toBe('rose')
  })

  it('长按空格 → 按重复间隔连续击发', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press(' ')
    expect(got).toHaveLength(1) // 按下立即一发
    vi.advanceTimersByTime(400)
    // 400ms / 80ms = 5 发，加按下那 1 发
    expect(got).toHaveLength(6)
    expect(got.every((e) => e.type === 'barrage')).toBe(true)
  })

  it('松开后停止连发', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press(' ')
    vi.advanceTimersByTime(240)
    const before = got.length
    target.release(' ')
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(before)
    expect(kb.activeKeys).toHaveLength(0)
  })

  it('系统 repeat 事件不会叠加触发（连发由自己的定时器负责）', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press(' ', false)
    target.press(' ', true)
    target.press(' ', true)
    expect(got).toHaveLength(1)
    expect(kb.activeKeys).toEqual([' '])
  })

  it('各键可配置不同的连发间隔', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(
      [
        { key: 'a', event: { type: 'barrage', payload: {} }, hint: 'a', repeatMs: 50 },
        { key: 'b', event: { type: 'barrage', payload: {} }, hint: 'b', repeatMs: 200 },
      ],
      target as unknown as EventTarget,
    )
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press('a')
    vi.advanceTimersByTime(200)
    target.release('a')
    target.press('b')
    vi.advanceTimersByTime(200)
    target.release('b')

    // a: 1 + 4 = 5，b: 1 + 1 = 2
    expect(got).toHaveLength(7)
  })

  it('repeatMs = 0 的键只触发一次', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(
      [{ key: 'x', event: { type: 'gift', payload: { name: 'rose' } }, hint: 'x', repeatMs: 0 }],
      target as unknown as EventTarget,
    )
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press('x')
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(1)
  })

  it('窗口失焦时释放所有连发', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))

    target.press(' ')
    target.blur()
    expect(kb.activeKeys).toHaveLength(0)
    const before = got.length
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(before)
  })

  it('dispose 后不再响应且停止连发', () => {
    const target = new FakeTarget()
    const kb = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const got: TriggerEvent[] = []
    kb.subscribe((e) => got.push(e))
    target.press(' ')
    kb.dispose()
    const before = got.length
    vi.advanceTimersByTime(1000)
    expect(got).toHaveLength(before)
    target.press(' ')
    expect(got).toHaveLength(before)
  })

  it('默认键位都支持长按连发', () => {
    for (const b of DEFAULT_KEYMAP) {
      expect(b.repeatMs ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('CompositeTriggerSource', () => {
  it('多个来源合流到同一订阅', () => {
    const local = new LocalTriggerSource()
    const target = new FakeTarget()
    const keyboard = new KeyboardTriggerSource(undefined, target as unknown as EventTarget)
    const merged = new CompositeTriggerSource([local, keyboard])

    const cb = vi.fn()
    merged.subscribe(cb)

    local.emitGift('heart')
    target.press('j')
    target.release('j')

    expect(cb).toHaveBeenCalledTimes(2)
    expect((cb.mock.calls[1][0] as TriggerEvent).payload.name).toBe('rose')
  })

  it('取消订阅后全部失效', () => {
    const local = new LocalTriggerSource()
    const keyboard = new KeyboardTriggerSource(undefined, new FakeTarget() as unknown as EventTarget)
    const merged = new CompositeTriggerSource([local, keyboard])
    const cb = vi.fn()
    const off = merged.subscribe(cb)
    off()
    local.emitBarrage('观众')
    expect(cb).not.toHaveBeenCalled()
  })
})
