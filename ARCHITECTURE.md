# Desktop-Claw 技术架构文档（面向开发与模型协作）v0.1

- 文档版本：v0.4
- 文档状态：Draft
- 面向对象：后端工程师、客户端工程师、AI 工程师、测试工程师、协作大模型
- 对应产品阶段：MVP（Companion-first）
- 更新日期：2026-03-19（v0.4 细化 WebSocket 消息协议）

---

## 1. 文档目的与适用范围

本文件用于统一 Desktop-Claw 的技术实现认知，回答三个核心问题：

1. 我们现在要做什么（MVP 技术边界）
2. 我们先不做什么（避免过度设计）
3. 我们如何在后续平滑演进（架构可扩展性）

本文件不是产品叙事文档的替代，而是工程实现的技术落地基线。

---

## 2. 核心设计原则

Desktop-Claw 的技术方案必须服务于产品定位：桌面常驻、轻量高频、低打扰、可持续陪伴。

工程上遵循以下原则：

1. Companion-first：优先保证自然交互与连续感，而不是自动化能力堆叠。
2. 轻执行优先：先支持低风险高频任务，暂不开放高风险系统控制。
3. 先成立再扩展：MVP 采用最小可用架构，接口和事件模型保留扩展位。
4. 稳定优先于炫技：优先保证顺序一致性、错误可恢复、状态可观测。

---

## 3. 架构全景（MVP）

### 3.1 总览

```text
Desktop UI (Floating Claw)
        |
        | HTTPS (配置/历史/文件上传) + WebSocket (流式回复/事件)
        v
Gateway (入口层)
  - 鉴权与会话绑定
  - 消息标准化
  - 事件分发
  - 请求路由
        |
        v
Task Coordinator (最小 Command Queue)
  - 单用户单主会话串行
  - taskId 生命周期管理
  - 取消与超时
        |
        v
Agent Loop (ReAct-like)
  - 思考/工具选择/观察/继续
  - 状态管理与上下文裁剪
        |
        +--> Tool: read
        +--> Tool: write
        +--> Tool: edit

Memory Service
  - 按天归档（day bucket）
  - 短期上下文 + 长期摘要
```

### 3.2 为什么是 HTTPS + WebSocket 混合

1. HTTPS 负责确定性接口：登录、配置、文件上传、历史查询。
2. WebSocket 负责实时体验：流式 token、进度事件、错误事件、任务取消反馈。
3. MVP 阶段不走纯 WebSocket，避免把简单管理接口复杂化。

### 3.3 窗口架构（三窗口模型）

Desktop-Claw 采用三窗口模型，每个窗口对应一层交互深度：

```text
┌─────────────────────────────────────────────────────┐
│                     屏幕                             │
│                                                     │
│   ┌──────────────────────────────┐                  │
│   │      ChatPanel Window        │                  │
│   │   (独立窗口，右键打开面板)     │                  │
│   │   完整聊天 + 历史 + 设置      │                  │
│   └──────────────────────────────┘                  │
│                                                     │
│                            ╭─╮ ╭─╮ ╭─╮ ← 气泡      │
│          ┌─────────────┐   ╰─╯ ╰─╯ ╰─╯             │
│          │ QuickInput   │  ┌────┐                    │
│          │ (条形输入框)  │──│Ball│                    │
│          └─────────────┘  └────┘                    │
│          ← 双击展开/收起    ↑ 悬浮球窗口（72×72）     │
└─────────────────────────────────────────────────────┘
```

| 窗口 | 尺寸 | 触发方式 | 特性 |
|------|------|----------|------|
| **Ball Window** | 72×72 | 常驻 | frameless, transparent, alwaysOnTop('floating'), 可拖拽 |
| **QuickInput Window** | ~360×48 | 双击球出现/收起 | frameless, transparent, alwaysOnTop, 自适应方向（球在右侧向左展，反之向右） |
| **ChatPanel Window** | ~400×600 | 右键菜单"打开面板" | frameless, 可能半透明, alwaysOnTop(可选), 锚定在球附近 |

