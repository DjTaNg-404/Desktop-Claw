# Desktop-Claw · Dev Log

> 一个常驻桌面的 AI 小伙伴，以悬浮球作为入口，陪伴用户完成聊天、文件处理、轻记录与学习/工作陪跑。
> 
> 本文档记录开发进度与阶段性决策，随开发持续更新。

---

## 项目状态

**当前阶段：** Milestone A ✅ 完成  
**最近更新：** 2026-03-25  
**下一个目标：** Milestone B（能留 — 记忆 + 稳定性）

---

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Electron |
| UI | React + TypeScript |
| 后端（进程内嵌） | Node.js + Fastify |
| AI 调用 | OpenAI 兼容接口（流式） |
| 本地存储 | SQLite + JSON 文件（按天） |
| 包管理 | monorepo（pnpm workspaces） |

---

## 里程碑概览

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| Milestone 0 | 架构设计、技术选型、脚手架搭建 | ✅ 完成 |
| Milestone A | 架构闭环（Gateway + Agent Loop + 三工具） | ✅ 完成 |
| Milestone B | 体验稳定（取消/超时/记忆归档） | 🔲 未开始 |
| Milestone C | 可扩展（测试基线 + 扩展位预留） | 🔲 未开始 |

---

## 开发日志

### 2026-03-25｜Agent Skills 重构：迁移至脚本架构（三层渐进式标准）

**完成内容：**

**代码重构（遵循 agentskills.io 开放标准）：**
- 将 FileSkill 的工具实现从进程内 `ToolDefinition`（import + 直接调用）迁移为独立 CLI 脚本（子进程执行）
- 新增 `skills/file/scripts/`：`read_file.ts`、`write_file.ts`、`edit_file.ts` — 独立可执行脚本，JSON argv 输入 → JSON stdout 输出
- 新增 `skills/file/references/format-details.md` — Level 3 补充参考文档
- 删除旧的根级 tool .ts 文件（`skills/file/read_file.ts` 等）
- `skill-manager.ts`：移除所有静态工具导入，新增三个 meta-tool schema（`activate_skill` / `run_skill_script` / `read_skill_reference`），脚本执行通过 `child_process.execFile` + 解释器自动检测（.ts→npx tsx, .py→python3 等），30s 超时 + 1MB 输出上限
- `skill-primitives.ts`：新增 `scanSkillSubdir()` 扫描 scripts/ 和 references/ 目录，`LoadedSkill` 扩展 `skillDir`、`scripts`、`references` 字段，`formatActiveSkillsPrompt()` 追加可用脚本和参考文档列表
- `SKILL.md`：从工具说明重写为脚本接口描述格式（JSON 输入输出 schema）

**文档同步：**
- `ARCHITECTURE.md` 第五章全面更新（§5.1-§5.11）：核心概念（代码外置原则）、目录结构（scripts/ + references/）、SKILL.md 规范、脚本实现协议、三级加载流程（含 meta-tools 表）、SkillManager API、Agent Loop 集成流程图、安全约束（子进程隔离 + 脚本白名单）、MVP 能力规划、分阶段演进、设计检查清单
- `PLAN.md` 同步更新：A.6 任务清单、Agent Skills 渐进式披露设计、决策日志

**架构要点：**
- 三层标准：L1 SKILL.md frontmatter（Discovery）→ L2 SKILL.md body（Activation）→ L3 scripts/ + references/（Execution）
- 代码外置原则：脚本源码永远不进入 LLM 上下文，仅通过 JSON 接口交互
- 解释器自动检测：支持 .ts / .js / .py / .sh 等多语言脚本
- 安全：文件名校验（防路径穿越） + 白名单（仅已激活 Skill 的注册脚本） + 子进程沙箱

**验证结果：**
- `pnpm typecheck` → 三个包全部 0 错误 ✅
- Git 提交并推送至远程仓库 ✅

---

### 2026-03-22｜Milestone A 验收通过 🎉

**验收结果：** 全部通过

| 验收项 | 结果 |
|--------|------|
| 发消息 → AI 流式回复 | ✅ DeepSeek deepseek-chat 正常流式输出 |
| read_file 读取本地文件 | ✅ 读取 ~/Desktop/test-claw.txt 内容正确 |
| write_file 创建文件 | ✅ 在 ~/Desktop 创建 claw-note.md 成功 |
| edit_file 编辑文件 | ✅ 在 claw-note.md 末尾追加内容成功 |
| 悬浮球拖拽、展开/折叠 | ✅ 已在 A.1 验证 |

