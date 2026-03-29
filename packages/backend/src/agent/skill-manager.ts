import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ToolSchema, ToolResult, ToolDefinition } from '@desktop-claw/shared'
import { getDataDir } from '../paths'
import {
  extractFrontmatter,
  formatDiscoveryPrompt,
  formatActiveSkillsPrompt,
  collectToolSchemas,
  scanSkillSubdir,
  type LoadedSkill
} from './skill-primitives'

const execFileAsync = promisify(execFile)

/** 内置 Skill 注册配置 */
interface BuiltinSkillConfig {
  name: string
  /** 可选：进程内 Tool（纯脚本 Skill 无需此字段） */
  tools?: ToolDefinition[]
  /** 是否启动时自动激活（MVP 阶段 skill 少时使用） */
  autoActivate?: boolean
}

/**
 * 内置 Skills 注册表
 * Agent Skills 标准：Skill 的能力通过 scripts/ 目录下的脚本提供，而非进程内 Tool
 */
const BUILTIN_SKILLS: BuiltinSkillConfig[] = [
  { name: 'file', autoActivate: true },
  { name: 'memory' }
]

/**
 * 解析 skills 目录
 * - 生产模式：process.resourcesPath/skills（预编译 JS + SKILL.md）
 * - 开发模式：源码 packages/backend/src/agent/skills/
 */
function resolveSkillsDir(): string {
  const candidates: string[] = []

  // 生产环境：extraResources 打入 skills/
  const rp = (process as unknown as Record<string, unknown>).resourcesPath as string | undefined
  if (rp) {
    candidates.push(join(rp, 'skills'))
  }

  // 开发环境优先使用编译产物（.js），与生产一致
  // electron-vite dev: __dirname = apps/desktop/out/main/
  candidates.push(
    join(__dirname, '..', '..', 'resources', 'skills'),
    join(__dirname, 'skills'),
    join(process.cwd(), 'apps/desktop/resources/skills'),
    join(process.cwd(), 'packages/backend/src/agent/skills'),
    join(__dirname, '..', '..', '..', '..', 'packages/backend/src/agent/skills')
  )
  for (const dir of candidates) {
    if (existsSync(join(dir, 'file', 'SKILL.md'))) return dir
  }
  return candidates[0]
}

/** activate_skill 元工具的 schema（始终注册，让 LLM 可以激活技能） */
const ACTIVATE_SKILL_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'activate_skill',
    description: '激活一个技能，使其工具可用。在"可用技能"列表中选择需要的技能名称调用此工具，激活后即可使用该技能的所有工具。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '要激活的技能名称（来自"可用技能"列表）'
        }
      },
      required: ['name']
    }
  }
}

/** run_skill_script 元工具：执行 skill 目录下 scripts/ 中的脚本（Level 3） */
const RUN_SKILL_SCRIPT_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'run_skill_script',
    description:
      '执行指定技能目录下 scripts/ 中的脚本。脚本源码不会进入对话上下文，只返回执行结果。',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: '技能名称'
        },
        script_name: {
          type: 'string',
          description: '要执行的脚本文件名（如 read_file.ts、convert.py）'
        },
        args: {
          type: 'string',
          description: '传给脚本的参数，JSON 格式字符串（如 {"path": "/foo/bar.md"}）'
        }
      },
      required: ['skill_name', 'script_name']
    }
  }
}

/** read_skill_reference 元工具：读取 skill 目录下 references/ 中的参考文档（Level 3） */
const READ_SKILL_REFERENCE_SCHEMA: ToolSchema = {
  type: 'function',
  function: {
    name: 'read_skill_reference',
    description:
      '读取指定技能目录下 references/ 中的参考文档，获取更详细的补充信息。',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: '技能名称'
        },
        filename: {
          type: 'string',
          description: '要读取的参考文档文件名（如 advanced-usage.md）'
        }
      },
      required: ['skill_name', 'filename']
    }
  }
}

