import { readFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'

// ─── data/ 目录解析 ──────────────────────────

/**
 * 解析 data/ 目录路径（与 llm/config.ts 保持一致的多路径 fallback）
 * electron-vite 打包后 __dirname 指向 out/main/，需要多路径候选
 */
function resolveDataDir(): string {
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'data'),   // from out/main or src
    join(__dirname, '..', '..', 'data'),                // from packages/backend/src
    join(process.cwd(), 'data')                         // fallback
  ]

  for (const dir of candidates) {
    if (existsSync(join(dir, 'persona'))) return dir
  }
  // 最后 fallback：即使 persona/ 不存在，也返回一个合理路径
  return candidates[0]
}

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

function buildBasePrompt(): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  return `## 系统信息

当前时间：${dateStr} ${timeStr}

## 回复规范

- 使用中文回复
- 简洁为主，用户没要求详细就不展开
- 涉及文件操作时，先确认路径再执行
- 不编造不确定的信息，坦诚说"不确定"

## 记忆引导

你的长期记忆存在 CONTEXT.md 中（已注入到下方）。如需回忆更早或更详细的内容，使用 recall_memory 或 search_memory 工具。如需精确还原原始对话，用 read_file 读取 data/memory/YYYY-MM-DD.json。`
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
  const dataDir = resolveDataDir()
  const personaDir = join(dataDir, 'persona')

  const parts: string[] = []

  // Layer 1: Base Prompt
  parts.push(buildBasePrompt())

  // Layer 2: SOUL.md（人格核心）
  const soul = readCached(join(personaDir, 'SOUL.md'))
  if (soul) {
    parts.push(soul)
  }

  // Layer 3: USER.md（用户画像）
  const user = readCached(join(personaDir, 'USER.md'))
  if (user && !user.startsWith('# 用户画像\n') || user.length > 150) {
    // 非空模板才注入（排除只有标题和注释的初始模板）
    parts.push(user)
  }

  // Layer 4: CONTEXT.md（动态认知）
  const context = readCached(join(personaDir, 'CONTEXT.md'))
  if (context && !context.startsWith('# 动态认知\n') || context.length > 150) {
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
  const bootstrap = readCached(join(personaDir, 'BOOTSTRAP.md'))
  if (bootstrap) {
    parts.push(bootstrap)
  }

  return parts.join('\n\n')
}
