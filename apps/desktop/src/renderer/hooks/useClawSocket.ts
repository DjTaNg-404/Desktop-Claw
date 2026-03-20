import { useState, useEffect, useRef, useCallback } from 'react'

const WS_URL = 'ws://127.0.0.1:3721/ws'

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
  connected: boolean
  messages: ChatMessage[]
  sendMessage: (content: string) => void
} {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 记录本客户端发起的 taskId，用于 ack 时去重用户消息 */
  const sentTaskIds = useRef(new Set<string>())

  const handleEnvelope = useCallback((envelope: WsEnvelope) => {
    switch (envelope.type) {
      case 'conversation.history': {
        const msgs = (envelope.payload.messages as Array<{ role: string; content: string }>) ?? []
        setMessages(
          msgs.map((m) => ({
            id: nextMsgId(),
            role: m.role as 'user' | 'assistant',
            content: m.content
          }))
        )
        break
      }

      case 'task.ack': {
        const content = envelope.payload.content as string | undefined
        // 如果是其他窗口发起的任务，补充用户消息
        if (!sentTaskIds.current.has(envelope.taskId) && content !== undefined) {
          setMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content }])
        }
        // 添加"正在思考"的 AI 占位消息
        setMessages((prev) => [
          ...prev,
          { id: nextMsgId(), role: 'assistant', content: '', streaming: true }
        ])
        break
      }

      case 'task.token': {
        const delta = (envelope.payload.delta as string) ?? ''
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, content: last.content + delta }
          }
          return updated
        })
        break
      }

      case 'task.done': {
        const content = (envelope.payload.content as string) ?? ''
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
        break
      }

      case 'task.error': {
        const message = (envelope.payload.message as string) ?? '出错了'
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = {
              ...last,
              content: `⚠️ ${message}`,
              streaming: false
            }
          }
          return updated
        })
        sentTaskIds.current.delete(envelope.taskId)
        break
      }

      case 'task.cancelled': {
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.streaming) {
            updated[updated.length - 1] = { ...last, content: '（已取消）', streaming: false }
          }
          return updated
        })
        sentTaskIds.current.delete(envelope.taskId)
        break
      }
    }
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = (): void => {
      console.log('[ws] connected')
      setConnected(true)
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
      setConnected(false)
      wsRef.current = null
      reconnectTimer.current = setTimeout(connect, 1000)
    }

    ws.onerror = (): void => {
      // onclose 会紧随触发，在那里处理重连
    }
  }, [handleEnvelope])

  useEffect(() => {
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const sendMessage = useCallback((content: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    const taskId = genTaskId()
    sentTaskIds.current.add(taskId)

    // 乐观更新：立即显示用户消息
    setMessages((prev) => [...prev, { id: nextMsgId(), role: 'user', content }])

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

  return { connected, messages, sendMessage }
}
