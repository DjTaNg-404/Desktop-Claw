import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, basename } from 'path'
import type { ToolDefinition, ToolSchema } from '@desktop-claw/shared'

// ─── 类型 ──────────────────────────────────────

export interface SkillMeta {
  name: string
  description: string
}

export interface LoadedSkill {
  /** Skill 唯一 ID（文件夹名） */
  name: string
  /** YAML frontmatter 元数据 */
  meta: SkillMeta
  /** SKILL.md 正文（激活后注入 system prompt） */
  guide: string
  /** 该 Skill 下的所有 Tool 定义 */
  tools: ToolDefinition[]
  /** 是否已激活（激活后 guide + tools 才暴露给 LLM） */
  active: boolean
  /** Skill 目录绝对路径（用于定位 scripts/ 和 references/） */
  skillDir: string
  /** scripts/ 目录下的可执行脚本文件名（Level 3） */
  scripts: string[]
  /** references/ 目录下的参考文档文件名（Level 3） */
  references: string[]
}

// ─── YAML Frontmatter 解析 ────────────────────

/**
 * 从 SKILL.md 内容提取 YAML frontmatter 和正文
 * 简易解析：只处理 name 和 description 字段
 */
export function extractFrontmatter(content: string): { meta: SkillMeta; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    return {
      meta: { name: '', description: '' },
      body: content
    }
  }

  const yaml = match[1]
  const body = match[2]

  // 简易 YAML 解析（不引入 yaml 依赖）
  let name = ''
  let description = ''

  const nameMatch = yaml.match(/^name:\s*(.+)$/m)
  if (nameMatch) {
    name = nameMatch[1].trim()
  }

  // description 可能是多行（使用 > 折叠写法）
  const descMatch = yaml.match(/^description:\s*>?\s*\n?([\s\S]*?)(?=\n[a-zA-Z]|\n---|\s*$)/m)
  if (descMatch) {
    description = descMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
  } else {
    // 单行 description
    const singleMatch = yaml.match(/^description:\s*(.+)$/m)
    if (singleMatch) {
      description = singleMatch[1].trim()
    }
  }

  return { meta: { name, description }, body: body.trim() }
}

// ─── Skill 目录扫描 ───────────────────────────

/**
 * 扫描指定目录下所有 Skill 文件夹，加载元数据、正文和 tools
 * 每个子文件夹必须包含 SKILL.md 才被视为有效 Skill
 */
export async function loadSkillsFromDir(skillsDir: string): Promise<LoadedSkill[]> {
  if (!existsSync(skillsDir)) return []

  const entries = readdirSync(skillsDir)
  const skills: LoadedSkill[] = []

  for (const entry of entries) {
    const skillPath = join(skillsDir, entry)

    // 只处理目录
    if (!statSync(skillPath).isDirectory()) continue

    const skillMdPath = join(skillPath, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue

    // 读取 SKILL.md
    const raw = readFileSync(skillMdPath, 'utf-8')
    const { meta, body } = extractFrontmatter(raw)

    // 如果 name 为空，使用文件夹名
    if (!meta.name) meta.name = basename(skillPath)

    // 加载 tool .ts 文件
    const tools = await loadToolsFromSkillDir(skillPath)

    // Level 3: 扫描 scripts/ 和 references/ 子目录
    const scripts = scanSkillSubdir(skillPath, 'scripts')
    const references = scanSkillSubdir(skillPath, 'references')

    skills.push({
      name: meta.name,
      meta,
      guide: body,
      tools,
      active: false,
      skillDir: skillPath,
      scripts,
      references
    })
  }

  return skills
}

/**
 * 从 Skill 目录加载所有 tool 定义
 * 约定：.ts 文件中导出的 ToolDefinition 对象
 */
async function loadToolsFromSkillDir(skillDir: string): Promise<ToolDefinition[]> {
  const entries = readdirSync(skillDir)
  const tools: ToolDefinition[] = []

  for (const file of entries) {
    // 跳过非 .ts/.js 文件和 SKILL.md、path-security 等辅助文件
    if (file === 'SKILL.md' || file === 'path-security.ts' || file === 'path-security.js') continue
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue

    const fullPath = join(skillDir, file)

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(fullPath)

      // 扫描所有导出，找 ToolDefinition 形状的对象
      for (const key of Object.keys(mod)) {
        const val = mod[key]
        if (isToolDefinition(val)) {
          tools.push(val)
        }
      }
    } catch (err) {
      console.warn(`[skill-primitives] failed to load tool from ${fullPath}:`, err)
    }
  }

  return tools
}

