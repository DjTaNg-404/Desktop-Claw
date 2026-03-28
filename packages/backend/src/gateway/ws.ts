import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import type { ChatMessageData } from '@desktop-claw/shared'
import { TaskCoordinator } from '../task-coordinator'
import { memoryService } from '../memory/memory-service'

/** 内存会话记录 — 启动时从当日 JSON 恢复 */
const conversation: ChatMessageData[] = memoryService.getTodayMessages()
const clients = new Set<WebSocket>()

/** 任务协调器：FIFO 串行队列 */
const coordinator = new TaskCoordinator(
  // getHistory：返回不含最后一条 user 消息的历史（agentLoop 内部会自己追加 prompt）
  () => conversation.slice(0, -1),
  // pushMessages：任务完成后追加本轮所有消息（tool_calls + tool_result + final assistant）
  (messages) => {
    conversation.push(...messages)
    memoryService.appendMessages(messages)
    // 异步触发摘要压缩检查（不阻塞当前任务完成）
    void memoryService.compressIfNeeded(conversation)
  }
)

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
        sendTo(socket, {
          id: genMsgId(),
          type: 'task.error',
          taskId: '',
          ts: new Date().toISOString(),
          payload: { code: 'INVALID_MESSAGE', message: '消息格式无效，请重试' }
        })
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
      memoryService.appendMessage({ role: 'user', content })

      // 广播 ack（附带 content 以便其他窗口同步用户消息）
      broadcast({
        id: genMsgId(),
        type: 'task.ack',
        taskId: msg.taskId,
        ts: new Date().toISOString(),
        payload: { content }
      })

      // 入队 Task Coordinator（串行执行）
      const accepted = coordinator.enqueue(msg.taskId, content, {
        onToken(delta) {
          broadcast({
            id: genMsgId(),
            type: 'task.token',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { delta }
          })
        },
        onStatus(text) {
          broadcast({
            id: genMsgId(),
            type: 'task.status',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { text }
          })
        },
        onDone(fullContent) {
          broadcast({
            id: genMsgId(),
            type: 'task.done',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { content: fullContent }
          })
        },
        onError(code, message) {
          broadcast({
            id: genMsgId(),
            type: 'task.error',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: { code, message }
          })
        },
        onCancelled() {
          broadcast({
            id: genMsgId(),
            type: 'task.cancelled',
            taskId: msg.taskId,
            ts: new Date().toISOString(),
            payload: {}
          })
        }
      })

      if (!accepted) {
        broadcast({
          id: genMsgId(),
          type: 'task.error',
          taskId: msg.taskId,
          ts: new Date().toISOString(),
          payload: { code: 'QUEUE_FULL', message: '任务队列已满，请稍后再试' }
        })
      }
      break
    }
    case 'task.cancel': {
      coordinator.cancel(msg.taskId)
      break
    }
    default:
      console.warn('[ws] unknown message type:', msg.type)
  }
}
