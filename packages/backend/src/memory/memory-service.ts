import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import type { ChatMessageData } from '@desktop-claw/shared'
import { streamChat } from '../llm/client'
import { loadLLMConfig } from '../llm/config'
import { estimateHistoryTokens } from '../llm/token-estimator'
import { getMemoryDir, getPersonaDir } from '../paths'

// ─── 类型定义 ────────────────────────────────

/** 落盘消息：在 ChatMessageData 基础上附带时间戳 */
export interface PersistedMessage extends ChatMessageData {
  ts: string
}

/** 每日归档 JSON 结构 */
export interface DayArchive {
  date: string
  sealed: boolean
  messages: PersistedMessage[]
  diary: string | null
  summary: string | null
  facts: string[] | null
}

// ─── data/ 目录路径解析 ──────────────────────

function resolveMemoryDir(): string {
  const dir = getMemoryDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function resolvePersonaDir(): string {
  return getPersonaDir()
}

// ─── 辅助函数 ────────────────────────────────

function todayDateStr(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function yesterdayDateStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function archivePath(date: string): string {
  return join(resolveMemoryDir(), `${date}.json`)
}

function readArchive(date: string): DayArchive | null {
  const p = archivePath(date)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    console.error(`[memory] failed to parse ${p}`)
    return null
  }
}

function writeArchive(archive: DayArchive): void {
  const p = archivePath(archive.date)
  writeFileSync(p, JSON.stringify(archive, null, 2), 'utf-8')
}

function createEmptyArchive(date: string): DayArchive {
  return {
    date,
    sealed: false,
    messages: [],
    diary: null,
    summary: null,
    facts: null
  }
}

function ensureTodayArchive(): DayArchive {
  const date = todayDateStr()
  const existing = readArchive(date)
  if (existing) return existing

  const archive = createEmptyArchive(date)
  writeArchive(archive)
  return archive
}

// ─── LLM 摘要调用 ────────────────────────────

/** 用 streamChat 做一次 LLM 调用，收集完整文本返回 */
function callLLMForText(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let result = ''
    streamChat(
      [{ role: 'user', content: userContent }],
      {
        onToken(delta) { result += delta },
        onDone(full) { resolve(full) },
        onError(code, message) { reject(new Error(`${code}: ${message}`)) }
      },
      { systemPrompt }
    )
  })
}

/** 将对话消息格式化为可读文本（供 LLM 摘要用） */
function formatMessagesForSummary(messages: PersistedMessage[]): string {
  // 只取 user 和 assistant 消息，跳过 tool 消息
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'Claw'
      const time = m.ts ? `[${m.ts.split('T')[1]?.slice(0, 5) ?? ''}] ` : ''
      return `${time}${role}：${m.content.slice(0, 500)}`
    })
    .join('\n')
}

// ─── 摘要压缩 ────────────────────────────────

/** 摘要压缩触发阈值：历史 token 超过 context window 的 90% 时触发 */
const COMPRESS_TOKEN_RATIO = 0.9
/** 压缩后保留的最近轮次数 */
const COMPRESS_KEEP_TURNS = 10
/** 备用轮次阈值（config 缺失 contextWindow 时回退） */
const COMPRESS_TURN_THRESHOLD = 20
/** 默认 context window（DeepSeek 128K 的 ~90%） */
const DEFAULT_CONTEXT_WINDOW = 115000
/** 摘要消息的固定前缀（loop.ts trimHistory 据此识别并保留） */
export const SUMMARY_PREFIX = '[对话摘要]'

/** 将对话消息格式化为可读文本（供压缩摘要用，接收内存 ChatMessageData） */
function formatForCompression(messages: ChatMessageData[]): string {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'Claw'
      const content = m.content.length > 500 ? m.content.slice(0, 500) + '…(截断)' : m.content
      return `${role}：${content}`
    })
    .join('\n')
}

// ─── MemoryService ──────────────────────────

