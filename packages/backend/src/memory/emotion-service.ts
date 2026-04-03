import type { EmotionSnapshot, EmotionState } from '@desktop-claw/shared'
import { EMOTION_PRIORITY, EMOTION_MIN_HOLD_MS, EMOTION_DEBOUNCE_MS } from '@desktop-claw/shared'
import { deriveEmotionState, type EmotionSignals } from './emotion'
import { memoryService } from './memory-service'

// ─── EmotionService ──────────────────────────

/**
 * 情绪服务：维护当前 snapshot、应用 min-hold / debounce、定时刷新、
 * 跨时间段边界检测、外部事件触发刷新。
 *
 * 对外暴露单例 `emotionService`。
 */
class EmotionService {
  /** 当前快照 */
  private snapshot: EmotionSnapshot | null = null

  /** 上次状态变更的时间戳（ms），用于 min-hold 判断 */
  private stateChangedAt = 0

  /** 上次广播的时间戳（ms），用于 debounce */
  private lastBroadcastAt = 0

  /** 计时器句柄 */
  private intervalId: ReturnType<typeof setInterval> | null = null

  /** 上一次刷新时的小时数，用于跨时间段边界检测 */
  private lastHour = -1

  /** 最近一次用户交互时间（ISO） */
  private lastInteractionAt: string | undefined

  /** 最近一次任务完成时间（ISO） */
  private lastTaskCompletedAt: string | undefined

  /** 当前是否正在流式回复 */
  private isStreaming = false

  /** 状态变更监听器 */
  private listeners: Array<(snap: EmotionSnapshot) => void> = []

  // ── 生命周期 ──

  /** App 启动时调用：做首次刷新 + 启动定时器 */
  start(): void {
    this.refresh()
    this.intervalId = setInterval(() => this.tick(), 60_000)
    console.log('[emotion] service started')
  }

  /** App 关闭时调用：清理定时器 */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[emotion] service stopped')
  }

  // ── 外部事件触发 ──

  /** 用户发消息时触发 */
  notifyUserMessage(): void {
    this.lastInteractionAt = new Date().toISOString()
    this.refresh()
  }

  /** 流式开始 */
  notifyStreamStart(): void {
    this.isStreaming = true
    this.refresh()
  }

  /** 流式结束 */
  notifyStreamEnd(): void {
    this.isStreaming = false
    this.refresh()
  }

  /** 任务完成时触发 */
  notifyTaskCompleted(): void {
    this.lastTaskCompletedAt = new Date().toISOString()
    this.isStreaming = false
    this.refresh()
  }

  /** 注册状态变更监听器（用于 WS 广播等） */
  onChange(listener: (snap: EmotionSnapshot) => void): void {
    this.listeners.push(listener)
  }

  /** 获取当前快照（安全返回默认 idle） */
  getSnapshot(): EmotionSnapshot {
    if (!this.snapshot) this.refresh()
    return this.snapshot!
  }

  // ── 内部逻辑 ──

  /** 定时器回调：普通刷新 + 跨时间段边界检测 */
  private tick(): void {
    const hour = new Date().getHours()

    // 跨时间段边界：小时变化时强制刷新（覆盖 22→night、6→非 night 等）
    if (this.lastHour !== -1 && hour !== this.lastHour) {
      this.refresh()
    } else {
      this.refresh()
    }
    this.lastHour = hour
  }

  /** 核心刷新：构造信号 → 纯函数推导 → min-hold / debounce → 广播 */
  private refresh(): void {
    const now = new Date()
    const signals: EmotionSignals = {
      now,
      todayMessages: memoryService.getTodayPersistedMessages(),
      lastInteractionAt: this.lastInteractionAt,
      lastTaskCompletedAt: this.lastTaskCompletedAt,
      isStreaming: this.isStreaming
    }

    const derived = deriveEmotionState(signals)
    const prev = this.snapshot
    const nowMs = now.getTime()

    // 首次刷新：直接接受
    if (!prev) {
      this.accept(derived, nowMs)
      return
    }

    // 状态未变：更新 updatedAt 但不广播
    if (derived.state === prev.state) {
      this.snapshot = derived
      return
    }

    // min-hold 判断：当前状态未过最小保持时间，且新状态优先级更低 → 抑制
    const holdMs = EMOTION_MIN_HOLD_MS[prev.state]
    const holdElapsed = nowMs - this.stateChangedAt
    if (holdElapsed < holdMs && EMOTION_PRIORITY[derived.state] < EMOTION_PRIORITY[prev.state]) {
      return // 抑制：当前高优先级状态还在 min-hold 期内
    }

    // debounce 判断：距上次广播不足 EMOTION_DEBOUNCE_MS → 仅内部更新，不广播
    const sinceBroadcast = nowMs - this.lastBroadcastAt
    if (sinceBroadcast < EMOTION_DEBOUNCE_MS) {
      // 静默更新快照，但不通知监听器
      this.snapshot = derived
      this.stateChangedAt = nowMs
      return
    }

    this.accept(derived, nowMs)
  }

  /** 接受新快照并广播 */
  private accept(snap: EmotionSnapshot, nowMs: number): void {
    this.snapshot = snap
    this.stateChangedAt = nowMs
    this.lastBroadcastAt = nowMs
    this.lastHour = new Date(nowMs).getHours()

    for (const listener of this.listeners) {
      try {
        listener(snap)
      } catch (err) {
        console.error('[emotion] listener error:', err)
      }
    }
  }
}

export const emotionService = new EmotionService()
