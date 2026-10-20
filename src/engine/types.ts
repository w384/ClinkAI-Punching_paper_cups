/** 打纸杯小玩法 · 共享类型定义（刚体-轻量模型） */

export type CupState = 'standing' | 'leaning' | 'toppled' | 'fallen'

/**
 * 纸杯 = 薄壁轻质刚体（二维简化为"倾斜单自由度"）：
 * 只在倾角方向上受力，重心高、抗侧向冲击弱。
 */
export interface Cup {
  id: number
  /** 该层内的序号 */
  index: number
  /** 转盘上的角度（弧度） */
  angle: number
  /** 距转盘中心的半径 */
  radius: number
  /** 所在层（0 = 最底层） */
  layer: number
  /** 所属圈：0 = 内塔，1 = 外圈 */
  group: number
  /** 当前倾角（rad，带符号表示倾倒方向；= 累计值封顶后） */
  tilt: number
  /** 累计倾角（rad）：每次击中叠加一个随机值，不回正 */
  tiltSum: number
  /** 累计被击中次数 */
  hitCount: number
  state: CupState
  /** 支撑它的下层杯 id（砖缝：压在两只杯的缝上） */
  supporters: number[]
  /** 连锁传播对象：同层相邻 + 上层 */
  neighbors: number[]
  /** 翻倒动画进度 0..1 */
  fallT: number
  /** 翻倒起始倾角（保证动画从"被打歪的角度"接着倒，不弹回直立） */
  fallFrom: number
  /** 倒定后停留（渐隐）累计毫秒 */
  lieMs: number
  /** 结构已失效、排队等待倾倒的剩余毫秒（>0 表示已判倒但还没开始） */
  pendingMs: number
  /** 倾倒方向（-1 / +1） */
  dir: number
}

/** 投射物：抛物线弹体，碰撞时向纸杯输出冲量 */
export interface Projectile {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  age: number
  /** 瞄准的杯子 */
  targetId: number
  /** 冲量（质量 × 速度，仅用于 HUD/调试展示） */
  impulse: number
  /** 命中时叠加几次随机倾角（礼物加量） */
  increments: number
  /** 作用范围 */
  spread: 'point' | 'ring'
  dead: boolean
}

export type ShotKind = 'free' | 'gift'

export interface ShotSpec {
  kind: ShotKind
  /** 效果 id（主题层定义） */
  effect: string
  /** 加量档位 */
  power: number
  /** 展示文案（必须走合规话术） */
  label: string
  /** 弹体质量 */
  mass: number
  /** 弹体速度 */
  speed: number
  /** 作用范围：point = 打一只；ring = 打一圈（彩虹清杯） */
  spread: 'point' | 'ring'
}

/** 单次击发的结果（冲量是否真的打到了） */
export interface ShotOutcome {
  targetId: number | null
  contacted: boolean
  missed: boolean
  impulse: number
}

/** 单只杯子翻倒时产生的得分事件 */
export interface ToppleInfo {
  cupId: number
  scoreDelta: number
  combo: number
  isHighlight: boolean
}

export type SessionPhase = 'idle' | 'running' | 'settled'

export interface SessionSummary {
  totalShots: number
  totalHits: number
  maxCombo: number
  highlights: number
  score: number
}

/** 触发层事件：本地模拟 / 键盘演示 / 平台推送统一为此形状 */
export interface TriggerEvent {
  type: 'barrage' | 'gift'
  payload: { name?: string; amount?: number }
}

export interface TriggerSource {
  subscribe(cb: (e: TriggerEvent) => void): () => void
}