气泡渲染方案：

- 单击轻互动气泡 + 双击 QuickInput 回复气泡，均渲染在 Ball Window 上方
- 气泡采用固定 3 槽机制：新气泡从底部插入，旧气泡向上推移并渐隐（opacity 递减）
- Ball Window 需要在气泡出现时**临时扩大渲染区域**（或使用独立叠加窗口），同时保持透明背景

对话历史共享：

- 三层交互（单击/双击/面板）共享同一份对话历史，统一存储于 backend Memory Service
- QuickInput 的对话在 ChatPanel 面板中可见，反之亦然
- 保证用户无论从哪个入口交互，Claw 都"记得之前说过的话"

### 3.3 技术栈选型建议（MVP）

**桌面端**

| 维度 | 推荐选型 | 说明 |
|------|----------|------|
| 桌面框架 | Electron 或 Tauri | Electron 生态最成熟；Tauri 包体更小（Rust 后端） |
| UI 框架 | React + TypeScript | 标准 Web 技术栈，组件生态丰富 |
| 悬浮球实现 | Frameless Window + Always-on-Top | macOS 系统级浮窗能力 |
| 文件拖拽 | HTML5 Drop API | Electron/Tauri 均原生支持 |
| UI → Backend 通信 | Electron IPC / Tauri invoke | 进程内通信，不走网络 |

**后端 Service（进程内嵌，MVP 不独立部署）**

| 维度 | 推荐选型 | 说明 |
|------|----------|------|
| 运行时 | Node.js LTS | TypeScript 原生，与桌面生态一致 |
| HTTP/WS 框架 | Fastify + ws 库 | 轻量，性能好，MVP 够用 |
| 进程模式 | 嵌入桌面主进程 | 随 App 启动，无需单独部署 |

**本地数据存储路径约定（macOS）**

| 数据类型 | 方案 | 路径 |
|----------|------|------|
| 当日记忆/摘要 | JSON 文件（按天） | `~/Library/Application Support/desktop-claw/memory/YYYY-MM-DD.json` |
| 待办 / 记录 | SQLite | `~/Library/Application Support/desktop-claw/db/claw.db` |
| 文件处理缓存 | 本地目录 | `~/Library/Application Support/desktop-claw/files/` |
| 用户配置 | JSON 文件 | `~/Library/Application Support/desktop-claw/config.json` |

---

## 4. 关键组件定义

### 4.1 Gateway（入口与编排层）

职责：

1. 接收桌面端请求并标准化消息。
2. 管理 WebSocket 连接与在线状态。
3. 将请求转发给 Task Coordinator。
4. 将 Agent 输出按事件回推给客户端。
5. 统一处理鉴权、限流、日志与错误映射。

非职责：

1. 不承载复杂业务推理。
2. 不直接维护长期记忆语义。

### 4.2 Task Coordinator（最小 Command Queue）

MVP 定位：最小并发控制层，而非重型调度系统。

职责：

1. 为每次用户输入分配 taskId。
2. 保证任务按顺序串行执行（单主通道 FIFO）。
3. 跟踪任务状态：pending/running/done/failed/cancelled/timeout。
4. 提供取消当前任务能力。
5. 设置任务超时与队列长度上限。

说明：

即使不做“多会话产品形态”，仍需最小任务边界以避免乱序和状态覆盖。

### 4.3 Agent Loop（ReAct-like 执行循环）

职责：

1. 读取当前上下文与任务目标。
2. 通过 `SkillManager` 加载激活的 Skills，合并 system prompt 并收集 tools 声明。
3. 调用 LLM 进行下一步决策（携带 tools 列表）。
4. 触发工具调用并获取观察结果（Tool Use 返回 → Node.js 执行 → tool_result 回传）。
5. 持续迭代直至完成、失败或达到回合上限。
6. 生成最终输出并回传 Gateway。