function isToolDefinition(val: unknown): val is ToolDefinition {
  if (!val || typeof val !== 'object') return false
  const obj = val as Record<string, unknown>
  return (
    typeof obj.schema === 'object' &&
    obj.schema !== null &&
    typeof obj.execute === 'function'
  )
}

// ─── Level 3: 子目录扫描（scripts/ & references/）────

/**
 * 扫描 Skill 目录下的子目录，返回其中的文件名列表
 * 用于获取 scripts/ 和 references/ 中的文件
 */
export function scanSkillSubdir(skillDir: string, subdir: string): string[] {
  const dir = join(skillDir, subdir)
  if (!existsSync(dir)) return []
  try {
    if (!statSync(dir).isDirectory()) return []
  } catch {
    return []
  }
  return readdirSync(dir).filter((f) => {
    try {
      return !statSync(join(dir, f)).isDirectory()
    } catch {
      return false
    }
  })
}

// ─── System Prompt 格式化 ─────────────────────

/**
 * Discovery 阶段：仅输出每个 Skill 的 name + description 摘要
 * 用于注入 System Prompt，让 LLM 知道有哪些技能可激活
 * 每个 skill 约 30-50 tokens，远小于完整 SKILL.md
 */
export function formatDiscoveryPrompt(skills: LoadedSkill[]): string {
  const inactive = skills.filter((s) => !s.active && s.meta.description)
  if (inactive.length === 0) return ''

  const lines = inactive.map((s) => `- **${s.meta.name}**: ${s.meta.description}`)
  return `\n## 可用技能（使用 activate_skill 工具激活后即可使用）\n\n${lines.join('\n')}`
}

/**
 * Activation 阶段：输出已激活 Skill 的完整行为指南
 * 以 XML-like 标签包裹每个 Skill 的 SKILL.md 正文
 */
export function formatActiveSkillsPrompt(skills: LoadedSkill[]): string {
  const active = skills.filter((s) => s.active && s.guide)
  if (active.length === 0) return ''

  const sections = active.map((s) => {
    let content = s.guide

    // Level 3: 列出可用脚本
    if (s.scripts.length > 0) {
      content += '\n\n### 可用脚本\n\n使用 `run_skill_script` 工具执行以下脚本（脚本源码不会进入对话，只返回执行结果）：\n'
      content += s.scripts.map((sc) => `- \`${sc}\``).join('\n')
    }

    // Level 3: 列出参考文档
    if (s.references.length > 0) {
      content += '\n\n### 参考文档\n\n需要更详细信息时，使用 `read_skill_reference` 工具读取：\n'
      content += s.references.map((r) => `- \`${r}\``).join('\n')
    }

    return `<skill name="${s.name}">\n${content}\n</skill>`
  })
  return `\n## 已激活技能\n\n${sections.join('\n\n')}`
}

/**
 * 将已加载的 Skills 格式化为 system prompt 片段（兼容旧接口，全量输出）
 * @deprecated 迁移到 formatDiscoveryPrompt + formatActiveSkillsPrompt
 */
export function formatSkillsForPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return ''

  const sections = skills
    .filter((s) => s.guide)
    .map((s) => `<skill name="${s.name}">\n${s.guide}\n</skill>`)

  if (sections.length === 0) return ''

  return `\n## 可用技能\n\n${sections.join('\n\n')}`
}

/**
 * 收集所有 Skill 的 ToolSchema[]（传给 LLM 的 tools 参数）
 */
export function collectToolSchemas(skills: LoadedSkill[]): ToolSchema[] {
  return skills.flatMap((s) => s.tools.map((t) => t.schema))
}
