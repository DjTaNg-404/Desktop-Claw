import { resolve, normalize, relative, isAbsolute } from 'path'
import { realpathSync } from 'fs'
import { homedir } from 'os'

/** 敏感路径前缀（绝对禁止访问） */
const SENSITIVE_PREFIXES = [
  resolve(homedir(), '.ssh'),
  resolve(homedir(), '.gnupg'),
  resolve(homedir(), '.aws'),
  '/etc',
  '/var',
  '/usr',
  '/System',
  '/private'
]

/**
 * 校验路径是否在允许的根目录内，阻止路径穿越和敏感路径访问。
 *
 * @param targetPath 用户请求访问的路径
 * @param allowedRoots 允许的根目录列表
 * @returns { valid, resolved, error }
 */
export function validatePath(
  targetPath: string,
  allowedRoots: string[]
): { valid: boolean; resolved: string; error?: string } {
  // 1. 解析为绝对路径并规范化
  const resolved = normalize(resolve(targetPath))

  // 2. 检查敏感路径
  for (const prefix of SENSITIVE_PREFIXES) {
    if (resolved.startsWith(prefix + '/') || resolved === prefix) {
      return { valid: false, resolved, error: `禁止访问敏感路径: ${prefix}` }
    }
  }

  // 3. 检查是否在 allowedRoots 内
  if (allowedRoots.length === 0) {
    return { valid: false, resolved, error: '未设置允许的文件访问目录（allowedRoots）' }
  }

  const inAllowed = allowedRoots.some((root) => {
    const normalizedRoot = normalize(resolve(root))
    const rel = relative(normalizedRoot, resolved)
    // rel 不能以 .. 开头（穿越），且不能是绝对路径（跨驱动器）
    return !rel.startsWith('..') && !isAbsolute(rel)
  })

  if (!inAllowed) {
    return { valid: false, resolved, error: `路径不在允许范围内: ${resolved}` }
  }

  // 4. 如果文件/目录已存在，通过 realpath 检测符号链接逃逸
  try {
    const real = realpathSync(resolved)
    const realInAllowed = allowedRoots.some((root) => {
      const normalizedRoot = normalize(resolve(root))
      const rel = relative(normalizedRoot, real)
      return !rel.startsWith('..') && !isAbsolute(rel)
    })
    if (!realInAllowed) {
      return { valid: false, resolved: real, error: `符号链接指向允许范围之外: ${real}` }
    }
    return { valid: true, resolved: real }
  } catch {
    // 文件尚不存在（write_file 场景），跳过 realpath 检查
    return { valid: true, resolved }
  }
}

/**
 * 从 config 加载 allowedRoots，MVP 默认允许访问 ~/Desktop, ~/Documents, ~/Downloads 和项目 data/ 目录
 */
export function getDefaultAllowedRoots(): string[] {
  const home = homedir()
  return [
    resolve(home, 'Desktop'),
    resolve(home, 'Documents'),
    resolve(home, 'Downloads'),
    // 项目 data 目录
    resolve(__dirname, '..', '..', '..', '..', 'data')
  ]
}
