# Desktop-Claw · Dev Log

> 一个常驻桌面的 AI 小伙伴，以悬浮球作为入口，陪伴用户完成聊天、文件处理、轻记录与学习/工作陪跑。
> 
> 本文档记录开发进度与阶段性决策，随开发持续更新。

---

## 项目状态

**当前阶段：** Milestone A（架构闭环）  
**最近更新：** 2026-03-19  
**下一个目标：** A.1 右键菜单 → A.2 WebSocket 通路

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
| Milestone A | 架构闭环（Gateway + Agent Loop + 三工具） | � 进行中 |
| Milestone B | 体验稳定（取消/超时/记忆归档） | 🔲 未开始 |
| Milestone C | 可扩展（测试基线 + 扩展位预留） | 🔲 未开始 |

---

## 开发日志

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