**修复的 Bug：**
- `skill-manager.ts`：electron-vite 打包后 `__dirname` 指向 `out/main/`，动态 `require()` .ts 文件失效 → 改为静态导入 + BUILTIN_SKILLS 注册表
- `path-security.ts`：`resolve(rel).startsWith('/')` 在 macOS 恒为 true → 改用 `isAbsolute(rel)`

**结论：** Milestone A 全部完成，进入 Milestone B。

---

### 2026-03-21｜Milestone A.6 · Skill 层（FileSkill + ReAct 循环）

**完成内容：**
- `packages/shared/src/types/tool.ts`：新建 Tool 类型定义 — `ToolSchema`（LLM function calling JSON Schema）、`ToolResult`（执行结果）、`ToolDefinition`（schema + execute）、`ToolCall`（LLM 返回的调用结构）
- `packages/shared/src/types/ws.ts`：`ChatMessageData.role` 扩展为 `'user' | 'assistant' | 'tool'`，新增 `tool_calls` 和 `tool_call_id` 字段以支持多轮 tool 对话
- `packages/backend/src/agent/skills/file/SKILL.md`：FileSkill 行为指南 — YAML frontmatter（name + description 触发词）+ Markdown 正文（使用指南、文件类型支持表、安全边界），Skill 激活时注入 system prompt
- `packages/backend/src/agent/skills/file/path-security.ts`：路径沙箱安全模块 — `validatePath()` 实现 allowedRoots 范围校验、`..` 路径穿越拦截、敏感路径前缀拦截（~/.ssh, /etc 等）、`realpathSync` 符号链接逃逸检测
- `packages/backend/src/agent/skills/file/read_file.ts`：`read_file` tool — 纯文本直读（.txt/.md/代码文件等 30+ 扩展名）+ .pdf 文本提取（pdf-parse v2 PDFParse 类）+ .docx 文本提取（mammoth）+ .xlsx CSV 转换（xlsx 库），512KB 大小上限
- `packages/backend/src/agent/skills/file/write_file.ts`：`write_file` tool — 创建/覆写文件，递归创建父目录，路径安全校验
- `packages/backend/src/agent/skills/file/edit_file.ts`：`edit_file` tool — 字符串精确替换，强制单次匹配（0 匹配或多匹配均报错），路径安全校验
- `packages/backend/src/agent/skill-primitives.ts`：Skill 加载原语 — `extractFrontmatter()` 简易 YAML 解析（无外部依赖）、`loadSkillsFromDir()` 扫描子文件夹 + require tool 文件、`formatSkillsForPrompt()` XML 标签包裹注入 system prompt、`collectToolSchemas()` 收集所有 ToolSchema[]
- `packages/backend/src/agent/skill-manager.ts`：`SkillManager` 类 — 全局单例，内置 skills 目录扫描，tool name → ToolDefinition 快速查找表，`getSkillPrompt()` / `getToolSchemas()` / `executeTool()` 三个核心方法
- `packages/backend/src/llm/client.ts`：升级为支持 Function Calling — `StreamChatOptions` 接受 `tools` 参数写入请求体，SSE 流式累积 `tool_calls`（跨 chunk 增量拼接），新增 `onToolCalls` 回调，正确映射 assistant tool_calls 和 tool 消息到 API 格式
- `packages/backend/src/agent/loop.ts`：完整 ReAct 循环 — 启动时加载 SkillManager，构建 system prompt（基础人格 + Skill 行为指南），收集 tools 传给 LLM，tool_calls → executeTool → tool_result → 追加 messages → 继续迭代，纯文本则结束

**新增依赖：** `pdf-parse`（v2.4.5）、`mammoth`（1.12.0）、`xlsx`（0.18.5）

**架构要点：**
- Skill = SKILL.md（行为指南，注入 prompt）+ tool .ts（可执行代码）自包含文件夹，新增能力只需加文件夹，Agent Loop 零改动
- 三级加载：L1 元数据（始终在 prompt）→ L2 正文（激活时注入）→ L3 references（按需读取）
- 路径安全：allowedRoots 白名单 + 敏感路径黑名单 + realpath 符号链接检测，MVP 默认允许 ~/Desktop、~/Documents、~/Downloads
- LLM tool_calls 流式累积：SSE 中 tool_calls 可能跨多个 chunk 增量到达，使用 index → Map 逐步拼接

