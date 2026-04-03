import type { FastifyInstance } from 'fastify'
import { emotionService } from '../memory/emotion-service'

/**
 * GET  /emotion          → 返回当前 EmotionSnapshot
 * POST /emotion/interact → 前端主动交互信号（如打开 QuickInput）
 */
export async function setupEmotionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/emotion', async () => {
    return emotionService.getSnapshot()
  })

  app.post('/emotion/interact', async () => {
    emotionService.notifyUserMessage()
    return { ok: true }
  })
}
