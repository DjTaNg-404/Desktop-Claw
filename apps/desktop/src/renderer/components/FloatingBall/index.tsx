import React, { useState, useRef, useCallback, useEffect } from 'react'
import type { EmotionState } from '@desktop-claw/shared'
import { ChatBubble } from '../ChatBubble'
import { QuickInput } from '../QuickInput'
import { useClawSocket } from '../../hooks/useClawSocket'
import { useClawEmotion } from '../../hooks/useClawEmotion'
import { backendFetch } from '../../lib/backend-client'
import './styles.css'

/** 按情绪状态分流的点击文案池（LLM 取不到时的 fallback） */
const CLICK_PHRASES: Record<EmotionState, string[]> = {
  idle: [
    '在呢～',
    '有什么需要帮忙的吗？',
    '今天怎么样？',
    '嗨～',
    '我在这里 🐾',
    '要不要聊聊天？',
    '你好呀～',
    '陪着你呢'
  ],
  busy: [
    '在忙呢～有事说 🐾',
    '嗯？还有什么事吗？',
    '我在听～',
    '有什么需要帮的？',
    '说吧，在线投入中 💪'
  ],
  done: [
    '今天辛苦了！',
    '刚才聊得挺开心的～',
    '休息一下也好 ☕',
    '有事随时叫我哦',
    '收工啦～',
    '我在这里等你～'
  ],
  night: [
    '嘘…🌙',
    '夜深了，早点休息哦',
    '别太晚了呀',
    '😴'
  ]
}

/** 按时段分组的启动开场语 */
const STARTUP_GREETINGS: Record<string, string[]> = {
  morning: [
    '早～今天也一起加油 🐾',
    '早安，新的一天开始啦',
    '早上好呀，今天有什么计划？',
    '早！精神怎么样？'
  ],
  afternoon: [
    '下午好呀，在忙什么呢？',
    '下午好～需要帮忙随时叫我',
    '午后时光，状态怎么样？',
    '下午好，我在呢 🐾'
  ],
  evening: [
    '晚上好～有什么需要帮忙的吗',
    '晚上好呀，今天辛苦了',
    '晚上好，还在忙吗？',
    '嗨～晚上好 🐾'
  ],
  latenight: [
    '这么晚了，注意休息哦 🌙',
    '夜深了，别太累了',
    '还没睡呀，我陪着你 🌙',
    '深夜了，早点休息哦'
  ]
}

function getStartupGreeting(): string {
  const hour = new Date().getHours()
  let period: string
  if (hour >= 6 && hour < 12) period = 'morning'
  else if (hour >= 12 && hour < 18) period = 'afternoon'
  else if (hour >= 18 && hour < 23) period = 'evening'
  else period = 'latenight'
  const pool = STARTUP_GREETINGS[period]
  return pool[Math.floor(Math.random() * pool.length)]
}

const MAX_BUBBLES = 3

/** 根据气泡数量返回从旧到新的 opacity 列表 */
function getBubbleOpacities(count: number): number[] {
  if (count <= 1) return [1.0]
  if (count === 2) return [0.6, 1.0]
  return [0.4, 0.7, 1.0]
}

/** 根据文本长度计算气泡停留时间（ms）：5s 底 + 50ms/字，上限 15s */
function calcBubbleDuration(text: string): number {
  return Math.max(5000, Math.min(15000, 5000 + text.length * 50))
}

/** 自动冒泡间隔范围（毫秒） */
const AUTO_BUBBLE_INTERVAL: Record<string, [number, number]> = {
  idle: [6 * 60_000, 15 * 60_000],   // 6-15 分钟
  done: [10 * 60_000, 20 * 60_000]   // 10-20 分钟
}

/** 用户关闭气泡后的冷却时间 */
const DISMISS_COOLDOWN = 3 * 60_000 // 3 分钟

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

interface QuickInputState {
  visible: boolean
  direction: 'left' | 'right'
}

interface BubbleItem {
  id: number
  text: string
  streaming?: boolean
}