/** BOOT 行为返回结果 */
export interface BootResult {
  /** 昨日 diary（可用于首条对话上下文） */
  yesterdayDiary: string | null
  /** 是否补做了昨日归档 */
  recoveredYesterday: boolean
  /** 是否为首次引导模式（BOOTSTRAP.md 存在） */
  isBootstrap: boolean
}

export class MemoryService {
  private _compressing = false

  // ── 写入 ──

  /** 追加单条消息到当日 JSON（实时写盘） */
  appendMessage(msg: ChatMessageData): void {
    const archive = ensureTodayArchive()
    const persisted: PersistedMessage = {
      ...msg,
      ts: new Date().toISOString()
    }
    archive.messages.push(persisted)
    writeArchive(archive)
  }

  /** 批量追加消息（agent loop 完成时调用） */
  appendMessages(msgs: ChatMessageData[]): void {
    if (msgs.length === 0) return
    const archive = ensureTodayArchive()
    const now = new Date()
    for (let i = 0; i < msgs.length; i++) {
      archive.messages.push({
        ...msgs[i],
        ts: new Date(now.getTime() + i).toISOString()
      })
    }
    writeArchive(archive)
  }

  // ── 读取 ──

  /** 读取当日已有对话（重启恢复用） */
  getTodayMessages(): ChatMessageData[] {
    const archive = readArchive(todayDateStr())
    if (!archive) return []
    // 返回不含 ts 的 ChatMessageData（兼容内存 conversation 格式）
    return archive.messages.map(({ ts: _ts, ...rest }) => rest)
  }

  /** 返回最近 N 天的摘要（B.3 用） */
  getRecentSummaries(n: number): DayArchive[] {
    if (n <= 0) return []

    const results: DayArchive[] = []
    const today = todayDateStr()

    for (const date of this.getAvailableDates()) {
      if (results.length >= n) break
      if (date === today) continue
      const archive = readArchive(date)
      if (archive && archive.sealed) {
        results.push(archive)
      }
    }

    return results
  }

  // ── 压缩 ──

