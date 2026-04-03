import { readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getDataDir } from '../paths'

// ─── 文件 stat 缓存 ─────────────────────────

interface CachedFile {
  mtimeMs: number
  content: string
}

const fileCache = new Map<string, CachedFile>()

/**
 * 带 stat 缓存的文件读取
 * - 文件不存在 → 返回空字符串
 * - mtime 未变化 → 命中缓存，不读磁盘
 * - mtime 变化 → 重新读取并更新缓存
 */
function readCached(filePath: string): string {
  if (!existsSync(filePath)) return ''

  try {
    const { mtimeMs } = statSync(filePath)
    const cached = fileCache.get(filePath)

    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.content
    }

    const content = readFileSync(filePath, 'utf-8').trim()
    fileCache.set(filePath, { mtimeMs, content })
    return content
  } catch {
    return ''
  }
}

// ─── Base Prompt 模板 ────────────────────────

function buildBasePrompt(isBootstrap: boolean, dataDir: string): string {
  const home = homedir()
  const now = new Date()
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  let prompt = `## 系统信息

当前时间：${dateStr} ${timeStr}

## 关键路径

- 项目数据目录: ${dataDir}
- 用户画像: ${join(dataDir, 'persona', 'USER.md')}
- 人格核心: ${join(dataDir, 'persona', 'SOUL.md')}
- 动态认知: ${join(dataDir, 'persona', 'CONTEXT.md')}
- 记忆存储: ${join(dataDir, 'memory')}/
- 用户桌面: ${join(home, 'Desktop')}/
- 用户文档: ${join(home, 'Documents')}/
- 用户下载: ${join(home, 'Downloads')}/

> 执行文件操作时，请使用上述绝对路径，不要猜测。
> 当用户说「桌面上的文件」时，使用「用户桌面」路径拼接文件名。

## 回复规范

- 使用中文回复
- 简洁为主，用户没要求详细就不展开
- 纯文本回复，不要使用 Markdown 格式（不要用 **加粗**、# 标题、- 列表、\`代码\` 等标记），用户界面不渲染 Markdown
- 涉及文件操作时，使用上方「关键路径」中列出的绝对路径
- 不编造不确定的信息，坦诚说"不确定"`

  if (!isBootstrap) {
    prompt += `

## 记忆引导

你的长期记忆存在 CONTEXT.md 中（已注入到下方）。如需回忆更早或更详细的内容，使用 recall_memory 或 search_memory 工具。如需精确还原原始对话，用 read_file 读取 data/memory/YYYY-MM-DD.json。`
  }

  return prompt
}

// ─── 主组装函数 ──────────────────────────────

/**
 * 组装 System Prompt（5 层 / 6 层）
 *
 * 层级（越靠前优先级越高）：
 *  1. Base Prompt — 框架级固定指令（日期时间、回复规范、记忆引导语）
 *  2. SOUL.md   — 人格核心（最高优先级，锁定角色不漂移）
 *  3. USER.md   — 用户画像（称呼、背景、偏好）
 *  4. CONTEXT.md — 动态认知（内化后的跨天精华）
 *  5. Skills    — Discovery 摘要 + 已激活 Skill 行为指南（由 SkillManager 提供）
 *  6. [BOOTSTRAP.md] — 仅首次引导时存在
 *
 * @param discoveryPrompt  SkillManager.getDiscoveryPrompt() 的返回值
 * @param activeSkillPrompt SkillManager.getActiveSkillPrompt() 的返回值
 */
export function assembleSystemPrompt(
  discoveryPrompt: string,
  activeSkillPrompt: string
): string {
  const dataDir = getDataDir()
  const personaDir = join(dataDir, 'persona')

  // 提前检测 BOOTSTRAP.md 是否存在（决定是否为引导模式）
  const bootstrapPath = join(personaDir, 'BOOTSTRAP.md')
  const bootstrap = readCached(bootstrapPath)
  const isBootstrap = bootstrap.length > 0

  const parts: string[] = []

  // Layer 1: Base Prompt（引导模式下跳过记忆引导语）
  parts.push(buildBasePrompt(isBootstrap, dataDir))

  // Layer 2: SOUL.md（人格核心）
  const soul = readCached(join(personaDir, 'SOUL.md'))
  if (soul) {
    parts.push(soul)
  }

  // Layer 3: USER.md（用户画像）
  const user = readCached(join(personaDir, 'USER.md'))
  if (user && (!user.startsWith('# 用户画像\n') || user.length > 150)) {
    // 非空模板才注入（排除只有标题和注释的初始模板）
    parts.push(user)
  }

  // Layer 4: CONTEXT.md（动态认知）
  const context = readCached(join(personaDir, 'CONTEXT.md'))
  if (context && (!context.startsWith('# 动态认知\n') || context.length > 150)) {
    // 非空模板才注入
    parts.push(context)
  }

  // Layer 5: Skills Discovery + Active Skills（由 SkillManager 提供）
  if (discoveryPrompt) {
    parts.push(discoveryPrompt)
  }
  if (activeSkillPrompt) {
    parts.push(activeSkillPrompt)
  }

  // Layer 6: BOOTSTRAP.md（仅首次引导时存在，引导完成后自毁）
  if (bootstrap) {
    parts.push(bootstrap)
  }

  return parts.join('\n\n')
}