说明：

Agent Loop 可以采用 ReAct 思维流程，但它是工程执行框架，不等同于纯 ReAct。Skills 层负责「模型知道什么」，Tools 层负责「代码能做什么」，两者在 Agent Loop 中汇合。

### 4.4 Memory Service（按天记忆）

职责：

1. 以日期为主键（dayKey = YYYY-MM-DD）聚合当天交互与关键事件。
2. 支持日历式回顾与检索。
3. 对长上下文进行摘要压缩，避免上下文膨胀。
4. 当日交互超过阈值（默认 20 轮）时，自动触发摘要归档并清空短期历史缓冲。

存储结构：

1. 短期记忆（内存）：最近 N 轮交互，N 由 Token 预算决定，默认 10 轮。
2. 当日记忆（文件）：`memory/YYYY-MM-DD.json`，包含 highlights、todos、files、summary。
3. 历史摘要（只读）：按 dayKey 索引，用于日历视图与跨日检索。

### 4.5 LLM 集成

职责：

1. 接收 Agent Loop 的推理请求（system prompt + 对话历史 + 工具列表）。
2. 调用外部 LLM API，支持流式输出（streaming）。
3. 管理 Token 预算：设置 max_tokens，上下文超限时裁剪历史。
4. 处理调用异常：格式错误自动修复、超时自动重试一次、模型不可用时降级备选。

约定：

1. LLM 提供商通过配置切换，不硬编码（MVP 建议默认接 OpenAI 兼容接口）。
2. 流式 token 通过 WebSocket 实时推送至客户端，不等全部生成后再返回。
3. 所有 LLM 调用须记录 token_in / token_out，用于成本可观测性。

---

## 5. 原子能力边界（MVP）

每一项原子能力由 **Skills 层 + Tools 层** 两层叠加实现：

| 层 | 是什么 | 作用 |
|----|--------|------|
| **Skills 层**（SKILL.md） | 带 YAML frontmatter 的 Markdown 文件 | 注入 system prompt 片段，告诉模型「何时用、怎么用、边界是什么」 |
| **Tools 层**（TypeScript） | Node.js `fs` 操作 + Tool Use schema 声明 | 真正执行文件 I/O，模型决策后由 Agent Loop 调用 |

两层缺一不可：只有 Tool 没有 Skill，模型不知道该不该调用；只有 Skill 没有 Tool，模型无法真正执行。

MVP 开放三项原子能力：

1. **read**：读取本地文件 / 记录内容。
2. **write**：写入新记录、待办、日记。
3. **edit**：修改已有记录与条目状态。

暂不开放：

1. exec（系统命令执行）

原因：

1. 与"轻量、低风险"定位一致。
2. 明显降低安全与误操作风险。
3. 缩短 MVP 验证路径，聚焦核心体验闭环。

### 5.1 Skill 调用策略

Agent Loop 在构建每次 LLM 请求前：

1. `SkillManager.load()` — 扫描并合并 `managed/`（内置）+ `workspace/skills/`（用户自定义）两个目录下的 SKILL.md 文件。
2. `formatSkillsForPrompt()` — 将激活的 Skill 内容追加进 system prompt。
3. `collectTools()` — 从激活的 Skills 收集 `tools[]` 声明，传给 LLM 作为 Tool Use 选项。

这样后续新增 `WebSearchSkill`、`CalendarSkill` 等，Agent Loop 代码零改动。

### 5.2 分阶段演进

| 阶段 | 能力 |
|------|------|
| Milestone A（现在） | `FileSkill`（内置）：read / write / edit，硬编码 managedDir |
| Milestone C | MCP Client 适配层，社区 MCP Server 可包装为 Skill |
| Milestone D | 用户自定义 Skill：`~/Library/Application Support/desktop-claw/skills/` 下放 SKILL.md 即可生效 |

