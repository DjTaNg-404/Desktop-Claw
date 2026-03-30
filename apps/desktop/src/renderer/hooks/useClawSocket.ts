import { useState, useEffect, useRef, useCallback } from 'react'
import { getBackendWebSocketURL } from '../lib/backend-client'

/** 指数退避重连参数 */
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

/** 流式 token watchdog：15s 无 token 视为中断 */
const TOKEN_WATCHDOG_MS = 15_000

export type ConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface WsEnvelope {
  id: string
  type: string
  taskId: string
  ts: string
  payload: Record<string, unknown>
}

let localMsgId = 0
function nextMsgId(): number {
  return ++localMsgId
}

let taskCounter = 0
function genTaskId(): string {
  return `task_${Date.now()}_${++taskCounter}`
}

export function useClawSocket(): {
  connectionState: ConnectionState
  messages: ChatMessage[]
  statusText: string
  sendMessage: (content: string) => void
} {
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [statusText, setStatusText] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectAttempt = useRef(0)
  /** 当前退避延迟（ms），每次重连失败翻倍，成功后重置 */
  const reconnectDelay = useRef(RECONNECT_BASE_MS)
  /** 记录本客户端发起的 taskId，用于 ack 时去重用户消息 */
  const sentTaskIds = useRef(new Set<string>())
  /** 流式 token watchdog 计时器 */
  const watchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 当前正在流式处理的 taskId（用于超时时发 cancel） */
  const activeTaskId = useRef<string | null>(null)

  const clearWatchdog = useCallback(() => {
    if (watchdogTimer.current) {
      clearTimeout(watchdogTimer.current)
      watchdogTimer.current = null
    }
    activeTaskId.current = null
  }, [])

  const resetWatchdog = useCallback(() => {
    if (watchdogTimer.current) clearTimeout(watchdogTimer.current)
    watchdogTimer.current = setTimeout(() => {
      console.warn('[ws] token watchdog timeout, cancelling task')
      // 发送 cancel
      const ws = wsRef.current
      const taskId = activeTaskId.current
      if (ws && ws.readyState === WebSocket.OPEN && taskId) {
        ws.send(JSON.stringify({
          id: `cli_${Date.now()}_wd`,
          type: 'task.cancel',
          taskId,
          ts: new Date().toISOString(),
          payload: {}
        }))
      }
      // 降级显示
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.streaming) {
          updated[updated.length - 1] = {
            ...last,
            content: last.content
              ? last.content + '\n\n⚠️ 回复中断，请重试'
              : '⚠️ 回复中断，请重试',
            streaming: false
          }
        }
        return updated
      })
      clearWatchdog()
    }, TOKEN_WATCHDOG_MS)
  }, [clearWatchdog])

  const handleEnvelope = useCallback((envelope: WsEnvelope) => {
    switch (envelope.type) {
      case 'conversation.history': {
        const msgs = (envelope.payload.messages as Array<{ role: string; content: string; tool_calls?: unknown[] }>) ?? []
        setMessages(
          msgs
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls)
            .map((m) => ({
              id: nextMsgId(),
              role: m.role as 'user' | 'assistant',
              content: m.content
            }))
        )
        break
      }

      case 'task.ack': {
        const content = envelope.payload.content as string | undefined
        if (content !== undefined) {
          setMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content }])
        }
        // 添加"正在思考"的 AI 占位消息
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: 'assistant', content: '', streaming: true }
        ])
        // 启动 watchdog
        activeTaskId.current = envelope.taskId
        resetWatchdog()
        break
      }

      case 'task.status': {
        const text = (envelope.payload.text as string) ?? ''
        setStatusText(text)
        resetWatchdog()
        break
      }

      case 'task.token': {
        const delta = (envelope.payload.delta as string) ?? ''
        setStatusText('')
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, content: last.content + delta }
          }
          return updated
        })
        // 收到 token，重置 watchdog
        resetWatchdog()
        break
      }

      case 'task.done': {
        const content = (envelope.payload.content as string) ?? ''
        setStatusText('')
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, content, streaming: false }
          } else {
            updated.push({ id: nextMsgId(), role: 'assistant', content })
          }
          return updated
        })
        // 清理已完成的 taskId
        sentTaskIds.current.delete(envelope.taskId)
        clearWatchdog()
        break
      }

      case 'task.error': {
        const message = (envelope.payload.message as string) ?? '出错了'
        setStatusText('')
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = {
              ...last,
              content: `⚠️ ${message}`,
              streaming: false
            }
          } else {
            updated.push({ id: nextMsgId(), role: 'assistant', content: `⚠️ ${message}` })
          }
          return updated
        })
        sentTaskIds.current.delete(envelope.taskId)
        clearWatchdog()
        break
      }

      case 'task.cancelled': {
        setStatusText('')
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, content: '（已取消）', streaming: false }
          }
          return updated
        })
        sentTaskIds.current.delete(envelope.taskId)
        clearWatchdog()
        break
      }
    }
  }, [resetWatchdog, clearWatchdog])

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) return

    setConnectionState('connecting')
    const attemptId = ++connectAttempt.current

    void getBackendWebSocketURL()
      .then((wsURL) => {
        if (attemptId !== connectAttempt.current) return
        if (
          wsRef.current &&
          (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
        ) return

        const ws = new WebSocket(wsURL)
        wsRef.current = ws

        ws.onopen = (): void => {
          console.log('[ws] connected')
          setConnectionState('connected')
          reconnectDelay.current = RECONNECT_BASE_MS
        }

        ws.onmessage = (event: MessageEvent): void => {
          try {
            const envelope: WsEnvelope = JSON.parse(event.data as string)
            handleEnvelope(envelope)
          } catch {
            console.error('[ws] failed to parse message')
          }
        }

        ws.onclose = (): void => {
          console.log('[ws] disconnected')
          setConnectionState('disconnected')
          if (wsRef.current === ws) {
            wsRef.current = null
            const delay = reconnectDelay.current
            console.log(`[ws] reconnecting in ${delay}ms`)
            reconnectTimer.current = setTimeout(connect, delay)
            reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX_MS)
          }
        }

        ws.onerror = (): void => {
          // onclose 会紧随触发，在那里处理重连
        }
      })
      .catch((err) => {
        console.error('[ws] failed to resolve runtime config:', err)
        setConnectionState('disconnected')
        const delay = reconnectDelay.current
        reconnectTimer.current = setTimeout(connect, delay)
        reconnectDelay.current = Math.min(delay * 2, RECONNECT_MAX_MS)
      })
  }, [handleEnvelope])

  useEffect(() => {
    connect()
    return () => {
      connectAttempt.current += 1
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current)
        reconnectTimer.current = null
      }
      // 清理 watchdog
      clearWatchdog()
      // 先置空 ref 再 close，确保 onclose 不会重连
      const ws = wsRef.current
      wsRef.current = null
      ws?.close()
    }
  }, [connect])

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const taskId = genTaskId()
    sentTaskIds.current.add(taskId)

    ws.send(
      JSON.stringify({
        id: `cli_${Date.now()}_${taskCounter}`,
        type: 'task.create',
        taskId,
        ts: new Date().toISOString(),
        payload: { content }
      })
    )
  }, [])

  return { connectionState, messages, statusText, sendMessage }
}
