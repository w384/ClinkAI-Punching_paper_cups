/**
 * WebAudio 合成卡通音效。
 * 合规红线：全部为 "pong / boing / duang" 卡通音色，
 * 禁止任何仿真枪声、金属撞击等写实武器音效。
 */
export class CartoonAudio {
  private ctx: AudioContext | null = null

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** 命中：短促 "pong" */
  hit(): void {
    this.blip({ type: 'sine', f0: 240, f1: 120, dur: 0.09, gain: 0.25 })
    this.noise(0.05, 0.1)
  }

  /** 连击：音调随连击数上行 "boing" */
  combo(level: number): void {
    const f0 = 320 + Math.min(level, 12) * 28
    this.blip({ type: 'triangle', f0, f1: f0 * 1.6, dur: 0.12, gain: 0.2 })
  }

  /** 高光时刻："duang" + 轻噪声 */
  highlight(): void {
    this.blip({ type: 'sawtooth', f0: 170, f1: 70, dur: 0.22, gain: 0.18 })
    this.noise(0.12, 0.12)
  }

  private blip(o: { type: OscillatorType; f0: number; f1: number; dur: number; gain: number }): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = o.type
    osc.frequency.setValueAtTime(o.f0, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur)
    g.gain.setValueAtTime(o.gain, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + o.dur)
    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + o.dur + 0.02)
  }

  private noise(dur: number, gain: number): void {
    const ctx = this.ensure()
    if (!ctx) return
    const t = ctx.currentTime
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
    const src = ctx.createBufferSource()
    src.buffer = buf
    const g = ctx.createGain()
    g.gain.value = gain
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 1200
    src.connect(filter).connect(g).connect(ctx.destination)
    src.start(t)
  }
}