**验证结果：**
- `pnpm typecheck` → shared + backend 两个包全部 0 错误 ✅

**下一步：** Milestone A 完成标志验收 → 端到端测试 FileSkill 实际调用

### 2026-03-21｜Milestone A.1.1 · ChatBubble 3 槽气泡组件

**完成内容：**
- `ChatBubble/index.tsx`：升级为支持 `opacity`、`showTail`、`tailAlign`（center/left/right）、`streaming` props；`onDismiss` 回传气泡 id；streaming 期间暂停 dismiss 计时器，完成后才启动倒计时
- `ChatBubble/styles.css`：尾巴支持 left/center/right 三种对齐；展开态取消 max-width 让气泡与 QuickInput 同宽；文本 4 行 clamp 防溢出；新增 `chat-bubble--streaming` 类
- `FloatingBall/index.tsx`：`bubble` 单值 → `bubbles` 数组（max 3）；`getBubbleOpacities()` 映射 `[0.4, 0.7, 1.0]`；JSX 重构为 `.bubble-area` + `.bottom-section` 双层纵向布局；流式气泡三阶段（创建 → token 追加 → 定型）；动态停留时间 `calcBubbleDuration()` → 5s 底 + 50ms/字，上限 15s
- `FloatingBall/styles.css`：根容器从 flex-row 改 flex-column；移除 `.ball-column`；新增 `.bottom-section`（球 + QI 同行）；展开态 `.bubble-area` 用 `align-items: stretch` 让气泡全宽
- `main/index.ts`：`BALL_WIN_H` 从 220 → 340，给 3 个气泡留出空间

**双模式布局设计：**
- 收起态（单击招呼）：窄气泡（max-width 200px）居中在球上方，尾巴居中朝下
- 展开态（QI 可见）：宽气泡横跨全宽和 QuickInput 对齐，尾巴指向球侧（left/right 方向自适应）

**流式气泡机制：**
- `task.ack`（streaming 开始）→ 立即创建气泡显示 `...`
- `task.token`（每次追加）→ 实时更新气泡文字
- `task.done`（流式完成）→ 定型气泡，此时才启动 dismiss 倒计时

**Bug 修复：**
- 流式完成后气泡不出现：原因是 `task.done` 原地更新消息（长度不变），`messages.length > prevMsgCountRef` 永远不成立。修复：新增 `prevStreamingRef` 追踪 streaming 状态翻转

**验证结果：**
- `pnpm typecheck` → 三个包全部 0 错误 ✅
- 单击快速 3 下 → 3 个气泡正确堆叠，渐变透明 ✅
- QI 发送消息 → 流式气泡实时追加文字 → 完成后启动倒计时 ✅

**下一步：** A.4 最小 Agent Loop

### 2026-03-20｜Milestone A.3 · LLM 流式接入

**完成内容：**
- `packages/backend/src/llm/config.ts`：新建配置读取模块，从 `data/config.json` 读取 LLM 配置（apiKey / baseURL / model），多路径 fallback 兼容 dev 和 prod 环境
- `packages/backend/src/llm/client.ts`：新建 LLM 客户端，使用原生 `fetch` 实现 OpenAI 兼容 API 的 SSE 流式调用，支持 30s 超时自动终止、AbortController 取消、错误分类（CONFIG_MISSING / API_ERROR / TIMEOUT / STREAM_ERROR）
- `packages/backend/src/gateway/ws.ts`：替换 echo 模式为真实 LLM 调用 —— `task.create` → 广播 `task.ack` → 逐 token 广播 `task.token` → 最终广播 `task.done`；`task.cancel` 现在会调用 `AbortController.abort()` 真正终止 LLM 请求
- System Prompt：MVP 内置简短中文人格提示（"你是 Claw 🐾，一个住在用户桌面上的 AI 桌宠伙伴"），后续 A.6 替换为 SOUL.md 组装

**零依赖方案：** 使用 Node.js 原生 `fetch` + `ReadableStream` 处理 SSE 流式响应，无需额外 HTTP/LLM SDK

