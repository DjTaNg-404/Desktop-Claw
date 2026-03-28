import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { streamChat } from '../llm/client'
import { getDataDir, getPersonaDir, getMemoryDir } from '../paths'

/* ── 类型 ────────────────────────────────────────────── */

interface GreetingCache {
  date: string
  pool: string[]
}

/* ── 常量 ────────────────────────────────────────────── */

const POOL_SIZE = 8
const REFILL_THRESHOLD = 3
const CACHE_FILE = '.greeting-cache.json'

/* ── Service ─────────────────────────────────────────── */

class GreetingService {
  private pool: string[] = []
  private generating = false

  /** 启动时调用：读缓存或异步生成 */
  async init(): Promise<void> {
    const today = this._today()
    const cached = this._readCache()

    if (cached && cached.date === today && cached.pool.length >= REFILL_THRESHOLD) {
      this.pool = cached.pool
      console.log(`[greeting] loaded ${this.pool.length} cached greetings`)
      return
    }

    // 缓存不可用，异步生成
    await this._generate()
  }

  /** 取一条互动语（取后自动检查补充） */
  take(): string | null {
    if (this.pool.length === 0) return null
    const greeting = this.pool.shift()!
    this._saveCache()

    // 低于阈值时异步补充
    if (this.pool.length < REFILL_THRESHOLD && !this.generating) {
      void this._generate()
    }

    return greeting
  }

  /* ── 内部方法 ──────────────────────────────────────── */

  private async _generate(): Promise<void> {
    if (this.generating) return
    this.generating = true

    try {
      const prompt = this._buildPrompt()
      const result = await this._callLLM(prompt)
      const greetings = this._parseResult(result)

      if (greetings.length > 0) {
        this.pool.push(...greetings)
        this._saveCache()
        console.log(`[greeting] generated ${greetings.length} greetings, pool: ${this.pool.length}`)
      }
    } catch (err) {
      console.error('[greeting] generation failed:', err)
    } finally {
      this.generating = false
    }
  }

  private _buildPrompt(): string {
    const personaDir = getPersonaDir()

    const user = this._readFile(join(personaDir, 'USER.md'))
    const context = this._readFile(join(personaDir, 'CONTEXT.md'))

    const hour = new Date().getHours()
    let period: string
    if (hour >= 6 && hour < 12) period = '早上'
    else if (hour >= 12 && hour < 18) period = '下午'
    else if (hour >= 18 && hour < 23) period = '晚上'
    else period = '深夜'

    const now = new Date()
    const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}（${period}）`

    let userInfo = ''
    if (user && user.length > 50) {
      // 提取关键信息，不全量注入
      const lines = user.split('\n').filter((l) => l.startsWith('- **')).slice(0, 5)
      userInfo = lines.join('\n')
    }

    let contextInfo = ''
    if (context && context.length > 50) {
      const lines = context.split('\n').filter((l) => l.trim().startsWith('-')).slice(0, 4)
      contextInfo = lines.join('\n')
    }

    return `你是 Claw，一个住在用户桌面上的 AI 小伙伴。
请生成 ${POOL_SIZE} 条简短的互动语，用于悬浮球上随机展示。

要求：
- 每条不超过 20 个字
- 口语化、轻松、符合你的性格（温暖、好奇、偶尔调皮）
- 每条风格略有不同（问候、关心、调皮、鼓励等混合）
- 符合当前时段氛围
- 可以适当用 emoji，但不滥用
${userInfo ? `- 你了解用户的信息：\n${userInfo}` : ''}
${contextInfo ? `- 最近动态：\n${contextInfo}` : ''}

当前时间：${timeStr}

请直接输出 JSON 数组，不要其他内容。示例格式：
["xxx", "yyy", "zzz"]`
  }

  private _callLLM(userContent: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let result = ''
      const timer = setTimeout(() => {
        controller.abort()
        reject(new Error('greeting LLM timeout (15s)'))
      }, 15_000)

      const controller = streamChat(
        [{ role: 'user' as const, content: userContent }],
        {
          onToken(delta) { result += delta },
          onDone(full) {
            clearTimeout(timer)
            resolve(full)
          },
          onError(code, msg) {
            clearTimeout(timer)
            reject(new Error(`LLM ${code}: ${msg}`))
          }
        },
        { systemPrompt: '你是一个 JSON 生成器。只输出合法的 JSON 数组，不要包含任何其他文字。' }
      )
    })
  }

  private _parseResult(raw: string): string[] {
    try {
      // 提取 JSON 数组部分（LLM 可能输出前后带额外文字）
      const match = raw.match(/\[[\s\S]*\]/)
      if (!match) return []
      const arr = JSON.parse(match[0])
      if (!Array.isArray(arr)) return []
      return arr
        .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 30)
        .slice(0, POOL_SIZE)
    } catch {
      console.error('[greeting] failed to parse LLM result:', raw.slice(0, 200))
      return []
    }
  }

  private _readCache(): GreetingCache | null {
    try {
      const cachePath = join(getMemoryDir(), CACHE_FILE)
      if (!existsSync(cachePath)) return null
      const data = JSON.parse(readFileSync(cachePath, 'utf-8'))
      if (data && typeof data.date === 'string' && Array.isArray(data.pool)) {
        return data as GreetingCache
      }
      return null
    } catch {
      return null
    }
  }

  private _saveCache(): void {
    try {
      const cachePath = join(getMemoryDir(), CACHE_FILE)
      const cache: GreetingCache = { date: this._today(), pool: this.pool }
      writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8')
    } catch (err) {
      console.error('[greeting] save cache error:', err)
    }
  }

  private _readFile(path: string): string {
    try {
      if (!existsSync(path)) return ''
      return readFileSync(path, 'utf-8').trim()
    } catch {
      return ''
    }
  }

  private _today(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}

export const greetingService = new GreetingService()
