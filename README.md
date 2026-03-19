<div align="center">

# Desktop-Claw

**一个常驻桌面的 AI 小伙伴**

以悬浮球作为最小入口，陪你聊天、处理文件、做轻记录，也陪你学习和工作。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-in%20development-yellow.svg)]()
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-latest-47848f.svg)](https://www.electronjs.org/)

[提交 Issue](https://github.com/DjTaNg-404/Desktop-Claw/issues)

</div>

---

## 这是什么

大多数 AI 产品还停留在"打开一个网页，向它提问"的范式里。  
Desktop-Claw 想探索另一种方式：

> 不是把 AI 放进桌面壳子里，而是让 AI **真正成为桌面上的一个常驻伙伴**。

它不是全知全能的超级 Agent，也不只是一个卖萌的桌宠。  
它是一个小而稳定的桌面 AI Companion，做少、做轻、做有用。

---

## 功能预览

> 🚧 项目正在开发中，以下为规划中的 MVP 能力

<!-- TODO: 补充截图或 GIF -->

- **●  悬浮球常驻桌面** — 随时唤起，不占 Dock
- **💬  自然对话** — 承接上下文，流式响应
- **📄  文件拖拽** — 自动摘要与提炼
- **📝  轻记录与待办** — 随手就能发生
- **🗓️  按天归档记忆** — 日历式回顾

---

## 特性

- **常驻桌面** — 悬浮球形态，不占用 Dock 和任务栏，始终在视野边缘待命
- **实时流式响应** — 回答边生成边显示，不等待
- **文件拖拽处理** — 拖上去就能总结、提炼重点、给出建议
- **按天记忆** — 每天的对话自动归档，用日历视图回顾历史
- **连续感** — 重启后仍记得今天说过什么，不是每次都从零开始
- **轻量无打扰** — 不主动推送，不占资源，常驻但不烦人

---

## 技术架构

```
Desktop UI (悬浮球 + 对话面板)
        │
        │  HTTPS + WebSocket
        ▼
   Gateway (入口层)
        │
        ▼
Task Coordinator (最小任务队列)
        │
        ▼
  Agent Loop (ReAct-like)
        │
   ┌────┼────┐
   ▼    ▼    ▼
 read write edit     ← MVP 原子工具
 
Memory Service (按天归档)
```

**技术栈：** Electron · React · TypeScript · Node.js · Fastify · SQLite · OpenAI API

---

## 快速开始

> ⚠️ 项目尚在开发阶段，以下安装步骤将在 Milestone A 完成后更新

### 前置要求

- Node.js 20+
- macOS 13+

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/DjTaNg-404/Desktop-Claw.git
cd Desktop-Claw

# 安装依赖
pnpm install

# 配置环境变量
# 在项目根目录创建 .env 文件，填写你的 LLM API Key
# OPENAI_API_KEY=sk-xxx

# 启动开发模式
pnpm dev
```

---

## 开发进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| Milestone 0 | 架构设计与技术选型 | ✅ 完成 |
| Milestone A | 架构闭环：桌面入口 + Agent Loop + 基础工具 | � 进行中 |
| Milestone B | 体验稳定：记忆归档 + 断线重连 + 取消与超时 | 🔲 未开始 |
| Milestone C | 可扩展：测试基线 + 扩展位预留 | 🔲 未开始 |

---

## 为什么叫 Claw

Claw（爪子）是一种有趣的存在感——轻轻搭在你桌面的边缘，随时在，不打扰，但你知道它在。

这个名字来自 [OpenClaw](https://github.com/nicepkg/openclaw) 项目的技术理念，Desktop-Claw 借鉴了其 Agent 架构思想，并将其裁剪为适合桌面 Companion 的最小可用形态。

---

## 设计原则

1. **Companion-first** — 先做有陪伴感的伙伴，再做能力强大的工具
2. **轻执行优先** — 高频、轻量、低风险的任务；不做高风险系统控制
3. **常驻但不打扰** — 有存在感，但不主动推送、不占注意力
4. **先成立，再成长** — MVP 先让体验成立，后续再演化为桌宠形态

---

## 贡献

欢迎 Issues 和 Discussions！

目前项目处于早期阶段，如果你对桌面 AI Companion 这个方向有想法，欢迎：

- 提交 [Issue](https://github.com/DjTaNg-404/Desktop-Claw/issues) 描述你希望看到的功能
- 在 [Discussions](https://github.com/DjTaNg-404/Desktop-Claw/discussions) 讨论产品方向
- 等 Milestone A 完成后，欢迎提交 PR

---

## License

[MIT](LICENSE)

---

<div align="center">

**Build in Public · Made with ❤️ by a solo developer**

如果你也对"桌面 AI 陪伴"这个方向感兴趣，欢迎 Star ⭐

</div>
