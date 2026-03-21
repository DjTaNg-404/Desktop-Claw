import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import type { ToolSchema, ToolResult, ToolDefinition } from '@desktop-claw/shared'
import {
  extractFrontmatter,
  formatSkillsForPrompt,
  collectToolSchemas,
  type LoadedSkill
} from './skill-primitives'

// 静态导入内置 tools（electron-vite 打包时能正确跟踪）
import { readFileTool } from './skills/file/read_file'
import { writeFileTool } from './skills/file/write_file'
import { editFileTool } from './skills/file/edit_file'

/** 内置 Skill 注册配置 */
interface BuiltinSkillConfig {
  name: string
  tools: ToolDefinition[]
}

/** 内置 Skills 注册表 — 新增 Skill 时在此添加一行 */
const BUILTIN_SKILLS: BuiltinSkillConfig[] = [
  { name: 'file', tools: [readFileTool, writeFileTool, editFileTool] }
]

/**
 * 解析 skills 源码目录（SKILL.md 所在位置）
 * electron-vite 打包后 __dirname 指向 out/main/，需要多路径 fallback
 */
function resolveSkillsDir(): string {
  const candidates = [
    join(__dirname, 'skills'),
    join(process.cwd(), 'packages/backend/src/agent/skills')
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, 'file', 'SKILL.md'))) return dir
  }
  return candidates[0]
}

/**
 * SkillManager — Skill 体系运行时核心
 *
 * 负责：发现 → 加载 → 格式化 → 执行
 */
export class SkillManager {
  private skills: LoadedSkill[] = []
  /** tool name → ToolDefinition 快速查找 */
  private toolMap = new Map<string, ToolDefinition>()
  private loaded = false

  /**
   * 加载所有内置 Skill 的 SKILL.md + 静态注册的 tools
   * tools 通过静态 import 注册（electron-vite 打包安全）
   * SKILL.md 在运行时从文件系统读取（多路径 fallback）
   */
  async load(): Promise<void> {
    const skillsDir = resolveSkillsDir()

    for (const config of BUILTIN_SKILLS) {
      const skillMdPath = join(skillsDir, config.name, 'SKILL.md')
      let guide = ''
      let meta = { name: config.name, description: '' }

      if (existsSync(skillMdPath)) {
        const raw = readFileSync(skillMdPath, 'utf-8')
        const parsed = extractFrontmatter(raw)
        if (parsed.meta.name) meta = parsed.meta
        guide = parsed.body
      } else {
        console.warn(`[skill-manager] SKILL.md not found: ${skillMdPath}`)
      }

      this.skills.push({
        name: config.name,
        meta,
        guide,
        tools: config.tools
      })
    }

    // 构建 tool 查找表
    this.toolMap.clear()
    for (const skill of this.skills) {
      for (const tool of skill.tools) {
        const name = tool.schema.function.name
        if (this.toolMap.has(name)) {
          console.warn(`[skill-manager] duplicate tool name: ${name}`)
        }
        this.toolMap.set(name, tool)
      }
    }

    this.loaded = true
    console.log(
      `[skill-manager] loaded ${this.skills.length} skill(s), ${this.toolMap.size} tool(s)`
    )
  }

  /** 将已激活 Skill 的行为指南格式化为 system prompt 片段 */
  getSkillPrompt(): string {
    if (!this.loaded) return ''
    return formatSkillsForPrompt(this.skills)
  }

  /** 收集所有 ToolSchema[]（传给 LLM 的 tools 参数） */
  getToolSchemas(): ToolSchema[] {
    if (!this.loaded) return []
    return collectToolSchemas(this.skills)
  }

  /** 根据 tool name 执行对应的 tool */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.toolMap.get(name)
    if (!tool) {
      return { success: false, content: '', error: `未知的工具: ${name}` }
    }

    console.log(`[skill-manager] executing tool: ${name}`, JSON.stringify(args).slice(0, 200))

    try {
      const result = await tool.execute(args)
      console.log(`[skill-manager] tool ${name} ${result.success ? 'succeeded' : 'failed'}`)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[skill-manager] tool ${name} threw:`, message)
      return { success: false, content: '', error: `工具执行异常: ${message}` }
    }
  }

  /** 是否有已加载的 tools */
  hasTools(): boolean {
    return this.toolMap.size > 0
  }
}
