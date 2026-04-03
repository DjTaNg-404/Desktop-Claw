import type { PersistedMessage } from './memory-service'
import type { EmotionState, EmotionSnapshot } from '@desktop-claw/shared'

// ─── 话术池 ──────────────────────────────────

const PHRASES: Record<EmotionState, string[]> = {
  night: [
    '夜深了，早点休息呀 🌙',
    '熬夜对身体不好哦～',
    '我也有点困了…打个哈欠 😪',
    '晚安～明天见 ✨'
  ],
  busy: [
    '在呢在呢～',
    '嗯？还有什么事吗？',
    '我在听～',
    '有什么需要帮忙的？'
  ],
  done: [
    '刚才聊得挺开心的～',
    '休息一下也好 ☕',
    '有事随时叫我哦',
    '我在这里等你～'
  ],
  idle: [
    '嗨～有什么想聊的吗？',
    '今天过得怎么样？',
    '无聊的话可以找我玩哦 🐾',
    '我在这里呢～',
    '要不要聊聊天？'
  ]
}

/** 每个状态的固定 intensity（0–1）和 ambientLevel */
const STATE_PARAMS: Record<EmotionState, { intensity: number; ambientLevel: 'low' | 'medium' | 'high' }> = {
  night: { intensity: 0.2, ambientLevel: 'low' },
  idle:  { intensity: 0.4, ambientLevel: 'medium' },
  done:  { intensity: 0.5, ambientLevel: 'medium' },
  busy:  { intensity: 0.8, ambientLevel: 'high' }
}

// ─── 输入信号 ────────────────────────────────

/** 情绪推导输入信号（v1） */
export interface EmotionSignals {
  /** 当前时间 */
  now: Date
  /** 当日已落盘消息 */
  todayMessages: PersistedMessage[]
  /** 最近一次用户交互时间（ISO），比 messages 更实时（如打开 QuickInput、发消息） */
  lastInteractionAt?: string
  /** 最近一次任务完成时间（ISO） */
  lastTaskCompletedAt?: string
  /** 当前是否正在流式回复 */
  isStreaming?: boolean
  // ── 未来可扩展（记忆信号） ──
  // memoryHints?: string[]
  // specialDayTags?: string[]
}

// ─── 纯函数：从输入信号派生情绪状态 ─────────

/**
 * 派生情绪状态（纯函数，零 LLM 成本）
 *
 * 评估优先级：night > busy > done > idle
 * 分别返回 EmotionSnapshot（含 state / reason / phrases / intensity / ambientLevel）
 */
export function deriveEmotionState(signals: EmotionSignals): EmotionSnapshot {
  const { now, todayMessages, lastInteractionAt, lastTaskCompletedAt, isStreaming } = signals
  const hour = now.getHours()
  const nowMs = now.getTime()
  const updatedAt = now.toISOString()

  // ── 计算共享信号 ──
  const lastMsg = todayMessages.length > 0
    ? todayMessages[todayMessages.length - 1]
    : null
  const lastMsgTime = lastMsg?.ts ? new Date(lastMsg.ts).getTime() : 0
  const lastInteractionMs = lastInteractionAt ? new Date(lastInteractionAt).getTime() : 0
  const lastTaskMs = lastTaskCompletedAt ? new Date(lastTaskCompletedAt).getTime() : 0

  // 取消息和显式交互中较新的那个
  const lastActivityMs = Math.max(lastMsgTime, lastInteractionMs)
  const minutesSinceActivity = lastActivityMs
    ? (nowMs - lastActivityMs) / 60_000
    : Infinity
  const minutesSinceTask = lastTaskMs
    ? (nowMs - lastTaskMs) / 60_000
    : Infinity

  const userMsgCount = todayMessages.filter((m) => m.role === 'user').length

  // ── 按优先级求值 ──

  // night: 22:00 - 06:00（时间窗直接决定）
  if (hour >= 22 || hour < 6) {
    return snap('night', 'night_time', updatedAt)
  }

  // busy: 正在流式回复 / 最近 5 分钟有交互 / 最近 2 分钟刚完成任务
  if (isStreaming) {
    return snap('busy', 'streaming', updatedAt)
  }
  if (minutesSinceActivity < 5) {
    return snap('busy', 'recent_conversation', updatedAt)
  }
  if (minutesSinceTask < 2) {
    return snap('busy', 'task_just_completed', updatedAt)
  }

  // done: 当日用户消息 >= 5，且静默 5-8 分钟（短窗口"余温"状态，超过 8 分钟自动回 idle）
  if (userMsgCount >= 5 && minutesSinceActivity >= 5 && minutesSinceActivity < 8) {
    return snap('done', 'quiet_after_active_day', updatedAt)
  }

  // idle: 兜底
  return snap('idle', 'default_idle', updatedAt)
}

/** 内部辅助：构造完整 EmotionSnapshot */
function snap(state: EmotionState, reason: string, updatedAt: string): EmotionSnapshot {
  const { intensity, ambientLevel } = STATE_PARAMS[state]
  return {
    state,
    reason,
    updatedAt,
    phrases: PHRASES[state],
    intensity,
    ambientLevel
  }
}