**验证结果：**
- `pnpm typecheck` → 三个包全部 0 错误 ✅
- Node.js WS 客户端测试：`task.ack` → 逐字 `task.token` → `task.done` 完整流式链路 ✅
- 实测响应：GLM-5 via ModelScope OpenAI 兼容接口，流式输出正常 ✅

**下一步：** A.4 最小 Agent Loop

### 2026-03-20｜设置面板 · SettingsPanel

**完成内容：**
- `apps/desktop/src/renderer/components/SettingsPanel/index.tsx` + `styles.css`：新建设置面板组件，LLM 配置三字段（API Key / Base URL / Model），API Key 密码切换显示，暗色主题与 ChatPanel 一致
- `apps/desktop/src/main/index.ts`：新增 `createSettingsWindow()`（360×420 居中窗口）、`config:get/set` IPC、`window:close` IPC；右键菜单"设置"接入真实窗口
- `apps/desktop/src/renderer/App.tsx`：新增 `?view=settings` 路由
- `apps/desktop/src/renderer/components/ChatPanel/index.tsx` + `styles.css`：标题栏添加 × 关闭按钮
- `apps/desktop/src/preload/index.ts` + `env.d.ts`：暴露 `closeWindow`、`getConfig`、`setConfig`

**配置存储：** dev → `data/config.json`，prod → `app.getPath('userData')/config.json`；MVP 明文存储，Milestone B 升级 `safeStorage` 加密

### 2026-03-20｜Milestone A.2 · WebSocket 通路

**完成内容：**
- `packages/shared/src/types/ws.ts`：新建 WebSocket 消息信封类型定义（WsEnvelope），包含 7 种消息类型（task.create / task.cancel / task.ack / task.token / task.done / task.error / task.cancelled）+ conversation.history，以及各类 payload 接口
- `packages/shared/src/index.ts`：导出所有 WS 类型
- `packages/backend/src/gateway/ws.ts`：新建 WebSocket 服务端，基于 `@fastify/websocket` 插件注册 `/ws` 路由，内存会话记录 + 多客户端广播 + echo 模式
- `packages/backend/src/index.ts`：在 Fastify listen 前注册 WebSocket 插件
- `apps/desktop/src/renderer/hooks/useClawSocket.ts`：新建 React hook，浏览器原生 WebSocket 连接、断线自动重连、乐观更新、多窗口去重
- `apps/desktop/src/renderer/components/ChatPanel/index.tsx`：接入 `useClawSocket`，替换占位 echo，Panel 和 Ball 窗口通过 WS 广播实现对话历史跨窗口同步
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx`：QuickInput 发送改走 WS，AI 响应自动显示为气泡
- `apps/desktop/electron.vite.config.ts`：排除 workspace packages 外部化，resolve alias 指向源码，解决开发时 backend 修改不能实时生效的问题

**验证结果：**
- `pnpm typecheck` → 三个包全部 0 错误 ✅
- Node.js WS 客户端测试：收到 `conversation.history` → `task.ack` → `task.done` 完整消息流 ✅
- Electron 环境下 WS 通路正常 ✅

**关键决策记录：**
- 采用 `@fastify/websocket` 插件而非原生 `ws` + noServer 模式，避免 Fastify 拦截 upgrade 请求导致 404
- 渲染进程使用浏览器原生 WebSocket API，无需 preload 改动
- Ball 窗口和 Panel 窗口各自独立连接 WS，backend 通过广播 + `conversation.history` 实现跨窗口同步
- electron-vite 配置调整：workspace packages 通过 resolve alias 指向 TypeScript 源码打包，解决开发时 dist/ 过时问题

**下一步：** A.3 LLM 流式接入

### 2026-03-19｜Milestone A.1 · ChatPanel 完整面板

**完成内容：**
- `apps/desktop/src/main/index.ts`：新增 `createPanelWindow()` — 独立 BrowserWindow（400×600），frameless + 半透明 + alwaysOnTop('floating')，通过 `?view=panel` query 参数区分 UI，定位在球附近（左上方优先，自动避让屏幕边界）
- `apps/desktop/src/main/index.ts`：右键菜单“打开面板”现已联动 `createPanelWindow()`，已存在窗口时直接 focus
- `apps/desktop/src/renderer/components/ChatPanel/index.tsx`：ChatPanel 组件 — 消息列表（自动滚底）+ 多行输入框（Enter 发送、Shift+Enter 换行）+ 发送按钮，用户消息右对齐 / AI 消息左对齐，流式 cursor 动画预留
- `apps/desktop/src/renderer/components/ChatPanel/styles.css`：暗色主题，圆角气泡，渐变发送按钮，头部可拖拽（-webkit-app-region: drag）
- `apps/desktop/src/renderer/App.tsx`：通过 `URLSearchParams` 检测 `?view=panel` 路由分流，Ball 窗口和 Panel 窗口共用同一 renderer 构建

**验证结果：**
- `tsc --noEmit` → 0 错误 ✅

**关键决策记录：**
- Panel 与 Ball 共用同一 renderer 构建，通过 `?view=panel` query 参数在 App.tsx 中路由分流，避免维护两套 HTML 入口
- Panel 窗口设为可调整大小（minWidth 320, minHeight 400），便于用户根据需要调整
- 当前为占位 echo 回复，流式 token 和共享对话历史待 A.2 WebSocket 接入后实现

### 2026-03-19｜Milestone A.1 · 右键上下文菜单

**完成内容：**
- `apps/desktop/src/main/index.ts`：新增 `contextmenu:show` IPC handler，使用 Electron `Menu.buildFromTemplate` 构建原生菜单（打开面板 / 设置 / 分割线 / 退出 Claw）
- `apps/desktop/src/preload/index.ts` + `renderer/env.d.ts`：新增 `showContextMenu()` IPC 通道与类型声明
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx`：`onContextMenu` 从 `preventDefault` 改为调用 `showContextMenu()` 唤起原生菜单

