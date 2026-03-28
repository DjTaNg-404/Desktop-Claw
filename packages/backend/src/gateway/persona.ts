import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { greetingService } from '../memory/greeting-service'
import { getPersonaDir } from '../paths'

function readPersonaFile(filename: string): string | null {
  const filePath = join(getPersonaDir(), filename)
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
}

export async function setupPersonaRoutes(app: FastifyInstance): Promise<void> {
  // GET /persona — 返回三个人格文件的原始内容
  app.get('/persona', async () => {
    return {
      soul: readPersonaFile('SOUL.md'),
      user: readPersonaFile('USER.md'),
      context: readPersonaFile('CONTEXT.md')
    }
  })

  // GET /greeting — 取一条 LLM 生成的互动语
  app.get('/greeting', async () => {
    return { greeting: greetingService.take() }
  })
}