---

## Companion 人格技术层

Companion 感不只是产品层设计，也需要工程层的一致性约定。以下规约确保每次 Agent 响应都符合 Companion-first 原则。

### System Prompt 标准结构

每次 Agent Loop 执行前，必须按以下结构向 LLM 注入上下文：

```
[角色定义]
你是 Claw，用户桌面上的 AI 小伙伴。
风格：温和、简洁、真诚，有陪伴感但不过度热情，有帮助感但不过度说教。
不要自我介绍为"AI"或"语言模型"，除非用户明确询问。

[当日记忆]
今天是 {date}。
{today_summary}（来自 Memory Service 当日摘要，最多 100 字，无记忆时留空）

[待办快照]
{todos_snapshot}（当日未完成待办，无待办时留空）

[工具约束]
可用工具：read / write / edit。
禁止执行系统命令。不主动推送提醒，除非用户明确请求。
```

### 上下文裁剪策略

| 策略 | 触发条件 | 行为 |
|------|----------|------|
| 截断 | 对话历史超过 Token 上限 | 保留最近 N 轮，丢弃早期记录 |
| 摘要触发 | 当日交互超过 20 轮 | 写入当日摘要文件，清空短期历史缓冲 |
| 显式记忆提取 | 用户说"记住…"或"帮我记下" | 优先提取为 preferencesDelta 写入当日记忆 |

### 连续感的工程保障

1. 每次响应前必须读取当日 memory 文件并注入 today_summary（即使应用重启后）。
2. 用户提及"之前""上次""昨天"等时，Agent 应自动查询对应 dayKey 的历史记忆。
3. Claw 的响应不应出现"我是全新对话，没有记忆"此类打破连续感的话术。

---

## 6. 数据与状态模型

### 6.1 任务对象（Task）

建议字段：

- taskId: string
- createdAt: string (ISO)
- input: string
- status: pending | running | done | failed | cancelled | timeout
- startedAt?: string
- finishedAt?: string
- error?: { code: string; message: string }
- output?: string
- meta?: { source: "desktop"; dayKey: string }

### 6.2 事件对象（Event）— WebSocket 消息信封

所有 WebSocket 消息均采用统一信封格式：

```jsonc
{
  "id": "msg_xxx",           // 消息唯一 ID（用于去重）
  "type": "task.token",      // 消息类型（决定 payload 结构）
  "taskId": "task_xxx",      // 关联的任务 ID（将同一次对话的消息串联）
  "ts": "2026-03-19T14:30:00.000Z",  // ISO 时间戳
  "payload": { ... }         // 具体数据，每种 type 不同
}
```

#### 客户端 → 服务端（用户发起）

| type | 说明 | payload |
|------|------|--------|
| `task.create` | 用户发送消息（从 QuickInput 或 ChatPanel） | `{ content: string }` |
| `task.cancel` | 用户取消正在进行的任务 | `{}` |

#### 服务端 → 客户端（后端推送）

| type | 说明 | payload | 前端处理 |
|------|------|--------|----------|
| `task.ack` | 服务端确认收到任务 | `{}` | 显示“正在思考...” |
| `task.token` | AI 流式输出一段文字 | `{ delta: string }` | 追加到当前消息气泡 |
| `task.done` | 任务完成 | `{ content: string }` | 消息定稿，停止 cursor |
| `task.error` | 任务出错 | `{ code: string, message: string }` | 显示错误提示 |
| `task.cancelled` | 任务已取消 | `{}` | 标记消息为“已中止” |

#### 预留扩展（A.6 工具层接入后启用）

| type | 说明 | payload |
|------|------|--------|
| `task.tool_start` | Agent 开始调用工具 | `{ tool: string, args: object }` |
| `task.tool_end` | 工具执行完毕 | `{ tool: string, result: string }` |