/**
 * SkillManager — Skill 体系运行时核心（Agent Skills 渐进式披露架构）
 *
 * 生命周期：发现（Discovery）→ 激活（Activation）→ 执行（Execution）
 *
 * - Discovery 阶段：load() 读取所有 SKILL.md，只暴露 name + description 摘要
 * - Activation 阶段：activateSkill() 将完整 guide + tools 暴露给 LLM
 * - Execution 阶段：executeTool() 执行已激活 skill 的 tools
 */
export class SkillManager {
  /** 所有已发现的 skills（含完整数据，但未激活的不暴露给 LLM） */
  private skills: LoadedSkill[] = []
  /** tool name → ToolDefinition 快速查找（仅含已激活 skill 的 tools） */
  private toolMap = new Map<string, ToolDefinition>()
  private loaded = false

  /**
   * 发现所有内置 Skill：读取 SKILL.md 元数据 + 关联静态 tools
   * 标记 autoActivate 的 skill 直接激活
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
        tools: config.tools ?? [],
        active: false,
        skillDir: join(skillsDir, config.name),
        scripts: scanSkillSubdir(join(skillsDir, config.name), 'scripts'),
        references: scanSkillSubdir(join(skillsDir, config.name), 'references')
      })
    }

    // 自动激活标记了 autoActivate 的 skills
    for (const config of BUILTIN_SKILLS) {
      if (config.autoActivate) {
        this.activateSkill(config.name)
      }
    }

    this.loaded = true

    const activeCount = this.skills.filter((s) => s.active).length
    const scriptCount = this.skills.reduce((n, s) => n + s.scripts.length, 0)
    console.log(
      `[skill-manager] discovered ${this.skills.length} skill(s), ` +
        `auto-activated ${activeCount}, ${scriptCount} script(s), ${this.toolMap.size} in-process tool(s)`
    )
  }

  /**
   * 激活指定 skill：将其 tools 注册到 toolMap，标记为 active
   * 激活后 getActiveSkillPrompt() 会包含其完整 guide
   * 激活后 getActiveToolSchemas() 会包含其 tool schemas
   */
  activateSkill(name: string): ToolResult {
    const skill = this.skills.find((s) => s.name === name)
    if (!skill) {
      return { success: false, content: '', error: `未知的技能: ${name}` }
    }

    if (skill.active) {
      return { success: true, content: `技能 "${name}" 已经是激活状态，可直接使用其工具。` }
    }

    // 激活：注册进程内 tools（如果有）
    skill.active = true
    for (const tool of skill.tools) {
      const toolName = tool.schema.function.name
      if (this.toolMap.has(toolName)) {
        console.warn(`[skill-manager] duplicate tool name: ${toolName}`)
      }
      this.toolMap.set(toolName, tool)
    }

    const toolNames = skill.tools.map((t) => t.schema.function.name)
    const allCapabilities = [...toolNames]
    console.log(`[skill-manager] activated skill "${name}"`)

    let content = `技能 "${name}" 已激活。`
    if (skill.scripts.length > 0) {
      content += `\n可用脚本（通过 run_skill_script 执行）：${skill.scripts.join(', ')}`
    }
    if (skill.references.length > 0) {
      content += `\n参考文档（通过 read_skill_reference 读取）：${skill.references.join(', ')}`
    }
    if (toolNames.length > 0) {
      content += `\n工具：${toolNames.join(', ')}`
    }
    return { success: true, content }
  }

  /** Discovery 摘要：未激活 skill 的 name + description 列表 */
  getDiscoveryPrompt(): string {
    if (!this.loaded) return ''
    return formatDiscoveryPrompt(this.skills)
  }

  /** 已激活 skill 的完整行为指南 */
  getActiveSkillPrompt(): string {
    if (!this.loaded) return ''
    return formatActiveSkillsPrompt(this.skills)
  }

