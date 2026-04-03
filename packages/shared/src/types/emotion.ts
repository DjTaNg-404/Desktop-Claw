// ─── 情绪层共享协议 ─────────────────────────

/** 四状态情绪模型 */
export type EmotionState = 'idle' | 'busy' | 'done' | 'night'

/**
 * 状态优先级（数值越高越优先）
 * 评估顺序：night > busy > done > idle
 */
export const EMOTION_PRIORITY: Record<EmotionState, number> = {
  idle: 0,
  done: 1,
  busy: 2,
  night: 3
}

/**
 * 最小保持时长（毫秒）
 * 进入该状态后，至少持续这么久才允许被更低优先级覆盖。
 * - night 由时间窗直接决定（22:00–06:00），无需最小保持
 * - idle 无强保持约束
 * - done 由 5-8 分钟窗口自带时限，无需额外保持
 */
export const EMOTION_MIN_HOLD_MS: Record<EmotionState, number> = {
  idle: 0,
  done: 0,              // 窗口型状态，5-8 分钟自然退出
  busy: 2 * 60_000,    // 2 分钟
  night: 0              // 由时间窗决定
}

/** 状态切换去抖间隔（毫秒）：同一状态不重复广播，切换频率上限 30s/次 */
export const EMOTION_DEBOUNCE_MS = 30_000

/** 情绪快照：后端统一输出、前端统一消费 */
export interface EmotionSnapshot {
  /** 当前主状态 */
  state: EmotionState
  /** 状态来源（调试/日志用），如 night_time / recent_conversation / quiet_after_active_day / default_idle */
  reason: string
  /** 最近一次状态变更时间 ISO 字符串 */
  updatedAt: string
  /** 当前状态适用的话术池 */
  phrases: string[]
  /** 情绪表现强度 0–1 */
  intensity: number
  /** 环境活动度：控制冒泡频率和视觉活动 */
  ambientLevel: 'low' | 'medium' | 'high'
}
