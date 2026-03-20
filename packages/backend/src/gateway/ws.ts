import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { ChatMessageData } from '@desktop-claw/shared'

/** 内存会话记录（MVP：单对话，无持久化） */
const conversation: ChatMessageData[] = []
const clients = new Set<WebSocket>()

let msgCounter = 0
function genMsgId(): string {
  return `msg_${Date.now()}_${++msgCounter}`
}

function sendTo(ws: WebSocket, envelope: object): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope))
  }
}

function broadcast(envelope: object): void {
  const data = JSON.stringify(envelope)
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(data)
    }
  }
}

/**
 * 注册 Fastify WebSocket 插件并设置 /ws 路由
 */
export async function setupWebSocket(app: FastifyInstance): Promise<void> {
  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket)
    console.log(`[ws] client connected (total: ${clients.size})`)

    // 新连接发送当前会话历史
    sendTo(socket, {
      id: genMsgId(),
      type: 'conversation.history',
      taskId: '',
      ts: new Date().toISOString(),
      payload: { messages: conversation }
    })

    socket.on('message', (raw: Buffer) => {
      try {
        const data = JSON.parse(raw.toString())
        handleClientMessage(data)
      } catch {
        console.error('[ws] failed to parse message')
      }
    })

    socket.on('close', () => {
      clients.delete(socket)
      console.log(`[ws] client disconnected (total: ${clients.size})`)
    })
  })
}

function handleClientMessage(
  msg: { type: string; taskId: string; payload?: Record<string, unknown> }
): void {
  switch (msg.type) {
    case 'task.create': {
      const content = (msg.payload?.content as string) ?? ''

      // 记录用户消息
      conversation.push({ role: 'user', content })

      // 广播 ack（附带 content 以便其他窗口同步用户消息）
      broadcast({
        id: genMsgId(),
        type: 'task.ack',
        taskId: msg.taskId,
        ts: new Date().toISOString(),
        payload: { content }
      })

      // Echo 模式：延迟返回以模拟 AI 思考
      const echoContent = `收到「${content}」🐾`
      setTimeout(() => {
        conversation.push({ role: 'assistant', content: echoContent })
        broadcast({
          id: genMsgId(),
          type: 'task.done',
          taskId: msg.taskId,
          ts: new Date().toISOString(),
          payload: { content: echoContent }
        })
      }, 300)
      break
    }
    case 'task.cancel': {
      broadcast({
        id: genMsgId(),
        type: 'task.cancelled',
        taskId: msg.taskId,
        ts: new Date().toISOString(),
        payload: {}
      })
      break
    }
    default:
      console.warn('[ws] unknown message type:', msg.type)
  }
}
