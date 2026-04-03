import Fastify from 'fastify'
import { setupWebSocket } from './gateway/ws'
import { setupCalendarRoutes } from './gateway/calendar'
import { setupPersonaRoutes } from './gateway/persona'
import { setupEmotionRoutes } from './gateway/emotion'
import { memoryService } from './memory/memory-service'
import { greetingService } from './memory/greeting-service'
import { emotionService } from './memory/emotion-service'
import { initDataDir } from './paths'
import {
  buildCorsOrigin,
  getRequestToken,
  isAllowedOrigin,
  isAuthorizedToken,
  type BackendAccessConfig
} from './security/request-auth'

export { initDataDir } from './paths'
export { copyInitialTemplates } from './paths'

const DEFAULT_PORT = 3721

export async function startBackend(options: {
  port?: number
  dataDir?: string
  authToken?: string
  allowedOrigins?: string[]
} = {}): Promise<{
  close: () => Promise<void>
  sealDay: () => Promise<void>
}> {
  const { port = DEFAULT_PORT, dataDir, authToken, allowedOrigins = [] } = options
  if (dataDir) initDataDir(dataDir)

  const app = Fastify({ logger: false })
  const accessConfig: BackendAccessConfig = { authToken, allowedOrigins }

  // 仅允许 Desktop-Claw 自己的渲染进程跨域访问本地后端。
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    const corsOrigin = buildCorsOrigin(origin)
    const originAllowed = isAllowedOrigin(origin, accessConfig.allowedOrigins)

    if (origin && !originAllowed) {
      return reply.status(403).send({ error: 'FORBIDDEN_ORIGIN' })
    }

    if (corsOrigin && originAllowed) {
      reply.header('Access-Control-Allow-Origin', corsOrigin)
      reply.header('Vary', 'Origin')
    }

    reply.header('Access-Control-Allow-Methods', 'GET, OPTIONS')
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    if (request.method === 'OPTIONS') {
      return reply.status(204).send()
    }

    if (request.raw.url?.startsWith('/health')) return

    const token = getRequestToken(request.headers.authorization, request.raw.url)
    if (!isAuthorizedToken(token, accessConfig.authToken)) {
      return reply.status(401).send({ error: 'UNAUTHORIZED' })
    }
  })

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // 注册 WebSocket 路由（必须在 listen 之前）
  await setupWebSocket(app, accessConfig)

  // 注册日历查询路由（B.8）
  await setupCalendarRoutes(app)

  // 注册人格信息路由
  await setupPersonaRoutes(app)

  // 注册情绪状态路由
  await setupEmotionRoutes(app)

  await app.listen({ port, host: '127.0.0.1' })
  console.log(`[backend] Fastify listening on http://127.0.0.1:${port}`)
  console.log(`[backend] WebSocket ready on ws://127.0.0.1:${port}/ws`)
  console.log(`[backend] allowed renderer origins: ${allowedOrigins.join(', ') || '(originless only)'}`)

  // BOOT 行为：启动后异步执行（不阻塞服务就绪）
  // boot 完成后异步初始化互动语池（LLM 预生成）
  emotionService.start()
  void memoryService.boot()
    .then(() => greetingService.init())
    .catch((err) => console.error('[backend] boot error:', err)
  )

  return {
    close: async () => {
      emotionService.stop()
      await app.close()
      console.log('[backend] server closed')
    },
    sealDay: async () => {
      await memoryService.sealDay()
    }
  }
}
