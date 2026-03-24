/**
 * edit_file 脚本 — 通过字符串替换修改已有文件
 *
 * 输入（JSON via process.argv[2]）：
 *   { "path": "/absolute/path/to/file", "old_text": "被替换文本", "new_text": "新文本" }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "已编辑文件: ..." }
 *   { "success": false, "error": "错误信息" }
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { validatePath, getDefaultAllowedRoots } from '../path-security'

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const filePath = input.path as string
  const oldText = input.old_text as string
  const newText = input.new_text as string

  if (!filePath) {
    output({ success: false, error: '缺少 path 参数' })
    return
  }
  if (typeof oldText !== 'string') {
    output({ success: false, error: '缺少 old_text 参数' })
    return
  }
  if (typeof newText !== 'string') {
    output({ success: false, error: '缺少 new_text 参数' })
    return
  }

  const check = validatePath(filePath, getDefaultAllowedRoots())
  if (!check.valid) {
    output({ success: false, error: check.error })
    return
  }

  const resolved = check.resolved

  if (!existsSync(resolved)) {
    output({ success: false, error: `文件不存在: ${resolved}` })
    return
  }

  try {
    const content = readFileSync(resolved, 'utf-8')

    const matchCount = content.split(oldText).length - 1
    if (matchCount === 0) {
      output({
        success: false,
        error: '未找到匹配的 old_text，请确认文本完全一致（包括空格和换行）'
      })
      return
    }
    if (matchCount > 1) {
      output({
        success: false,
        error: `old_text 在文件中匹配了 ${matchCount} 处，应只匹配 1 处。请提供更精确的文本`
      })
      return
    }

    const newContent = content.replace(oldText, newText)
    writeFileSync(resolved, newContent, 'utf-8')

    output({
      success: true,
      content: `已编辑文件: ${resolved}（替换了 ${oldText.length} → ${newText.length} 字符）`
    })
  } catch (err) {
    output({
      success: false,
      error: `编辑失败: ${err instanceof Error ? err.message : String(err)}`
    })
  }
}

main()
