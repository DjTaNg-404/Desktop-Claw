import { useState, useEffect, useRef } from 'react'
import type { EmotionSnapshot, EmotionState } from '@desktop-claw/shared'
import { backendFetch } from '../lib/backend-client'

/** 默认轮询间隔 15 秒（后续可平滑升级到 WS push） */
const POLL_INTERVAL = 15_000

const DEFAULT_SNAPSHOT: EmotionSnapshot = {
  state: 'idle',
  reason: 'init',
  updatedAt: new Date().toISOString(),
  phrases: [],
  intensity: 0.3,
  ambientLevel: 'low'
}

export interface UseClawEmotionReturn {
  /** 当前情绪快照 */
  snapshot: EmotionSnapshot
  /** 当前主状态（snapshot.state 的快捷访问） */
  emotion: EmotionState
}

/**
 * 轮询 GET /emotion，返回最新的 EmotionSnapshot。
 * 前端不做任何状态推导，只消费后端 snapshot。
 */
export function useClawEmotion(interval = POLL_INTERVAL): UseClawEmotionReturn {
  const [snapshot, setSnapshot] = useState<EmotionSnapshot>(DEFAULT_SNAPSHOT)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchEmotion = (): void => {
      backendFetch('/emotion')
        .then((r) => r.json())
        .then((data: EmotionSnapshot) => {
          if (!cancelled) setSnapshot(data)
        })
        .catch(() => {
          // 静默失败，保持上一次 snapshot
        })
    }

    // 启动立即拉取一次
    fetchEmotion()
    timerRef.current = setInterval(fetchEmotion, interval)

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [interval])

  return { snapshot, emotion: snapshot.state }
}
