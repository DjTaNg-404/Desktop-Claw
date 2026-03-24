import type { ChatMessageData, ToolCall } from '@desktop-claw/shared'
import { streamChat } from '../llm/client'
import { SkillManager } from './skill-manager'

/** Agent Loop 最大迭代回合数（防死循环） */
const MAX_STEPS = 10

/** 上下文保留最大轮数（user+assistant 算一轮） */
const MAX_HISTORY_TURNS = 10

/** System Prompt — 基础人格，Skill 指南会追加在后面 */
const BASE_SYSTEM_PROMPT =
  '你是 Claw 🐾，一个住在用户桌面上的 AI 桌宠伙伴。你友好、简洁、有趣，偶尔带点俏皮。用中文回复。'

/** 全局 SkillManager 单例（首次调用时初始化） */
let skillManager: SkillManager | null = null

async function getSkillManager(): Promise<SkillManager> {
  if (!skillManager) {
    skillManager = new SkillManager()
    await skillManager.load()
  }
  return skillManager
}

export interface AgentLoopParams {
  /** 用户当前输入 */
  prompt: string
  /** 对话历史 */
  history: ChatMessageData[]
  /** 流式 token 回调 */
  onToken: (delta: string) => void
  /** 最终完成回调（附带本轮 ReAct 循环产生的全部新消息） */
  onDone: (fullContent: string, newMessages: ChatMessageData[]) => void
  /** 错误回调 */
  onError: (code: string, message: string) => void
  /** 取消信号 */
  signal?: AbortSignal
}

/**
 * 裁剪历史：保留最近 N 轮对话（user+assistant 成对计算）
 * 始终保留完整的 pair，不会切到一半
 */
function trimHistory(history: ChatMessageData[], maxTurns: number): ChatMessageData[] {
  if (history.length === 0) return []

  // 从后往前数 turn：每遇到一个 user 消息算一轮
  let turns = 0
  let cutIndex = history.length

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      turns++
      if (turns > maxTurns) {
        cutIndex = i + 1
        break
      }
    }
    cutIndex = i
  }

  return history.slice(cutIndex)
}

/**
 * Agent Loop（ReAct-like 执行循环）
 *
 * MVP 阶段：无工具，循环只跑一圈（LLM 直接返回文本）。
 * 后续 A.6 加入 tools 后，循环会在 tool_calls ↔ tool_result 间多轮迭代。
 *
 * @returns AbortController 用于外部取消
 */
export function agentLoop(params: AgentLoopParams): AbortController {
  const controller = new AbortController()

  // 如果外部传了 signal，监听其 abort 事件
  if (params.signal) {
    if (params.signal.aborted) {
      controller.abort()
    } else {
      params.signal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }

  void _runLoop(params, controller)

  return controller
}

async function _runLoop(
  { prompt, history, onToken, onDone, onError }: AgentLoopParams,
  controller: AbortController
): Promise<void> {
  // 0. 加载 SkillManager
  const sm = await getSkillManager()

  // 1. 裁剪历史
  const trimmed = trimHistory(history, MAX_HISTORY_TURNS)

  // 2. 组装内部 messages 数组
  //    当前 prompt 不在 history 里，单独追加为最后一条 user 消息
  const messages: ChatMessageData[] = [...trimmed, { role: 'user', content: prompt }]

  // 记录初始长度，循环结束后 messages.slice(baseLen) 即为本轮新增消息
  const baseLen = messages.length

  // 3. ReAct 循环
  for (let step = 0; step < MAX_STEPS; step++) {
    if (controller.signal.aborted) {
      onError('CANCELLED', '任务已取消')
      return
    }

    // ★ 每轮重新组装 system prompt 和 tools（因为 activate_skill 会改变可用内容）
    const systemPrompt =
      BASE_SYSTEM_PROMPT + sm.getDiscoveryPrompt() + sm.getActiveSkillPrompt()
    const toolSchemas = sm.getActiveToolSchemas()

    // 调用 LLM
    const result = await callLLM(messages, onToken, controller, systemPrompt, toolSchemas)

    if (result.error) {
      onError(result.error.code, result.error.message)
      return
    }

    // 如果 LLM 返回了 tool_calls → 执行工具 → 追加结果 → 继续循环
    if (result.toolCalls && result.toolCalls.length > 0) {
      // 追加 assistant 的 tool_calls 消息到 messages
      messages.push({
        role: 'assistant',
        content: result.content || '',
        tool_calls: result.toolCalls
      })

      // 逐个执行 tool，追加 tool result
      for (const tc of result.toolCalls) {
        let toolName: string
        let toolArgs: Record<string, unknown>

        try {
          toolName = tc.function.name
          toolArgs = JSON.parse(tc.function.arguments)
        } catch {
          // JSON 解析失败
          messages.push({
            role: 'tool',
            content: `参数解析失败: ${tc.function.arguments}`,
            tool_call_id: tc.id
          })
          continue
        }

        const toolResult = await sm.executeTool(toolName, toolArgs)

        messages.push({
          role: 'tool',
          content: toolResult.success
            ? toolResult.content
            : `错误: ${toolResult.error ?? '未知错误'}`,
          tool_call_id: tc.id
        })
      }

      // 继续下一轮迭代（让 LLM 看到 tool 结果后继续思考）
      continue
    }

    // LLM 返回纯文本 → 结束循环
    if (result.content) {
      // 将最终 assistant 消息也加入 messages，再一并传出
      messages.push({ role: 'assistant', content: result.content })
      onDone(result.content, messages.slice(baseLen))
      return
    }

    // 安全兜底：LLM 返回了空内容
    onError('EMPTY_RESPONSE', 'LLM 返回了空内容')
    return
  }

  // 超过最大回合数
  onError('MAX_STEPS', `Agent Loop 达到最大回合数 (${MAX_STEPS})`)
}

// ─── LLM 调用封装 ─────────────────────────────────

interface LLMResult {
  content: string | null
  toolCalls: ToolCall[] | null
  error: { code: string; message: string } | null
}

/**
 * 将 streamChat 包装为 Promise，收集完整文本或 tool_calls
 * 同时通过 onToken 实时分发 delta
 */
function callLLM(
  messages: ChatMessageData[],
  onToken: (delta: string) => void,
  controller: AbortController,
  systemPrompt: string,
  tools: import('@desktop-claw/shared').ToolSchema[]
): Promise<LLMResult> {
  return new Promise((resolve) => {
    const abort = streamChat(
      messages,
      {
        onToken(delta) {
          onToken(delta)
        },
        onDone(fullContent) {
          resolve({ content: fullContent, toolCalls: null, error: null })
        },
        onError(code, message) {
          resolve({ content: null, toolCalls: null, error: { code, message } })
        },
        onToolCalls(toolCalls) {
          resolve({ content: null, toolCalls, error: null })
        }
      },
      {
        systemPrompt,
        tools: tools.length > 0 ? tools : undefined
      }
    )

    // 关联取消：agentLoop 的 controller abort 时，也 abort LLM 请求
    controller.signal.addEventListener('abort', () => abort.abort(), { once: true })
  })
}