  /**
   * 当对话 token 量接近 context window 上限时（≥90%），将旧消息压缩为 LLM 摘要。
   * 回退策略：config 无 contextWindow 时仍以轮次阈值触发。
   * 直接修改传入的数组（原地 splice）。
   * 磁盘归档保留完整原始对话，不受影响。
   */
  async compressIfNeeded(conversation: ChatMessageData[]): Promise<boolean> {
    if (this._compressing) return false

    // token-aware 检测
    const contextWindow = loadLLMConfig()?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
    const tokenBudget = Math.floor(contextWindow * COMPRESS_TOKEN_RATIO)
    const currentTokens = estimateHistoryTokens(conversation)
    const userCount = conversation.filter((m) => m.role === 'user').length

    // 同时检查 token 和轮次，任一达标即触发
    const shouldCompress = currentTokens >= tokenBudget || userCount >= COMPRESS_TURN_THRESHOLD
    if (!shouldCompress) return false

    this._compressing = true
    try {
      // 从后往前找到保留 COMPRESS_KEEP_TURNS 轮的分界点
      let kept = 0
      let splitIndex = conversation.length
      for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].role === 'user') {
          kept++
          if (kept >= COMPRESS_KEEP_TURNS) {
            splitIndex = i
            break
          }
        }
      }

      if (splitIndex <= 0) return false

      const oldMessages = conversation.slice(0, splitIndex)
      const transcript = formatForCompression(oldMessages)

      const summary = await callLLMForText(
        '你是对话摘要助手。将下方对话压缩为简洁但信息完整的中文摘要（200-400字），保留关键话题、结论和待办事项。不要使用 Markdown 标题。',
        `请压缩以下对话：\n\n${transcript}`
      )

      // 构造摘要消息（单条 assistant 消息，不增加 user turn 计数）
      const summaryMsg: ChatMessageData = {
        role: 'assistant',
        content: `${SUMMARY_PREFIX} ${summary}`
      }

      // 原地替换：移除旧消息，插入摘要
      conversation.splice(0, splitIndex, summaryMsg)

      console.log(
        `[memory] compressed ${oldMessages.length} messages (~${currentTokens} tokens → ~${estimateHistoryTokens(conversation)} tokens) into summary`
      )
      return true
    } catch (err) {
      console.error('[memory] compression failed, skipping:', err)
      return false
    } finally {
      this._compressing = false
    }
  }

  // ── 归档 ──

  /**
   * 生成当日归档的 summary + facts + diary（调用 LLM）
   * 仅在当日有足够对话内容时有意义
   */
  async finalizeDayArchive(date?: string): Promise<void> {
    const targetDate = date ?? todayDateStr()
    const archive = readArchive(targetDate)
    if (!archive) {
      console.log(`[memory] no archive for ${targetDate}, skip finalize`)
      return
    }

    const userMsgCount = archive.messages.filter((m) => m.role === 'user').length
    if (userMsgCount < 2) {
      console.log(`[memory] too few messages (${userMsgCount} user msgs) for ${targetDate}, skip finalize`)
      return
    }

    const transcript = formatMessagesForSummary(archive.messages)

    // ── summary + facts ──
    try {
      const summaryRaw = await callLLMForText(
        '你是一个记忆整理助手。请根据对话记录生成简洁的摘要和关键事实。用中文回复。',
        `请根据以下对话记录，生成：
1. 一段 summary（50-150 字的概括性摘要）
2. 若干 facts（从对话中提取的关键事实，每条一行，以 "- " 开头）

对话记录：
${transcript}

请严格按以下格式输出：
## summary
<摘要内容>

## facts
- <事实1>
- <事实2>
...`
      )

      // 解析 LLM 输出
      const summaryMatch = summaryRaw.match(/## summary\s*\n([\s\S]*?)(?=## facts|$)/)
      const factsMatch = summaryRaw.match(/## facts\s*\n([\s\S]*)$/)

      if (summaryMatch) {
        archive.summary = summaryMatch[1].trim()
      }
      if (factsMatch) {
        archive.facts = factsMatch[1]
          .split('\n')
          .map((l) => l.replace(/^-\s*/, '').trim())
          .filter((l) => l.length > 0)
      }
    } catch (err) {
      console.error(`[memory] failed to generate summary for ${targetDate}:`, err)
    }

    // ── diary（Claw 第一人称日记） ──
    try {
      archive.diary = await callLLMForText(
        '你是 Claw，一个住在用户桌面上的 AI 小伙伴。请用第一人称写一小段今天的日记，像是在回忆今天和用户相处的经历。语气温暖自然、口语化，不超过 200 字。',
        `以下是今天的对话记录，请以 Claw 的第一人称视角写一段日记回忆：\n\n${transcript}`
      )
    } catch (err) {
      console.error(`[memory] failed to generate diary for ${targetDate}:`, err)
    }

    writeArchive(archive)
    console.log(`[memory] finalized archive for ${targetDate} (summary: ${archive.summary ? 'yes' : 'no'}, diary: ${archive.diary ? 'yes' : 'no'}, facts: ${archive.facts?.length ?? 0})`)
  }

  // ── 内化 ──

  /**
   * 每日内化：读取当日归档快照，调用 LLM 更新 CONTEXT.md 和 USER.md。
   * 在 finalizeDayArchive 完成（summary/facts/diary 已生成）后调用。
   */
  async internalize(date?: string): Promise<void> {
    const targetDate = date ?? todayDateStr()
    const archive = readArchive(targetDate)
    if (!archive || (!archive.summary && !archive.facts)) {
      console.log(`[memory] no summary/facts for ${targetDate}, skip internalize`)
      return
    }

    const personaDir = resolvePersonaDir()
    const contextPath = join(personaDir, 'CONTEXT.md')
    const userPath = join(personaDir, 'USER.md')

    const currentContext = existsSync(contextPath) ? readFileSync(contextPath, 'utf-8') : ''
    const currentUser = existsSync(userPath) ? readFileSync(userPath, 'utf-8') : ''

    const snapshot = [
      archive.summary ? `摘要：${archive.summary}` : '',
      archive.facts?.length ? `事实：\n${archive.facts.map((f) => `- ${f}`).join('\n')}` : '',
      archive.diary ? `日记：${archive.diary}` : ''
    ].filter(Boolean).join('\n\n')

    // ── 更新 CONTEXT.md ──
    try {
      const newContext = await callLLMForText(
        `你是 Claw 的记忆内化助手。根据今天（${targetDate}）的对话快照和当前 CONTEXT.md，决定哪些新信息值得跨天记住。
规则：
- 保留 "# 动态认知" 标题和引用说明
- 新增、修改或删除过时的条目
- 记录进行中的事项、形成的共识、值得跨天记住的信息
- 保持精简，整个文件不超过 800 字
- 输出完整的更新后 CONTEXT.md 内容`,
        `当前 CONTEXT.md：\n\n${currentContext}\n\n---\n\n今日对话快照（${targetDate}）：\n\n${snapshot}`
      )

      if (newContext && newContext.length > 20) {
        writeFileSync(contextPath, newContext.trim() + '\n', 'utf-8')
        console.log(`[memory] internalized CONTEXT.md (${newContext.length} chars)`)
      }
    } catch (err) {
      console.error(`[memory] failed to internalize CONTEXT.md:`, err)
    }

    // ── 有条件更新 USER.md ──
    try {
      const userUpdate = await callLLMForText(
        `你是 Claw 的用户画像更新助手。根据今天的对话事实，判断是否有新的用户信息或偏好需要记录到 USER.md。
规则：
- 如果没有新信息，只回复四个字："无需更新"
- 如果有新信息，输出完整的更新后 USER.md 内容
- 保留 "# 用户画像" 标题和引用说明
- 只记录用户的基本信息和偏好（称呼、背景、习惯等），不记录对话内容`,
        `当前 USER.md：\n\n${currentUser}\n\n---\n\n今日事实：\n\n${snapshot}`
      )

      if (userUpdate && !userUpdate.includes('无需更新') && userUpdate.length > 20) {
        writeFileSync(userPath, userUpdate.trim() + '\n', 'utf-8')
        console.log(`[memory] internalized USER.md (${userUpdate.length} chars)`)
      } else {
        console.log(`[memory] USER.md no update needed`)
      }
    } catch (err) {
      console.error(`[memory] failed to internalize USER.md:`, err)
    }
  }

  // ── 启动 ──

  private _shouldFinalizeArchive(archive: DayArchive): boolean {
    return archive.messages.filter((m) => m.role === 'user').length >= 2
  }

  private _hasArchiveOutputs(archive: DayArchive | null): boolean {
    return !!(archive?.summary || archive?.diary)
  }

  private async _completeArchive(
    date: string,
    options: { finalizeTimeoutMs?: number; internalizeTimeoutMs?: number } = {}
  ): Promise<boolean> {
    const archive = readArchive(date)
    if (!archive) return false
    if (archive.sealed) return true

    const shouldFinalize = this._shouldFinalizeArchive(archive)
    if (!shouldFinalize) {
      archive.sealed = true
      writeArchive(archive)
      console.log(`[memory] sealed low-activity archive for ${date} (too few user messages)`)
      return true
    }

    let finalized = false

    try {
      const finalizePromise = this.finalizeDayArchive(date)
      if (options.finalizeTimeoutMs) {
        await this._withTimeout(finalizePromise, options.finalizeTimeoutMs, 'finalize')
      } else {
        await finalizePromise
      }

      finalized = this._hasArchiveOutputs(readArchive(date))
    } catch (err) {
      console.error(`[memory] finalize failed for ${date}:`, err)
    }

    if (!finalized) {
      console.warn(`[memory] archive ${date} incomplete after finalize — will retry later`)
      return false
    }

    try {
      const internalizePromise = this.internalize(date)
      if (options.internalizeTimeoutMs) {
        await this._withTimeout(internalizePromise, options.internalizeTimeoutMs, 'internalize')
      } else {
        await internalizePromise
      }
    } catch (err) {
      console.error(`[memory] internalize failed for ${date}:`, err)
    }

    const updated = readArchive(date)
    if (!updated) return false
    if (!updated.sealed) {
      updated.sealed = true
      writeArchive(updated)
      console.log(`[memory] sealed archive for ${date}`)
    }

    return true
  }

  /**
   * BOOT 行为：每次 App 启动时执行的轻量逻辑。
   * 1. 扫描所有未 sealed 的历史归档（跳过今天）→ 按统一规则补全并封存
   * 2. 读取昨日 diary，供未来注入首条对话上下文
   */
  async boot(): Promise<BootResult> {
    const today = todayDateStr()
    const result: BootResult = {
      yesterdayDiary: null,
      recoveredYesterday: false,
      isBootstrap: false
    }

    // 检测首次引导模式
    const bootstrapPath = join(resolvePersonaDir(), 'BOOTSTRAP.md')
    result.isBootstrap = existsSync(bootstrapPath)
    if (result.isBootstrap) {
      console.log('[boot] BOOTSTRAP.md detected — first-run bootstrap mode')
    }

    // 扫描所有未 sealed 的历史归档（跳过今天，今天还在进行中）
    const memDir = resolveMemoryDir()
    const files = readdirSync(memDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace('.json', ''))
      .sort()

    for (const date of files) {
      if (date === today) continue
      const archive = readArchive(date)
      if (!archive || archive.sealed) continue

      console.log(`[boot] recovering unsealed archive: ${date}`)
      try {
        await this._completeArchive(date)
      } catch (err) {
        console.error(`[boot] recovery failed for ${date}:`, err)
      }
      result.recoveredYesterday = true
    }

    // 读取昨日 diary
    const yesterday = readArchive(yesterdayDateStr())
    result.yesterdayDiary = yesterday?.diary ?? null
    if (result.yesterdayDiary) {
      console.log(`[boot] yesterday diary: ${result.yesterdayDiary.slice(0, 80)}...`)
    }

    return result
  }

  // ── 日历查询 ──

  /** 返回有记录的日期列表（降序） */
  getAvailableDates(): string[] {
    const dir = resolveMemoryDir()
    return readdirSync(dir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace('.json', ''))
      .sort()
      .reverse()
  }

  /** 返回指定日期的摘要信息（不含完整对话） */
  getDaySummary(date: string): {
    diary: string | null
    summary: string | null
    facts: string[] | null
    messageCount: number
  } | null {
    const archive = readArchive(date)
    if (!archive) return null
    return {
      diary: archive.diary,
      summary: archive.summary,
      facts: archive.facts,
      messageCount: archive.messages.length
    }
  }

  /** 返回指定日期的完整消息列表 */
  getDayMessages(date: string): PersistedMessage[] | null {
    const archive = readArchive(date)
    if (!archive) return null
    return archive.messages
  }

  // ── 生命周期 ──

  /** 带超时的 Promise 包装 */
  private _withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms)
      )
    ])
  }

  /**
   * 关机归档：沿用统一归档完成规则。
   * 有足够对话时尝试 finalize + internalize；内容过少则直接 seal；
   * finalize 失败则不 seal，留给下次 boot() 重试。
   */
  async sealDay(): Promise<void> {
    const date = todayDateStr()
    const archive = readArchive(date)
    if (!archive) return
    if (archive.sealed) return

    await this._completeArchive(date, {
      finalizeTimeoutMs: 20000,
      internalizeTimeoutMs: 20000
    })
  }
}

// ── 单例导出 ──────────────────────────────────

export const memoryService = new MemoryService()