**验证结果：**
- `tsc --noEmit` → 0 错误 ✅

**关键决策记录：**
- 采用 Electron 原生 Menu 而非自绘 React 菜单，保证系统级观感且不需要额外窗口管理
- “打开面板”和“设置”当前为占位 console.log，待对应模块实现后替换

### 2026-03-19｜Milestone A.1 · 双击 QuickInput 条形输入框

**完成内容：**
- `apps/desktop/src/main/index.ts`：新增 `quickinput:toggle` IPC handler — 保存原始窗口 bounds，计算球相对屏幕中心的方向（left/right），动态 setBounds 将窗口从 240→420 宽展开，收起时恢复原 bounds
- `apps/desktop/src/preload/index.ts` + `renderer/env.d.ts`：新增 `toggleQuickInput()` IPC 通道与类型声明
- `apps/desktop/src/renderer/components/QuickInput/index.tsx`：新建条形输入框组件 — 自动聚焦、Enter 发送、Escape 关闭、mouseenter/mouseleave 控制点击穿透
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx`：重写交互逻辑 — 双击调用 `toggleQuickInput()` 展开/收起输入框；QuickInput 展开时点击球即收起；发送消息后 bubble echo 占位回复
- `apps/desktop/src/renderer/components/FloatingBall/styles.css`：布局从 column 改为 row-based — 新增 `.ball-column`、`.qi-area`、`.ball-root--expanded` 展开态样式

**验证结果：**
- `tsc --noEmit` → 0 错误 ✅

**关键决策记录：**
- QuickInput 采用同窗口 resize 方案（而非独立 BrowserWindow），避免多窗口 IPC 协调复杂度
- 方向自适应：主进程通过 `screen.getDisplayNearestPoint()` 获取显示器，球中心在屏幕右半时输入框向左展开，反之向右
- QuickInput 展开时，球上 mousedown 直接收起输入框并 return，不进入拖拽/单双击检测流程
- 发送后暂用占位气泡回复（`收到「...」🐾`），待 A.2 WebSocket 接通后替换为真实 AI 回复

### 2026-03-19｜Milestone A.1 · 悬浮球单击交互 + 气泡组件

**完成内容：**
- `apps/desktop/src/main/index.ts`：Ball 窗口从 72×72 扩展为 240×220（含气泡区域），启用 `setIgnoreMouseEvents(true, { forward: true })` 透明穿透
- `apps/desktop/src/main/index.ts`：新增 `set-ignore-mouse-events` IPC 通道，renderer 可动态切换穿透状态
- `apps/desktop/src/preload/index.ts`：新增 `setIgnoreMouseEvents()` contextBridge 暴露
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx`：重写交互逻辑 — 单击显示随机气泡，双击预留（250ms 定时器区分），拖拽不变，mouseenter/mouseleave 控制穿透
- `apps/desktop/src/renderer/components/ChatBubble/index.tsx`：新建气泡组件，CSS 动画入场 + 渐隐退场，3 秒后自动消失
- `apps/desktop/src/renderer/components/FloatingBall/styles.css`：球移至底部居中，新增 `.bubble-area` 气泡区域（`pointer-events: none`），移除已废弃的 `.ball--open`