#### 完整对话消息流示例

```text
客户端 → { type: "task.create", taskId: "t1", payload: { content: "帮我看看今天写了什么" } }
服务端 → { type: "task.ack",    taskId: "t1", payload: {} }
服务端 → { type: "task.token",  taskId: "t1", payload: { delta: "让我" } }
服务端 → { type: "task.token",  taskId: "t1", payload: { delta: "看看..." } }
服务端 → { type: "task.done",   taskId: "t1", payload: { content: "让我看看...今天你写了3篇笔记" } }
```

前端按 `taskId` 将同一任务的事件聚合渲染到同一条消息中。

### 6.3 记忆对象（Day Memory）

建议字段：

- dayKey: YYYY-MM-DD
- highlights: string[]
- todos: { id: string; text: string; status: "open" | "done" }[]
- files: { name: string; summary: string }[]
- preferencesDelta: string[]
- summary: string

---

## 7. 接口与通信约定（MVP）

### 7.1 HTTPS API

HTTPS 负责确定性接口（查询、配置、历史数据），与 WebSocket 职责分离：

1. POST /v1/tasks — 创建任务，返回 taskId
2. GET /v1/tasks/:taskId — 查询任务状态与最终结果（断线重连后的状态补偿入口）
3. POST /v1/files — 上传文件并返回 fileRef
4. GET /v1/memory/day/:dayKey — 获取某天聚合记忆（对话摘要 + 文件操作记录）

### 7.2 WebSocket 消息协议

WebSocket 负责实时交互（流式 token、进度事件、错误/取消反馈）。所有消息采用 §6.2 定义的统一信封格式。

**客户端发送的消息类型：**

1. `task.create` — 用户发送消息
2. `task.cancel` — 用户取消任务

**服务端推送的消息类型：**

1. `task.ack` — 任务已收到
2. `task.token` — AI 流式输出一段文字
3. `task.done` — 任务完成
4. `task.error` — 任务出错
5. `task.cancelled` — 任务已取消

各类型的 payload 结构见 §6.2 事件对象表格。

**设计要求：**

1. 所有消息必须带 `taskId`，客户端按 taskId 聚合渲染。
2. 所有消息必须带 `id`，用于幂等去重。
3. 断线重连后，客户端通过 HTTPS `GET /v1/tasks/:taskId` 拉取最终态进行状态补偿。
4. 信封格式固定，新增能力只需添加新的 type + payload，无需修改现有结构。

---

## 8. 错误处理与可靠性

### 8.1 错误分类

1. 用户输入错误：提示修正。
2. 工具调用错误：返回可读错误并给出恢复建议。
3. 模型调用错误：重试一次，必要时降级模型。
4. 网络错误：WebSocket 断线自动重连，必要时回落到状态轮询。

### 8.2 必备保护

1. 最大回合数限制（防止循环失控）。
2. 任务超时（防止挂死）。
3. 队列长度上限（防止堆积）。
4. 幂等键（防止重复提交）。

---

## 9. 安全与权限（MVP 基线）

1. 工具白名单：仅 read/write/edit。
2. 路径沙箱：限制可读写目录范围。
3. 敏感文件保护：默认拒绝访问系统关键路径。
4. 关键操作日志：记录 taskId、工具名、参数摘要、结果状态。

---

## 10. 可观测性与运维指标

MVP 至少采集以下指标：

1. task_end_to_end_latency_ms
2. queue_wait_time_ms
3. task_timeout_rate
4. task_cancel_rate
5. ws_reconnect_count
6. llm_token_in/out
7. tool_error_rate

日志最小字段：timestamp, taskId, eventType, status, durationMs, errorCode。

---

## 11. 里程碑建议

### 11.1 Milestone A（架构闭环）

1. Gateway + Task Coordinator + Agent Loop 基线跑通。
2. 完成 read/write/edit 三工具闭环。
3. 桌面端可收到流式响应与完成事件。

