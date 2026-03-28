/**
 * 历史消息裁剪模块 — 从 loop.ts 提取，便于独立测试
 */
import type { ChatMessageData } from '@desktop-claw/shared'
import { estimateMessageTokens, estimateHistoryTokens } from '../llm/token-estimator'
import { loadLLMConfig } from '../llm/config'

/** context window 中历史消息允许占用的比例上限（90%）*/
const HISTORY_BUDGET_RATIO = 0.9

// ── tool_result 修剪参数 ──
const TOOL_TRIM_THRESHOLD = 800
const TOOL_TRIM_HEAD = 300
const TOOL_TRIM_TAIL = 300

/** 默认 context window */
const DEFAULT_CONTEXT_WINDOW = 115000

/** 摘要消息前缀 */
const SUMMARY_PREFIX = '[对话摘要]'

function getContextWindow(): number {
  return loadLLMConfig()?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
}

/**
 * 修剪历史中的大 tool_result：超过阈值时只保留 head + tail
 */
export function trimToolResults(messages: ChatMessageData[], endIndex: number): void {
  for (let i = 0; i < endIndex; i++) {
    const m = messages[i]
    if (m.role !== 'tool') continue
    if (m.content.length <= TOOL_TRIM_THRESHOLD) continue

    const omitted = m.content.length - TOOL_TRIM_HEAD - TOOL_TRIM_TAIL
    const head = m.content.slice(0, TOOL_TRIM_HEAD)
    const tail = m.content.slice(-TOOL_TRIM_TAIL)
    messages[i] = { ...m, content: `${head}\n\n... [已省略约 ${omitted} 字] ...\n\n${tail}` }
  }
}

/**
 * 将消息序列切分为"原子组"
 */
export function buildAtomicGroups(
  messages: ChatMessageData[]
): { start: number; end: number; pinned: boolean }[] {
  const groups: { start: number; end: number; pinned: boolean }[] = []
  let i = 0

  if (messages[0]?.role === 'assistant' && messages[0].content.startsWith(SUMMARY_PREFIX)) {
    groups.push({ start: 0, end: 1, pinned: true })
    i = 1
  }

  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const groupStart = i
      i++
      while (i < messages.length && messages[i].role === 'tool') {
        i++
      }
      groups.push({ start: groupStart, end: i, pinned: false })
    } else {
      groups.push({ start: i, end: i + 1, pinned: false })
      i++
    }
  }

  return groups
}

/**
 * Token-aware 历史裁剪
 */
export function trimHistory(
  history: ChatMessageData[],
  systemPromptTokens: number
): ChatMessageData[] {
  if (history.length === 0) return []

  const work = history.map((m) => ({ ...m }))
  trimToolResults(work, work.length)

  const contextWindow = getContextWindow()
  const totalBudget = Math.floor(contextWindow * HISTORY_BUDGET_RATIO)
  const historyBudget = totalBudget - systemPromptTokens
  if (historyBudget <= 0) return work

  const currentTokens = estimateHistoryTokens(work)
  if (currentTokens <= historyBudget) return work

  const groups = buildAtomicGroups(work)

  const groupTokens = groups.map((g) => {
    let t = 0
    for (let i = g.start; i < g.end; i++) {
      t += estimateMessageTokens(work[i])
    }
    return t
  })

  let totalTokens = currentTokens
  const keepFlags = groups.map(() => true)

  for (let g = 0; g < groups.length; g++) {
    if (totalTokens <= historyBudget) break
    if (groups[g].pinned) continue
    keepFlags[g] = false
    totalTokens -= groupTokens[g]
  }

  const result: ChatMessageData[] = []
  for (let g = 0; g < groups.length; g++) {
    if (!keepFlags[g]) continue
    for (let i = groups[g].start; i < groups[g].end; i++) {
      result.push(work[i])
    }
  }

  return result
}
