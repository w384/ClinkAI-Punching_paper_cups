import type { Cup } from './types'

export interface TowerConfig {
  /** 内塔层数 */
  rows: number
  /** 内塔每层杯数 */
  ringCount: number
  /** 内塔半径 */
  radius: number
  /** 每层高度（约等于杯高） */
  layerH: number
  /** 外圈层数（矮裙边） */
  outerLayers: number
  /** 外圈半径 */
  outerRadius: number
  /** 外圈每层杯数 */
  outerCount: number
  /** 转盘角速度（rad/s） */
  rotationSpeed: number
  cupW: number
  cupH: number
  /** 搭建时的对齐误差（rad）：越大越容易"没打就自己塌" */
  buildError: number
}

/**
 * 参考形态：内圈是主塔（高圆柱），外圈是 3 层的矮裙边，都立在圆盘上。
 * 关键结构：**同一圈内逐层错半格（砖缝）**，每只杯压在下面两只杯之间的杯缝里，
 * 这正是"叠杯"的手感；竖直对齐会变成格子感，不像叠杯。
 */
export const PAPER_TOWER: TowerConfig = {
  rows: 12,
  ringCount: 27,
  radius: 118,
  layerH: 36,
  outerLayers: 0,
  outerRadius: 0,
  outerCount: 0,
  rotationSpeed: 0.35,
  cupW: 28,
  cupH: 35,
  buildError: 0,
}

/** 屏幕上的塔底中心与基准线 */
export const VIEW = { cx: 640, baseY: 596 }

/** 固定击发点（底部正前方的绿色激光点 = 瞄准点） */
export const HIT_POINT = { x: VIEW.cx, y: VIEW.baseY + 40 }

/** 弹体炮口（画面下方外侧，弹体从这里抛物线飞入） */
export const MUZZLE = { x: VIEW.cx, y: VIEW.baseY + 184 }

/** 转盘平台半径 */
export const PLATFORM_R = PAPER_TOWER.radius + (PAPER_TOWER.outerRadius || 0) + 58

const TAU = Math.PI * 2

export function angularDist(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
}

export interface BuildOptions {
  /** 伪随机源（0..1），用于搭建误差；省略则完全对齐 */
  rand?: () => number
}

/** 组 id：0 = 内塔，1 = 外圈 */
export const GROUP_INNER = 0
export const GROUP_OUTER = 1

export interface BuiltTower {
  cups: Cup[]
  /** `${group}:${layer}` → 该圈该层的杯子 */
  byGroupLayer: Map<string, Cup[]>
}

/**
 * 构建杯塔并计算结构关系：
 * - supporters：**同列正下方**那一只（垂直对齐，1:1）
 * - neighbors：同层左右各 1 只 + 同列正上方 1 只（连锁/视觉用）
 * - load：它上方同列的杯子数
 */
export function buildTower(cfg: TowerConfig, opts: BuildOptions = {}): BuiltTower {
  const cups: Cup[] = []
  const groups: Cup[][][] = []
  const byGroupLayer = new Map<string, Cup[]>()
  const rand = opts.rand ?? (() => 0.5)
  let id = 0

  const build = (group: number, layers: number, radius: number, count: number): Cup[][] => {
    const gl: Cup[][] = []
    for (let l = 0; l < layers; l++) {
      // 砖缝：奇数层整体错半格，杯子落在下层的杯缝里
      const layerPhase = (l % 2) * (Math.PI / count)
      const ring: Cup[] = []
      for (let i = 0; i < count; i++) {
        const err = cfg.buildError > 0 ? (rand() * 2 - 1) * cfg.buildError : 0
        const cup: Cup = {
          id: id++,
          index: i,
          angle: (i / count) * TAU + layerPhase,
          radius,
          layer: l,
          group,
          mass: 1,
          tilt: err,
          omega: 0,
          state: 'standing',
          supporters: [],
          neighbors: [],
          fallT: 0,
          fallFrom: err,
          lieMs: 0,
          dir: 1,
          pendingMs: 0,
        }
        ring.push(cup)
        cups.push(cup)
      }
      gl.push(ring)
      byGroupLayer.set(`${group}:${l}`, ring)
    }
    groups.push(gl)
    return gl
  }

  const inner = build(GROUP_INNER, cfg.rows, cfg.radius, cfg.ringCount)
  // 外圈可选：outerLayers = 0 时不建
  if (cfg.outerLayers > 0 && cfg.outerCount > 0) build(GROUP_OUTER, cfg.outerLayers, cfg.outerRadius, cfg.outerCount)

  for (const gl of groups) {
    // 支撑：压在下层两只杯的杯缝上（最近的 2 只）
    for (let l = 1; l < gl.length; l++) {
      const below = gl[l - 1]
      const spacing = TAU / Math.max(1, below.length)
      for (const cup of gl[l]) {
        cup.supporters = [...below]
          .sort((a, b) => angularDist(a.angle, cup.angle) - angularDist(b.angle, cup.angle))
          .filter((c) => angularDist(c.angle, cup.angle) < spacing * 0.75)
          .slice(0, 2)
          .map((c) => c.id)
      }
    }
    // 邻居：同层左右 + 正上方（连锁/视觉用）
    for (let l = 0; l < gl.length; l++) {
      const ring = gl[l]
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const nb: number[] = [ring[(i - 1 + n) % n].id, ring[(i + 1) % n].id]
        if (l + 1 < gl.length) nb.push(gl[l + 1][i].id)
        ring[i].neighbors = nb
      }
    }
  }

  void inner
  return { cups, byGroupLayer }
}

export interface Projection {
  x: number
  y: number
  depth: number
  scale: number
  theta: number
}

/**
 * 伪 3D 投影：水平按 sin 展开，纵深按 cos 压成椭圆；
 * 近处（depth=1）略大且靠下，远处（depth=-1）略小且靠上。
 */
export function project(cup: Cup, worldAngle: number, cfg: TowerConfig): Projection {
  const theta = cup.angle + worldAngle
  const depth = Math.cos(theta)
  const x = VIEW.cx + Math.sin(theta) * cup.radius
  const y = VIEW.baseY - cup.layer * cfg.layerH + depth * cup.radius * 0.2
  return { x, y, depth, scale: 1 + depth * 0.1, theta }
}
