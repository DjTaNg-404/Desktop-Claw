import { existsSync, readFileSync } from 'fs'
import { getConfigPath } from '../paths'

export interface LLMConfig {
  apiKey: string
  baseURL: string
  model: string
  /** 模型上下文窗口大小（token 数），用于裁剪预算计算。默认 64000 */
  contextWindow: number
}

/**
 * 从 config.json 读取 LLM 配置
 * 路径由 paths.ts 统一管理（dev → 项目内 data/config.json, prod → Application Support）
 */
export function loadLLMConfig(): LLMConfig | null {
  const configPath = getConfigPath()

  if (existsSync(configPath)) {
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (raw?.llm?.apiKey) {
        return {
          apiKey: raw.llm.apiKey,
          baseURL: raw.llm.baseURL || 'https://api.openai.com/v1',
          model: raw.llm.model || 'gpt-4o',
          contextWindow: raw.llm.contextWindow || 115000
        }
      }
    } catch {
      console.error(`[llm] failed to parse config at ${configPath}`)
    }
  }

  return null
}