**验证结果：**
- `pnpm typecheck` → 三个 tsconfig 目标全部 0 错误 ✅

**关键决策记录：**
- 透明穿透方案：使用 Electron `setIgnoreMouseEvents(true, { forward: true })` + renderer mouseenter/mouseleave 动态切换，仅球区域接收点击，其余透明区域穿透到桌面
- 单击 vs 双击区分：通过 250ms setTimeout 定时器判断，第一次点击等待可能的第二次，超时则确认为单击
- ChatBubble 使用 React `key={id}` 强制重挂载以正确触发入场动画

**下一步：** A.1 双击交互（QuickInput 条形输入框） + 右键菜单（ContextMenu）

---

### 2026-03-19｜代码质量修正 · M0/A.1 遗留问题清理

**完成内容：**
- `packages/backend/src/index.ts`：`startBackend()` 返回 `{ close }` 对象，支持优雅关闭，避免退出时端口残留
- `apps/desktop/src/main/index.ts`：`startBackend()` 从模块顶层移入 `app.whenReady()` 内，启动顺序可控、失败可捕获
- `apps/desktop/src/main/index.ts`：新增 `app.on('before-quit')` 回调，退出时调用 `backendHandle.close()` 释放 Fastify
- `apps/desktop/src/main/index.ts`：新增 `ballWin.on('closed', () => ballWin = null)`，macOS 重激活时不再操作已销毁窗口
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx`：用 `listenersRef` + `useEffect` cleanup 保底清除 `window` 上的拖拽监听器，防止组件卸载时泄漏
- `apps/desktop/src/main/index.ts`：为 `sandbox: false` 添加注释说明关闭原因（electron-vite preload 打包依赖）
- `apps/desktop/tsconfig.node.json` + `tsconfig.web.json`：target 从 ES2020 统一为 ES2022，与 backend 包一致（Electron 34 完全支持）

**验证结果：**
- `pnpm typecheck` → 三个 tsconfig 目标全部 0 错误 ✅

**关键决策记录：**
- Backend 返回值设计：直接返回 `{ close }` 内联类型而非导出独立 interface，避免跨包 project references 下类型解析问题
- sandbox 保持关闭：electron-vite 的 preload 打包机制需要 Node.js require，暂无法开启 sandbox，但通过 contextBridge 严格控制暴露面

**下一步：** A.1 ChatPanel — 聊天面板 UI（输入框 + 消息列表 + 气泡 + 流式 cursor 动画）

---

### 2026-03-18｜Milestone A.1 · 悬浮球 UI 完成（FloatingBall）

**完成内容：**
- `apps/desktop/src/main/index.ts` 重写：创建 72×72 `frameless + transparent + alwaysOnTop`（`'floating'` 层级）窗口，初始位置屏幕右下角
- `apps/desktop/src/preload/index.ts` 新增 `dragStart / dragMove / dragEnd` IPC 通道（通过 `contextBridge` 暴露）
- `apps/desktop/src/renderer/components/FloatingBall/index.tsx`：圆形悬浮按钮，`movedRef` flag 区分拖拽与点击，点击切换 `isOpen` 展开/折叠状态
- `apps/desktop/src/renderer/components/FloatingBall/styles.css`：`html/body/#root background: transparent` 透明背景，橙色渐变圆、hover/active/open 状态动画
- `apps/desktop/src/renderer/env.d.ts`：`window.electronAPI` 全局类型声明

**验证结果：**
- `pnpm typecheck` → 三个 tsconfig 目标全部 0 错误 ✅
- Electron 悬浮球窗口正常启动，frameless 透明窗口渲染 ✅

**关键决策记录：**
- 拖拽驱动：renderer 监听 `mousemove` → IPC `drag:move` → main 用 `screen.getCursorScreenPoint()` + `setPosition()`，无需传坐标值，避免数据竞争
- 拖拽 vs 点击判断：利用 `movedRef.current` flag，`mousemove` 触发则为拖拽，否则为点击，简单可靠

