<div align="center">

# Desktop-Claw

**一个常驻桌面的 AI 小伙伴**

以悬浮球作为最小入口，陪你聊天、处理文件、做轻记录，也陪你学习和工作。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-Milestone%20C%20Done-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-latest-47848f.svg)](https://www.electronjs.org/)

[下载最新版本](https://github.com/DjTaNg-404/Desktop-Claw/releases/latest) · [提交 Issue](https://github.com/DjTaNg-404/Desktop-Claw/issues)

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

> 🚧 项目正在积极开发中，已完成 Milestone A–C

- **●  悬浮球常驻桌面** — 随时唤起，不占 Dock ✅
- **💬  自然对话** — 承接上下文，流式响应 ✅
- **📄  文件读写与编辑** — 读取、创建、修改本地文件 ✅
- **🧠  稳定人格** — SOUL.md 定义人格，重启后风格一致 ✅
- **🐾  首次引导** — "互相认识"仪式，Claw 记住你的称呼和偏好 ✅
- **🗓️  按天归档记忆** — 对话自动落盘，日历视图回顾历史 ✅
- **💭  记忆检索** — Claw 能回忆过去的对话，跨天不失忆 ✅
- **⚡  Agent 状态提示** — 思考中、回忆中、读取文件中... 实时可见 ✅
- **📝  轻记录与待办** — 随手就能发生（规划中）

---

## 特性

- **跨平台** — 支持 macOS 和 Windows，GitHub Actions 自动构建双平台安装包
- **常驻桌面** — 悬浮球形态，不占用 Dock 和任务栏，始终在视野边缘待命
- **实时流式响应** — 回答边生成边显示，不等待
- **稳定人格** — 由 SOUL.md 定义角色性格，不漂移、不走样，重启后还是同一个 Claw
- **按天记忆** — 每天的对话自动归档为 JSON，重启不失忆，用日历视图回顾历史
- **每日内化** — 每天对话结束后 Claw 自主更新动态认知（CONTEXT.md），认识你越来越深
- **记忆检索** — Claw 能按日期回忆、按关键词搜索过去的对话
- **首次引导** — 第一次见面有"互相认识"仪式，你可以塑造 Claw 的性格倾向
- **文件操作** — 读取桌面/文档/下载目录的文件，支持 .pdf / .docx / .xlsx 文本提取
- **Agent 技能体系** — 三级渐进式披露，按需激活能力，不浪费 token
- **断线恢复** — WS 断连自动重连，流式中断不挂死，关机前自动归档
- **连续感** — 第一人称日记 + 情绪状态机 + 关机归档，不是工具，是伙伴
- **轻量无打扰** — 不主动推送，不占资源，常驻但不烦人

---

## 技术架构

```
Desktop UI (悬浮球 + 对话面板 + 日历视图)
        │
        │  WebSocket + HTTP
        ▼
   Gateway (入口层)
        │
        ▼
Task Coordinator (FIFO 任务队列)
        │
        ▼
  Agent Loop (ReAct 循环)
        │
   ┌────┼────────┐
   ▼    ▼        ▼
 File  Memory   ...未来扩展
Skill  Skill
        │
        ▼
Prompt Assembler (5 层 System Prompt 组装)
  │  SOUL.md · USER.md · CONTEXT.md
  │
  ▼
Memory Service (按天 JSON 归档 + 每日内化)
```

**技术栈：** Electron · React · TypeScript · Node.js · Fastify · OpenAI 兼容 API

---

## 快速开始

### 直接下载（推荐）

前往 [Releases](https://github.com/DjTaNg-404/Desktop-Claw/releases/latest) 下载对应平台的安装包：

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS (Apple Silicon) | `.dmg` | 双击打开，拖入 Applications |
| macOS (Apple Silicon) | `.zip` | 解压即用 |
| Windows (x64) | `.exe` | Portable 免安装版，双击直接运行 |

**macOS 安装：**
1. 下载 `.dmg` 文件，双击打开，拖入 Applications
2. 首次打开需在「系统设置 → 隐私与安全性」中点"仍要打开"（未签名应用）
3. 右键悬浮球 → 设置，填写 LLM API Key

**Windows 安装：**
1. 下载 `.exe` 文件，双击直接运行（免安装）
2. 右键悬浮球 → 设置，填写 LLM API Key

> 需要一个支持 Function Calling 的 LLM API Key（推荐 DeepSeek）。

### 从源码构建

前置要求：Node.js 20+ / pnpm 9+

```bash
# 克隆仓库
git clone https://github.com/DjTaNg-404/Desktop-Claw.git
cd Desktop-Claw

# 安装依赖
pnpm install

# 启动开发模式
pnpm dev
```

首次启动后，右键悬浮球 → 设置，填写 LLM 配置（API Key、Base URL、Model）。配置保存在 `data/config.json`。

### 打包分发

```bash
# macOS
pnpm run package:mac

# Windows
pnpm run package:win
```

产物位于 `apps/desktop/release/`。推送 `v*` tag 时 GitHub Actions 会自动构建双平台并发布到 Release。

安装后数据存储位置：
- macOS: `~/Library/Application Support/Desktop-Claw/data/`
- Windows: `%APPDATA%/Desktop-Claw/data/`

---

## 开发进度

| 阶段 | 内容 | 状态 |
|------|------|------|
| Milestone 0 | 架构设计与技术选型 | ✅ 完成 |
| Milestone A | 架构闭环：桌面入口 + Agent Loop + 基础工具 | ✅ 完成 |
| Milestone B | 体验稳定：人格体系 + 记忆归档 + 断线重连 + 日历视图 | ✅ 完成 |
| Milestone C | 发布就绪：打包分发 + 数据路径适配 + 体验修复 + 测试基线 | ✅ 完成 |

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
- 欢迎提交 PR

---

## License

[MIT](LICENSE)

---

<div align="center">

**Build in Public · Made with ❤️ by a solo developer**

如果你也对"桌面 AI 陪伴"这个方向感兴趣，欢迎 Star ⭐

</div>