export function FloatingBall(): React.JSX.Element {
  const { messages, statusText, sendMessage } = useClawSocket()
  const { snapshot, emotion } = useClawEmotion()
  const [bubbles, setBubbles] = useState<BubbleItem[]>([])
  const [qiState, setQiState] = useState<QuickInputState | null>(null)
  const movedRef = useRef(false)
  const isDraggingRef = useRef(false)
  const bubbleIdRef = useRef(0)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ballRef = useRef<HTMLDivElement>(null)
  const listenersRef = useRef<{ onMove: () => void; onUp: (e: MouseEvent) => void } | null>(null)
  const prevMsgCountRef = useRef(0)
  const prevStreamingRef = useRef(false)
  const streamingBubbleIdRef = useRef<number | null>(null)
  /** 用户手动关闭气泡的时间戳，3 分钟内不自动冒泡 */
  const bubbleDismissedAtRef = useRef(0)

  const isQiVisible = qiState?.visible ?? false
  const [dropActive, setDropActive] = useState(false)
  const dropCounterRef = useRef(0)

  // 监听 AI 消息 → 流式气泡：开始时创建，token 时更新，完成时定型
  useEffect(() => {
    const latest = messages[messages.length - 1]
    const wasStreaming = prevStreamingRef.current
    const isNewMsg = messages.length > prevMsgCountRef.current

    if (latest && latest.role === 'assistant') {
      if (latest.streaming) {
        if (isNewMsg && !wasStreaming) {
          // 流式开始 → 创建 streaming 气泡
          bubbleIdRef.current += 1
          const newId = bubbleIdRef.current
          streamingBubbleIdRef.current = newId
          setBubbles((prev) => {
            const next = [...prev, { id: newId, text: latest.content || '', streaming: true }]
            return next.length > MAX_BUBBLES ? next.slice(-MAX_BUBBLES) : next
          })
        } else if (streamingBubbleIdRef.current !== null) {
          // 流式 token → 更新气泡文本
          const sid = streamingBubbleIdRef.current
          setBubbles((prev) =>
            prev.map((b) => (b.id === sid ? { ...b, text: latest.content } : b))
          )
        }
      } else if (wasStreaming && !latest.streaming) {
        // 流式完成 → 定型气泡
        const sid = streamingBubbleIdRef.current
        if (sid !== null) {
          setBubbles((prev) =>
            prev.map((b) =>
              b.id === sid ? { ...b, text: latest.content, streaming: false } : b
            )
          )
          streamingBubbleIdRef.current = null
        }
      } else if (isNewMsg && !latest.streaming && latest.content) {
        // 非流式的完整消息（如 conversation.history 恢复）
        pushBubble(latest.content)
      }
    }

    prevMsgCountRef.current = messages.length
    prevStreamingRef.current = !!latest?.streaming
  }, [messages])

  useEffect(() => {
    return () => {
      if (listenersRef.current) {
        window.removeEventListener('mousemove', listenersRef.current.onMove)
        window.removeEventListener('mouseup', listenersRef.current.onUp)
        listenersRef.current = null
      }
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
      }
    }
  }, [])

  const pushBubble = useCallback((text: string) => {
    bubbleIdRef.current += 1
    const newBubble: BubbleItem = { id: bubbleIdRef.current, text }
    setBubbles((prev) => {
      const next = [...prev, newBubble]
      return next.length > MAX_BUBBLES ? next.slice(-MAX_BUBBLES) : next
    })
  }, [])

  // 启动时弹出时段问候气泡（仅一次，不进入 conversation history）
  useEffect(() => {
    const timer = setTimeout(() => {
      pushBubble(getStartupGreeting())
    }, 800)
    return () => clearTimeout(timer)
  }, [pushBubble])

  // ── 自动冒泡策略（克制）────────────────────────────
  // 仅 idle/done 状态冒泡；busy/night 不冒泡
  // 额外条件：非流式中、QuickInput 未打开、用户未显式关闭气泡（3 分钟冷却）
  useEffect(() => {
    const range = AUTO_BUBBLE_INTERVAL[emotion]
    if (!range) return // busy / night → 不冒泡

    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = (): void => {
      const delay = randomInRange(range[0], range[1])
      timer = setTimeout(() => {
        // 逐一检查前置条件
        const isStreaming = streamingBubbleIdRef.current !== null
        const isQiOpen = qiState?.visible ?? false
        const recentlyDismissed = Date.now() - bubbleDismissedAtRef.current < DISMISS_COOLDOWN

        if (!isStreaming && !isQiOpen && !recentlyDismissed) {
          // 从当前 snapshot phrases 中随机取一句
          const pool = snapshot.phrases
          if (pool.length > 0) {
            pushBubble(pool[Math.floor(Math.random() * pool.length)])
          }
        }

        // 无论是否真正冒泡，都继续排下一轮
        schedule()
      }, delay)
    }

    schedule()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [emotion, snapshot.phrases, pushBubble, qiState?.visible])

  const handleSingleClick = useCallback(() => {
    const pool = CLICK_PHRASES[emotion]
    const fallback = (): string => pool[Math.floor(Math.random() * pool.length)]

    // 先尝试从 LLM 预生成池取，失败则 fallback 到按状态文案
    backendFetch('/greeting')
      .then((r) => r.json())
      .then((data: { greeting: string | null }) => {
        pushBubble(data.greeting ?? fallback())
      })
      .catch(() => {
        pushBubble(fallback())
      })
  }, [pushBubble, emotion])

  const toggleQuickInput = useCallback(async () => {
    const state = await window.electronAPI.toggleQuickInput()
    setQiState(state)
    // QI 打开视为显式互动 → 通知后端刷新（临时拉向 busy）
    if (state.visible) {
      backendFetch('/emotion/interact', { method: 'POST' }).catch(() => {})
    }
  }, [])

  const handleQuickSend = useCallback(
    (text: string) => {
      sendMessage(text)
    },
    [sendMessage]
  )

  const handleBubbleDismiss = useCallback((id: number) => {
    bubbleDismissedAtRef.current = Date.now()
    setBubbles((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const handleMouseEnter = useCallback(() => {
    window.electronAPI.setIgnoreMouseEvents(false)
  }, [])

  const handleMouseLeave = useCallback(() => {
    if (!isDraggingRef.current) {
      window.electronAPI.setIgnoreMouseEvents(true)
    }
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.preventDefault()

      movedRef.current = false
      isDraggingRef.current = true
      window.electronAPI.dragStart()

      const onMove = (): void => {
        movedRef.current = true
        window.electronAPI.dragMove()
      }

      const onUp = (ev: MouseEvent): void => {
        window.electronAPI.dragEnd()
        isDraggingRef.current = false

        const rect = ballRef.current?.getBoundingClientRect()
        if (rect) {
          const isOver =
            ev.clientX >= rect.left &&
            ev.clientX <= rect.right &&
            ev.clientY >= rect.top &&
            ev.clientY <= rect.bottom
          if (!isOver) {
            window.electronAPI.setIgnoreMouseEvents(true)
          }
        }

        if (movedRef.current && isQiVisible) {
          // QI 展开态拖拽结束 → 重算方向
          window.electronAPI.repositionQuickInput().then((result) => {
            if (result) {
              setQiState({ visible: true, direction: result.direction })
            }
          })
        } else if (!movedRef.current) {
          if (isQiVisible) {
            // QI 展开态单击 → 收起
            toggleQuickInput()
          } else if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current)
            clickTimerRef.current = null
            toggleQuickInput()
          } else {
            clickTimerRef.current = setTimeout(() => {
              clickTimerRef.current = null
              handleSingleClick()
            }, 250)
          }
        }

        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        listenersRef.current = null
      }

      listenersRef.current = { onMove, onUp }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [isQiVisible, toggleQuickInput, handleSingleClick]
  )

  // ── 文件拖入处理 ──────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropCounterRef.current += 1
    if (e.dataTransfer.types.includes('Files')) {
      setDropActive(true)
      window.electronAPI.setIgnoreMouseEvents(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropCounterRef.current -= 1
    if (dropCounterRef.current <= 0) {
      dropCounterRef.current = 0
      setDropActive(false)
      if (!isDraggingRef.current) {
        window.electronAPI.setIgnoreMouseEvents(true)
      }
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dropCounterRef.current = 0
    setDropActive(false)

    const files = e.dataTransfer.files
    if (files.length === 0) return

    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      try {
        const p = window.electronAPI.getPathForFile(files[i])
        if (p) paths.push(p)
      } catch {
        // 跳过无法获取路径的文件
      }
    }
    if (paths.length === 0) return

    try {
      const attachments = await window.electronAPI.resolveDroppedFiles(paths)
      if (attachments.length > 0) {
        window.electronAPI.openPanelWithFiles(attachments)
      }
    } catch (err) {
      console.error('[FloatingBall] drop error:', err)
    }

    if (!isDraggingRef.current) {
      window.electronAPI.setIgnoreMouseEvents(true)
    }
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.electronAPI.showContextMenu()
  }, [])

  const expanded = isQiVisible
  const direction = qiState?.direction ?? 'left'

  // 计算 opacity 和 tail 方向
  const opacities = getBubbleOpacities(bubbles.length)
  const tailAlign: 'center' | 'left' | 'right' = expanded
    ? direction === 'left'
      ? 'right'
      : 'left'
    : 'center'

  return (
    <div
      className={`ball-root${expanded ? ` ball-root--expanded ball-root--${direction}` : ''}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="bubble-area">
        {bubbles.map((b, i) => (
          <ChatBubble
            key={b.id}
            message={b}
            duration={calcBubbleDuration(b.text)}
            opacity={opacities[i]}
            showTail={i === bubbles.length - 1}
            tailAlign={tailAlign}
            streaming={b.streaming}
            onDismiss={handleBubbleDismiss}
          />
        ))}
        {statusText && <div className="ball-status">{statusText}</div>}
      </div>
      <div className="bottom-section">
        {expanded && direction === 'left' && (
          <div className="qi-area">
            <QuickInput onSend={handleQuickSend} onClose={toggleQuickInput} />
          </div>
        )}
        <div
          ref={ballRef}
          className={`ball${dropActive ? ' ball--drop-active' : ''}`}
          data-emotion={emotion}
          onMouseDown={handleMouseDown}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onContextMenu={handleContextMenu}
          title="Claw 🐾"
        >
          <span className="ball__icon">🐾</span>
        </div>
        {expanded && direction === 'right' && (
          <div className="qi-area">
            <QuickInput onSend={handleQuickSend} onClose={toggleQuickInput} />
          </div>
        )}
      </div>
    </div>
  )
}