**下一步：** A.1 ChatPanel — 聊天面板 UI（输入框 + 消息列表 + 气泡 + 流式 cursor 动画）

---

### 2026-03-18｜架构决策：Skills + Tools 双层原子能力

**背景：** 调研 anthropics/skills 仓库与 openclaw-mini 源码后，明确了原子能力（read/write/edit）的正确实现方式。

**决策：** 每项原子能力由两层叠加实现：

- **Skills 层**（SKILL.md）：带 YAML frontmatter 的 Markdown 文件，Agent Loop 构建 LLM 请求前注入 system prompt 片段，告诉模型「何时用、怎么用、边界是什么」
- **Tools 层**（TypeScript）：Node.js `fs` 操作 + Tool Use schema 声明，模型决策后由 Agent Loop 真正调用执行

**关键澄清：**
- anthropics/skills 的 PDF/Excel Skill 依赖 Anthropic 服务端沙盒，不可直接在 Desktop-Claw 使用
- OpenClaw 的 Skills 同样是纯 system prompt 注入，真正干活的是 TypeScript Tools 层
- Desktop-Claw 必须自己实现 `read/write/edit` 的 Node.js 代码，Skills 层是说明书，Tools 层是执行器

**演进路径：** Milestone A 内置 FileSkill → Milestone C 接入 MCP Client → Milestone D 用户自定义 Skills

**影响文档：** ARCHITECTURE.md v0.2（§4.3 / §5 / §13 / §15 已更新），PLAN.md A.6 任务项已更新

---

### 2026-03-18｜Milestone 0 · 脚手架搭建完成

**完成内容：**
- 初始化 pnpm monorepo，创建完整目录骨架（`apps/desktop` + `packages/backend` + `packages/shared`）
- 配置 TypeScript 多包体系：根 `tsconfig.base.json` + 各包独立 tsconfig，typecheck 全部 0 报错
- 跑通 Electron 主进程 + React 渲染进程（Hello World 窗口可正常显示）
- 跑通 IPC 双向通路：renderer 点击 → `contextBridge.ping()` → `ipcMain.handle` → 回传显示
- 嵌入 Fastify 后端 Service：`startBackend()` 随 Electron 主进程启动，`GET /health` 验证通过

**验证结果：**
- `pnpm dev` 启动 Electron 窗口 ✅
- IPC 通路：renderer → main → renderer 回传 ✅  
- `curl http://127.0.0.1:3721/health` → `{"status":"ok"}` ✅

**关键决策记录：**
- 构建工具选用 `electron-vite`（而非手动配置 webpack），大幅简化 main/preload/renderer 三端构建配置
- 后端包通过 pnpm `workspace:*` 协议引用，TypeScript project references 保证跨包类型安全
- Fastify 监听 `127.0.0.1`（非 `0.0.0.0`），仅本机可访问，符合安全基线

**下一步：** Milestone A.1 — 悬浮球 UI（frameless + always-on-top 双窗口架构）

---

### 2026-03-18｜Milestone 0 · 架构设计完成

**完成内容：**
- 完成产品定义文档（`PRD.md`）
- 完成技术架构文档（`ARCHITECTURE.md`）
- 确定技术栈：全 TypeScript monorepo，Electron + React 桌面端，Node.js 后端进程内嵌
- 确定 MVP 工具能力范围：仅开放 `read / write / edit`，暂不开放 `exec`
- 确定记忆模型：按天归档（day bucket），支持日历式回顾，不做多会话产品形态
- 确定通信方案：HTTPS 负责管理接口，WebSocket 负责实时流式响应与事件推送

**关键决策记录：**
- 放弃引入 FastAPI（Python），原因：桌面 App 打包分发复杂度过高，全 TypeScript 更适合独立开发者 Vibe coding 场景
- 使用最小 Command Queue（单主通道串行 + taskId 管理），而非重型多泳道调度器
- 暂不做多会话产品形态，前台单一对话流，后台保留 taskId 作为最小运行边界

**参考文档：**
- [技术架构文档](./ARCHITECTURE.md)
- [产品文档](./PRD.md)

---

<!-- 下方为模板，每次开发后复制填写 -->

<!--
### YYYY-MM-DD｜Milestone X · 简述

**完成内容：**
- 

**遇到的问题：**
- 

**关键决策记录：**
- 

**下一步：**
- 
-->
