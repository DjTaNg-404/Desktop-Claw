import Fastify from 'fastify'
import { setupWebSocket } from './gateway/ws'
import { setupCalendarRoutes } from './gateway/calendar'
import { setupPersonaRoutes } from './gateway/persona'
import { memoryService } from './memory/memory-service'
import { greetingService } from './memory/greeting-service'
import { initDataDir } from './paths'

export { initDataDir } from './paths'
export { copyInitialTemplates } from './paths'

const DEFAULT_PORT = 3721

export async function startBackend(options: { port?: number; dataDir?: string } = {}): Promise<{
  close: () => Promise<void>
  sealDay: () => Promise<void>
}> {
  const { port = DEFAULT_PORT, dataDir } = options
  if (dataDir) initDataDir(dataDir)

  const app = Fastify({ logger: false })

  // CORS: 允许 Electron 渲染进程（dev server）跨域访问 HTTP 路由
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Access-Control-Allow-Origin', '*')
    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Headers', 'Content-Type')
      return reply.status(204).send()
    }
  })

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // 注册 WebSocket 路由（必须在 listen 之前）
  await setupWebSocket(app)

  // 注册日历查询路由（B.8）
  await setupCalendarRoutes(app)

  // 注册人格信息路由
  await setupPersonaRoutes(app)

  await app.listen({ port, host: '127.0.0.1' })
  console.log(`[backend] Fastify listening on http://127.0.0.1:${port}`)
  console.log(`[backend] WebSocket ready on ws://127.0.0.1:${port}/ws`)

  // BOOT 行为：启动后异步执行（不阻塞服务就绪）
  // boot 完成后异步初始化互动语池（LLM 预生成）
  void memoryService.boot()
    .then(() => greetingService.init())
    .catch((err) => console.error('[backend] boot error:', err)
  )

  return {
    close: async () => {
      await app.close()
      console.log('[backend] server closed')
    },
    sealDay: async () => {
      await memoryService.sealDay()
    }
  }
}