  /**
   * 收集可用的 ToolSchema[]（传给 LLM 的 tools 参数）
   * = activate_skill 元工具（存在未激活 skill 时）+ 已激活 skill 的 tools
   */
  getActiveToolSchemas(): ToolSchema[] {
    if (!this.loaded) return []

    const schemas: ToolSchema[] = []

    // 如果有未激活的 skill，注册 activate_skill 元工具
    const hasInactive = this.skills.some((s) => !s.active)
    if (hasInactive) {
      schemas.push(ACTIVATE_SKILL_SCHEMA)
    }

    // 已激活 skill 的 tool schemas
    const activeSkills = this.skills.filter((s) => s.active)
    schemas.push(...collectToolSchemas(activeSkills))

    // Level 3: 如果已激活 skill 有 scripts，注册 run_skill_script
    if (activeSkills.some((s) => s.scripts.length > 0)) {
      schemas.push(RUN_SKILL_SCRIPT_SCHEMA)
    }
    // Level 3: 如果已激活 skill 有 references，注册 read_skill_reference
    if (activeSkills.some((s) => s.references.length > 0)) {
      schemas.push(READ_SKILL_REFERENCE_SCHEMA)
    }

    return schemas
  }

  /** 根据 tool name 执行对应的 tool（含 activate_skill 元工具） */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // 元工具：activate_skill
    if (name === 'activate_skill') {
      const skillName = args.name as string
      if (!skillName) {
        return { success: false, content: '', error: '缺少 name 参数' }
      }
      console.log(`[skill-manager] activate_skill called: ${skillName}`)
      return this.activateSkill(skillName)
    }

    // 元工具：run_skill_script（Level 3 脚本执行）
    if (name === 'run_skill_script') {
      return this.runSkillScript(args)
    }

    // 元工具：read_skill_reference（Level 3 参考文档读取）
    if (name === 'read_skill_reference') {
      return this.readSkillReference(args)
    }

