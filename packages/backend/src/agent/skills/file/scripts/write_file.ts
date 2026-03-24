/**
 * write_file 脚本 — 创建新文件或覆写已有文件
 *
 * 输入（JSON via process.argv[2]）：
 *   { "path": "/absolute/path/to/file", "content": "要写入的内容" }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "已创建文件: ..." }
 *   { "success": false, "error": "错误信息" }
 */
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { validatePath, getDefaultAllowedRoots } from '../path-security'

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const filePath = input.path as string
  const content = input.content as string

  if (!filePath) {
    output({ success: false, error: '缺少 path 参数' })
    return
  }
  if (typeof content !== 'string') {
    output({ success: false, error: '缺少 content 参数' })
    return
  }

  const check = validatePath(filePath, getDefaultAllowedRoots())
  if (!check.valid) {
    output({ success: false, error: check.error })
    return
  }

  const resolved = check.resolved
  const existed = existsSync(resolved)

  try {
    const dir = dirname(resolved)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(resolved, content, 'utf-8')

    const action = existed ? '已覆写' : '已创建'
    output({
      success: true,
      content: `${action}文件: ${resolved} (${content.length} 字符)`
    })
  } catch (err) {
    output({
      success: false,
      error: `写入失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

main()
