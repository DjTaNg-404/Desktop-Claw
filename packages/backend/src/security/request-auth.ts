export interface BackendAccessConfig {
  authToken?: string
  allowedOrigins: string[]
}

function normalizeOrigin(origin: string): string | null {
  if (origin === 'null' || origin === 'file://') return origin

  try {
    return new URL(origin).origin
  } catch {
    return null
  }
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true

  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  return allowedOrigins.includes(normalized)
}

export function getRequestToken(
  authorization: string | undefined,
  rawUrl: string | undefined
): string | null {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (bearer) return bearer

  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl, 'http://127.0.0.1')
    const token = url.searchParams.get('token')
    return token?.trim() || null
  } catch {
    return null
  }
}

export function isAuthorizedToken(
  token: string | null,
  authToken: string | undefined
): boolean {
  if (!authToken) return true
  return token === authToken
}

export function buildCorsOrigin(origin: string | undefined): string | null {
  if (!origin) return null
  if (origin === 'file://') return 'null'
  return origin
}