    const tool = this.toolMap.get(name)
    if (!tool) {
      return { success: false, content: '', error: `未知的工具: ${name}（该工具的技能可能未激活）` }
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

  /** 是否有可用的 tools（已激活的） */
  hasTools(): boolean {
    return this.toolMap.size > 0
  }

  // ─── Level 3: 脚本执行与参考文档读取 ─────

  /** 安全校验文件名：禁止路径穿越 */
  private isValidFilename(name: string): boolean {
    return (
      name.length > 0 &&
      !name.includes('..') &&
      !name.includes('/') &&
      !name.includes('\\') &&
      !name.startsWith('.')
    )
  }

  /** 根据脚本扩展名确定解释器，免去用户手动设置 shebang + 可执行权限 */
  private getScriptInterpreter(scriptPath: string): { cmd: string; prefixArgs: string[] } {
    const ext = scriptPath.split('.').pop()?.toLowerCase()
    switch (ext) {
      case 'sh':
      case 'bash':
        return process.platform === 'win32'
          ? { cmd: 'cmd.exe', prefixArgs: ['/c', scriptPath] }
          : { cmd: '/bin/bash', prefixArgs: [scriptPath] }
      case 'py':
        return {
          cmd: process.platform === 'win32' ? 'python' : 'python3',
          prefixArgs: [scriptPath]
        }
      case 'js':
      case 'mjs':
        // 使用 process.execPath 确保在 Electron 打包环境中可用（自带 Node 运行时）
        return { cmd: process.execPath, prefixArgs: [scriptPath] }
      case 'ts':
        return { cmd: 'npx', prefixArgs: ['tsx', scriptPath] }
      default:
        // 假定脚本有 shebang 且已设置可执行权限
        return { cmd: scriptPath, prefixArgs: [] }
    }
  }

  /** 执行 skill 目录下 scripts/ 中的脚本 */
  private async runSkillScript(args: Record<string, unknown>): Promise<ToolResult> {
    const skillName = args.skill_name as string
    const scriptName = args.script_name as string

    if (!skillName || !scriptName) {
      return { success: false, content: '', error: '缺少 skill_name 或 script_name 参数' }
    }

    if (!this.isValidFilename(scriptName)) {
      return { success: false, content: '', error: '无效的脚本文件名（不允许路径穿越）' }
    }

    const skill = this.skills.find((s) => s.name === skillName && s.active)
    if (!skill) {
      return { success: false, content: '', error: `技能 "${skillName}" 未找到或未激活` }
    }

    // 支持 .ts → .js 自动降级：LLM 可能请求 write_file.ts，但编译后只有 .js
    let resolvedScriptName = scriptName
    if (!skill.scripts.includes(scriptName) && scriptName.endsWith('.ts')) {
      const jsFallback = scriptName.replace(/\.ts$/, '.js')
      if (skill.scripts.includes(jsFallback)) {
        resolvedScriptName = jsFallback
      }
    }

    if (!skill.scripts.includes(resolvedScriptName)) {
      return {
        success: false,
        content: '',
        error: `技能 "${skillName}" 中不存在脚本 "${scriptName}"。可用脚本：${skill.scripts.join(', ') || '无'}`
      }
    }

    const scriptPath = join(skill.skillDir, 'scripts', resolvedScriptName)
    const argsStr = (args.args as string) || '{}'
    console.log(`[skill-manager] run_skill_script: ${scriptPath}`)

    try {
      const { cmd, prefixArgs } = this.getScriptInterpreter(scriptPath)

      // 将 JSON 参数作为单个 CLI 参数传给脚本
      const { stdout, stderr } = await execFileAsync(cmd, [...prefixArgs, argsStr], {
        cwd: skill.skillDir,
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          SKILL_DIR: skill.skillDir,
          DATA_DIR: getDataDir(),
          // 让 Electron 打包后的 process.execPath 以纯 Node.js 模式运行脚本
          ELECTRON_RUN_AS_NODE: '1'
        }
      })

      // 尝试解析 stdout 为 JSON 结构化结果
      try {
        const result = JSON.parse(stdout.trim())
        return {
          success: result.success ?? true,
          content: result.content ?? stdout,
          error: result.error
        }
      } catch {
        // 脚本输出非 JSON，直接返回原始输出
        let output = stdout
        if (stderr) output += (output ? '\n[stderr]\n' : '[stderr]\n') + stderr
        return { success: true, content: output || '（脚本执行完成，无输出）' }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[skill-manager] script execution failed:`, message)
      return { success: false, content: '', error: `脚本执行失败: ${message}` }
    }
  }

  /** 读取 skill 目录下 references/ 中的参考文档 */
  private readSkillReference(args: Record<string, unknown>): ToolResult {
    const skillName = args.skill_name as string
    const filename = args.filename as string

    if (!skillName || !filename) {
      return { success: false, content: '', error: '缺少 skill_name 或 filename 参数' }
    }

    if (!this.isValidFilename(filename)) {
      return { success: false, content: '', error: '无效的文件名（不允许路径穿越）' }
    }

    const skill = this.skills.find((s) => s.name === skillName && s.active)
    if (!skill) {
      return { success: false, content: '', error: `技能 "${skillName}" 未找到或未激活` }
    }

    if (!skill.references.includes(filename)) {
      return {
        success: false,
        content: '',
        error: `技能 "${skillName}" 中不存在参考文档 "${filename}"。可用文档：${skill.references.join(', ') || '无'}`
      }
    }

    const filePath = join(skill.skillDir, 'references', filename)

    try {
      const content = readFileSync(filePath, 'utf-8')
      console.log(`[skill-manager] read_skill_reference: ${filePath} (${content.length} chars)`)
      return { success: true, content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, content: '', error: `读取参考文档失败: ${message}` }
    }
  }
}
