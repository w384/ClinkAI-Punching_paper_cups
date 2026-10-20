/**
 * M2：抖音小玩法推送适配器（占位契约）
 *
 * 接入要求（以开放平台最新文档为准，社区实践参考）：
 * - access_token 有效期 2 小时 → 自动刷新与缓存
 * - room_id 绑定（直播伴侣 token）
 * - 长连接推送：礼物 / 弹幕数据
 * - 礼物置顶：最多 6 个配置礼物
 * - 任务启动：按数据类型
 * - 推送失败：分页查询 + 重试 + 对账
 *
 * 实现约束：
 * - 必须实现 TriggerSource，把平台事件归一为 TriggerEvent
 * - 单向数据流：平台 → 游戏；游戏侧不产生任何资金出向字段
 */
import type { TriggerEvent, TriggerSource } from './types'

export interface PlatformConfig {
  clientKey: string
  clientSecret: string
  openId: string
  roomToken?: string
  pushEndpoint: string
}

export class PlatformTriggerSource implements TriggerSource {
  constructor(readonly cfg: PlatformConfig) {}

  subscribe(_cb: (e: TriggerEvent) => void): () => void {
    // TODO(M2): 长连接建立 / token 刷新 / 断线重连 / 失败重试 / 本地 SQLite 对账
    throw new Error('PlatformTriggerSource 将在 M2 实现（平台 API 接入）')
  }
}