### 11.2 Milestone B（体验稳定）

1. 完成取消、超时、重试、断线重连。
2. 完成按天记忆聚合与日历查询。
3. 完成核心可观测性指标上报。

### 11.3 Milestone C（可扩展）

1. 预留多泳道并发扩展位（仍保持默认单通道）。
2. 预留 exec 受控接入设计（不在 MVP 开启）。
3. 建立测试基线与回归用例。

---

## 12. 明确不做（MVP）

1. 多平台渠道接入（Telegram/Discord）。
2. 重型任务自动化编排。
3. 高风险系统命令执行。
4. 复杂人格系统与主动打扰机制。

---

## 13. 推荐项目目录结构

```
desktop-claw/
├── apps/
│   └── desktop/                   # 桌面端（Electron 或 Tauri）
│       ├── src/
│       │   ├── main/              # 主进程：窗口管理、IPC、托盘
│       │   ├── renderer/          # 渲染进程：React UI
│       │   │   ├── components/
│       │   │   │   ├── FloatingBall/    # 悬浮球（单击轻互动 + 拖拽）
│       │   │   │   ├── ChatBubble/      # 气泡组件（3 槽渐变）
│       │   │   │   ├── QuickInput/      # 条形快速输入框（双击触发）
│       │   │   │   ├── ChatPanel/       # 完整聊天面板（右键打开）
│       │   │   │   └── ContextMenu/     # 右键上下文菜单
│       │   │   └── pages/
│       │   └── preload/           # 预加载脚本（contextBridge）
│       └── package.json
│
├── packages/
│   ├── backend/                   # 后端 Service（进程内嵌）
│   │   ├── src/
│   │   │   ├── gateway/           # Gateway：入口、路由、WebSocket 管理
│   │   │   ├── task-coordinator/  # 最小 Command Queue
│   │   │   ├── agent/             # Agent Loop（ReAct-like）
│   │   │   │   ├── loop.ts
│   │   │   │   ├── skill-primitives.ts  # Skill 加载与 prompt 格式化
│   │   │   │   ├── skill-manager.ts     # SkillManager（多目录合并、tools 收集）
│   │   │   │   ├── tools/         # Tool 层：read / write / edit（Node.js fs）
│   │   │   │   └── skills/        # Skill 层：FileSkill/SKILL.md（system prompt 片段）
│   │   │   ├── llm/               # LLM 集成（流式调用、重试、降级）
│   │   │   └── memory/            # Memory Service（按天归档）
│   │   └── package.json
│   │
│   └── shared/                    # 共享类型与工具
│       ├── types/                 # Task、Event、DayMemory 等类型定义
│       └── utils/
│
├── data/                          # 本地数据（运行时生成，对应 ~/Library/...）
│   ├── memory/                    # YYYY-MM-DD.json
│   ├── db/                        # claw.db
│   ├── files/                     # 文件处理缓存
│   └── config.json
│
└── package.json                   # monorepo 根配置
```

---

## 14. 附：开发协作约定（给人和模型）

1. 所有任务流必须产出 taskId。
2. 所有事件必须可追溯到 taskId。
3. 新增工具前必须补充：权限边界、失败处理、审计字段。
4. 修改记忆策略前必须验证：当日可读性、跨天摘要质量、上下文长度预算。
5. 技术设计评审优先回答：是否符合 Companion-first 与轻执行边界。

---

## 15. 一句话总结

Desktop-Claw 的 MVP 技术路线是：

在 Gateway + 最小 Command Queue + ReAct-like Agent Loop 的骨架下，以 **Skills（system prompt 注入）+ Tools（Node.js fs 执行）双层架构** 实现 read/write/edit 三项低风险原子能力，建立"桌面常驻 + 实时响应 + 按天记忆"的最小闭环，并为后续 MCP 接入与用户自定义 Skill 预留扩展接口。