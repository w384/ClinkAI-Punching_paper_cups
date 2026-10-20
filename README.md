# cupsplash · 打纸杯直播互动小玩法

直播间里的**协作式解压小游戏**：观众用弹幕免费击发、用礼物加量，全房间一起把一座旋转的纸杯塔打塌。
只计总命中 / 最高连击 / 高光时刻 —— **无阵营、无输赢、无回兑**。

> 当前阶段：**M1 本地模拟版（可玩、可录 demo）**。平台接入（M2）与软著/审核（M3）尚未开始。
> 合规边界见 [docs/compliance.md](docs/compliance.md)，**任何迭代都不得突破**。

**在线试玩**：<http://106.53.200.115/>（nginx 静态托管，手机/PC 直接打开，部署细节见 [docs/deploy.md](docs/deploy.md)）

## 快速开始

```bash
pnpm install
pnpm dev          # 浏览器打开 http://localhost:5173
pnpm test         # 48 条单测
pnpm typecheck    # tsc --noEmit
pnpm build:single # 打成单个自包含 demo.html（双击即用，不需要服务器/网络）
```

录制 demo 用双击版 `demo.html` 更稳（无 Vite 依赖、无跨域问题）。

## 操作（键盘演示；事件形状与真实礼物/弹幕完全一致）

| 键 | 事件 | 效果 | 长按 |
|---|---|---|---|
| `空格` | 弹幕 | 免费击发 ×1 | 80ms 连发 |
| `J` | 礼物·rose | 多发一发 | 180ms |
| `K` | 礼物·heart | 双发（一次叠 2 次倾角） | 260ms |
| `L` | 礼物·rocket | 彩虹清杯（打整圈） | 1200ms |
| `S` / `E` | — | 开始一局 / 提前结算 | — |
| `H` | — | 隐藏 HUD（录屏用） | — |

## 玩法与物理

一座**空心圆环杯墙**立在旋转转盘上，底部正前方有一枚固定绿色激光点作为击发点。
弹体从画面下方抛物线飞入，只打底部那一圈当前转到正前方的杯子。

- **每发命中叠一次随机倾角**：从 3 个候选值里随机取一个（0.030 / 0.038 / 0.046 rad）叠加，不回正
- **至少 10 次才倒**：9 次即使每次都是最大值也只到 0.414 rad < 阈值 0.42，所以计数门是硬约束
- **或超阈值就倒**：累计倾角 ≥ 0.42 rad（配合礼物双发，5 发即可凑满）
- **一局 3 分钟**：打光整座塔（全部杯子倒下）立即结算；没打光就到时结算
- **打掉一只不倒塔**：上方杯子少一个支撑但仍能站住
- **两只相邻被打掉**：上方那只失去全部支撑 → 塌
- **塌落是序列化的**：结构失效的杯子先排队 110–280ms 再倒，一层层传上去（多米诺），不是整帧齐倒
- **不会整圈消失**：任何一层都只塌缺口正上方那一块（楔形收窄）

核心判据只有一条（[src/engine/physics.ts](src/engine/physics.ts) `relaxStructure`）：

```
一只杯站立的条件 = 它的两个支撑杯都还站着
只剩一个支撑 = 单点接触 = 悬挑 → 塌
```

## 目录

```
src/
  engine/
    tower.ts        杯塔几何（砖缝错位、两圈可选）、伪 3D 投影、支撑/邻居关系
    physics.ts      随机倾角叠加（3 候选值）、计数门/阈值判定、结构连锁、排队错峰
    rule.ts         击发、选杯、命中、计分
    trigger.ts      事件源抽象（本地 / 键盘 / 组合）
    platform-trigger.ts  M2 平台接入占位契约
    theme.ts        色板与礼物映射（换皮 = 换 ThemePack）
    types.ts        领域类型
  game/
    session.ts      一局的时间轴与状态机
    renderer.ts     PixiJS 渲染（池化 Graphics、深度排序、HUD）
    audio.ts        WebAudio 合成音效
  input/
    keyboard-trigger.ts  键盘映射 + 长按连发
test/               48 条 Vitest 单测（物理 / 规则 / 会话 / 键盘）
docs/               合规、设计、经验记录
scripts/            单文件打包、静态服务、demo 自检
```

## 当前物理参数（[src/engine/physics.ts](src/engine/physics.ts) `DEFAULT_PHYSICS`）

| 参数 | 值 | 作用 |
|---|---|---|
| `hitTiltValues` | `[0.030, 0.038, 0.046]` rad | 每次命中随机取一个叠加 |
| `hitTiltThreshold` | 0.42 rad | 累计超过就倒 |
| `minHitsToTopple` | 10 | 计数门（9 次上限 0.414，数学上保证至少 10 次） |
| `tiltVisualCap` | 0.42 rad | 视觉倾角封顶 |
| `chainTiltAdd` | 0.02 rad | 横向多米诺（很弱，不会自己扩散） |
| `hoopIntegrity` | 1（关闭） | 环向完整性，开过 0.5，因"整圈消失"已关 |
| `staggerBaseMs` / `Jitter` | 110 / 170 | 多米诺错峰 |
| `fallDurationMs` / `settleHoldMs` | 780 / 320 | 倒地动画 + 停留渐隐 |
| `projGravity` | 2200 px/s² | 弹体重力 |

## 时长与结束条件

| 项 | 值 |
|---|---|
| 单局上限 | **3 分钟**（`SessionOptions.durationMs`，默认 180000） |
| 提前结束 | **全部杯子倒下**（清杯）立即结算 |
| 结算内容 | 总命中 / 最高连击 / 高光时刻数 / 得分 |

## 路线图

- **M1（当前）** 本地模拟可玩 + demo 视频
- **M2** 抖音开放平台接入（`PlatformTriggerSource`）、礼物置顶映射、断线重试与对账
- **M3** 美术资源替换、软著材料、审核提交（主播真人开麦）
- M4/M5 见 [docs/plan.md](docs/plan.md)

## 已知限制

- 空心环墙的**背面会从正面缺口里透出来**，看起来像悬空结构（视觉认知问题，非物理错误）
- 美术是程序化占位（AI 生成资源未接入）
- 平台推送未实现，目前全部事件来自键盘 / 本地按钮
