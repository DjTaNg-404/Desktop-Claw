/** WebSocket 消息信封 per ARCHITECTURE.md §6.2 */
export interface WsEnvelope {
  id: string
  type: WsMessageType
  taskId: string
  ts: string
  payload: Record<string, unknown>
}

/** Client → Server */
export type ClientMessageType = 'task.create' | 'task.cancel'

/** Server → Client */
export type ServerMessageType =
  | 'task.ack'
  | 'task.token'
  | 'task.done'
  | 'task.error'
  | 'task.cancelled'
  | 'conversation.history'

export type WsMessageType = ClientMessageType | ServerMessageType

/** Payload 类型定义 */
export interface TaskCreatePayload { content: string }
export interface TaskAckPayload { content: string }
export interface TaskTokenPayload { delta: string }
export interface TaskDonePayload { content: string }
export interface TaskErrorPayload { code: string; message: string }

export interface ChatMessageData {
  role: 'user' | 'assistant'
  content: string
}

export interface ConversationHistoryPayload {
  messages: ChatMessageData[]
}
