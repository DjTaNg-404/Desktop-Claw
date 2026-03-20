import Fastify from 'fastify'
import { setupWebSocket } from './gateway/ws'

const DEFAULT_PORT = 3721

export async function startBackend(port = DEFAULT_PORT): Promise<{ close: () => Promise<void> }> {
  const app = Fastify({ logger: false })

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // 注册 WebSocket 路由（必须在 listen 之前）
  await setupWebSocket(app)

  await app.listen({ port, host: '127.0.0.1' })
  console.log(`[backend] Fastify listening on http://127.0.0.1:${port}`)
  console.log(`[backend] WebSocket ready on ws://127.0.0.1:${port}/ws`)

  return {
    close: async () => {
      await app.close()
      console.log('[backend] server closed')
    }
  }
}
