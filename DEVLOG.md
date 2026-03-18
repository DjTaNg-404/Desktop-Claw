# Desktop-Claw · Dev Log

> 一个常驻桌面的 AI 小伙伴，以悬浮球作为入口，陪伴用户完成聊天、文件处理、轻记录与学习/工作陪跑。
> 
> 本文档记录开发进度与阶段性决策，随开发持续更新。

---

## 项目状态

**当前阶段：** Milestone A（架构闭环）  
**最近更新：** 2026-03-18  
**下一个目标：** 完成悬浮球 UI + WebSocket 通路（Milestone A.1 / A.2）

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
| Milestone A | 架构闭环（Gateway + Agent Loop + 三工具） | 🔲 未开始 |
| Milestone B | 体验稳定（取消/超时/记忆归档） | 🔲 未开始 |
| Milestone C | 可扩展（测试基线 + 扩展位预留） | 🔲 未开始 |

---

## 开发日志

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
