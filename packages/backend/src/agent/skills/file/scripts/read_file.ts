/**
 * read_file 脚本 — 读取本地文件内容
 *
 * 输入（JSON via process.argv[2]）：
 *   { "path": "/absolute/path/to/file" }
 *
 * 输出（JSON via stdout）：
 *   { "success": true, "content": "文件内容..." }
 *   { "success": false, "error": "错误信息" }
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { validatePath, getDefaultAllowedRoots } from '../path-security'

const MAX_FILE_SIZE = 512 * 1024

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl',
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.htm', '.css', '.scss', '.less', '.sass',
  '.xml', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.env', '.gitignore', '.editorconfig',
  '.csv', '.tsv', '.log',
  '.vue', '.svelte', '.astro',
  '' // 无扩展名文件（如 Dockerfile, Makefile）
])

function output(result: { success: boolean; content?: string; error?: string }) {
  process.stdout.write(JSON.stringify(result))
}

async function readPdf(filePath: string) {
  const { PDFParse } = await import('pdf-parse')
  const buffer = readFileSync(filePath)
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  const result = await parser.getText()
  await parser.destroy()
  return result.text || '（PDF 未提取到文本内容）'
}

async function readDocx(filePath: string) {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ path: filePath })
  return result.value || '（DOCX 未提取到文本内容）'
}

async function readXlsx(filePath: string) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(readFileSync(filePath))
  const lines: string[] = []
  for (const sheetName of workbook.SheetNames) {
    lines.push(`=== Sheet: ${sheetName} ===`)
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])
    lines.push(csv)
  }
  return lines.join('\n') || '（XLSX 未提取到内容）'
}

async function main() {
  const input = JSON.parse(process.argv[2] || '{}')
  const filePath = input.path as string

  if (!filePath) {
    output({ success: false, error: '缺少 path 参数' })
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

  const stat = statSync(resolved)
  if (!stat.isFile()) {
    output({ success: false, error: `路径不是文件: ${resolved}` })
    return
  }
  if (stat.size > MAX_FILE_SIZE) {
    output({
      success: false,
      error: `文件过大 (${(stat.size / 1024).toFixed(0)}KB)，上限 ${MAX_FILE_SIZE / 1024}KB`
    })
    return
  }

  const ext = extname(resolved).toLowerCase()

  try {
    let content: string

    if (ext === '.pdf') {
      content = await readPdf(resolved)
    } else if (ext === '.docx') {
      content = await readDocx(resolved)
    } else if (ext === '.xlsx' || ext === '.xls') {
      content = await readXlsx(resolved)
    } else if (TEXT_EXTENSIONS.has(ext)) {
      content = readFileSync(resolved, 'utf-8')
    } else {
      // 未知扩展名，尝试作为文本读取
      content = readFileSync(resolved, 'utf-8')
    }

    output({ success: true, content })
  } catch (err) {
    output({ success: false, error: `读取失败: ${err instanceof Error ? err.message : String(err)}` })
  }
}

main().catch((err) => {
  output({ success: false, error: String(err) })
  process.exit(1)
})
