/**
 * 统一数据目录路径管理
 *
 * 两种模式：
 * - 开发模式（pnpm dev）: 项目根目录下的 data/
 * - 生产模式（打包安装后）: ~/Library/Application Support/Desktop-Claw/
 *
 * 由 main 进程在启动 backend 时通过 initDataDir() 注入路径；
 * 若未注入（backend 单独运行），则 fallback 到开发模式路径探测。
 */
import { join } from 'path'
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs'

// ─── 单例路径 ────────────────────────────────

let _dataDir: string | null = null

/**
 * 初始化数据目录路径（由 main 进程调用一次）
 * 生产环境同时会创建必要的子目录结构并复制初始模板
 */
export function initDataDir(dir: string): void {
  _dataDir = dir
  ensureDataStructure(dir)
}

/**
 * 获取数据根目录
 * - 已初始化 → 返回注入的路径
 * - 未初始化 → 开发模式 fallback 探测
 */
export function getDataDir(): string {
  if (_dataDir) return _dataDir

  // fallback: 开发模式路径探测（兼容 backend 单独运行）
  const candidates = [
    join(__dirname, '..', '..', '..', '..', 'data'),   // from out/main or src
    join(__dirname, '..', '..', 'data'),                // from packages/backend/src
    join(process.cwd(), 'data')                         // fallback
  ]

  for (const dir of candidates) {
    if (existsSync(dir)) {
      _dataDir = dir
      return dir
    }
  }

  _dataDir = candidates[0]
  return _dataDir
}

/** 获取 persona/ 子目录 */
export function getPersonaDir(): string {
  return join(getDataDir(), 'persona')
}

/** 获取 memory/ 子目录 */
export function getMemoryDir(): string {
  return join(getDataDir(), 'memory')
}

/** 获取 config.json 路径 */
export function getConfigPath(): string {
  return join(getDataDir(), 'config.json')
}

// ─── 目录结构初始化 ──────────────────────────

/** 确保数据目录子结构存在 */
function ensureDataStructure(dir: string): void {
  const subdirs = ['persona', 'memory', 'db', 'files']
  for (const sub of subdirs) {
    const p = join(dir, sub)
    if (!existsSync(p)) {
      mkdirSync(p, { recursive: true })
    }
  }
}

/**
 * 生产环境首次启动时，将内置模板复制到用户数据目录
 * @param builtinPersonaDir extraResources 中的 persona 模板目录
 */
export function copyInitialTemplates(builtinPersonaDir: string): void {
  const targetDir = getPersonaDir()
  const templateFiles = ['SOUL.md', 'BOOTSTRAP.md']

  for (const file of templateFiles) {
    const target = join(targetDir, file)
    const source = join(builtinPersonaDir, file)
    // 只在目标不存在时复制（不覆盖用户已有数据）
    if (!existsSync(target) && existsSync(source)) {
      copyFileSync(source, target)
    }
  }

  // USER.md 和 CONTEXT.md 如果不存在，创建空模板
  ensureEmptyTemplate(join(targetDir, 'USER.md'), '# 用户画像\n\n> Claw 会在对话中逐步了解你，并更新这里的内容。\n')
  ensureEmptyTemplate(join(targetDir, 'CONTEXT.md'), '# 动态认知\n\n> 这里记录 Claw 从日常对话中内化的认知。\n')
}

function ensureEmptyTemplate(filePath: string, defaultContent: string): void {
  if (!existsSync(filePath)) {
    const { mkdirSync, writeFileSync } = require('fs')
    const dir = join(filePath, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, defaultContent, 'utf-8')
  }
}
