export interface BackendRuntimeConfig {
  httpBaseURL: string
  wsBaseURL: string
  authToken: string
}

let runtimePromise: Promise<BackendRuntimeConfig> | null = null

function getRuntime(): Promise<BackendRuntimeConfig> {
  if (!runtimePromise) {
    runtimePromise = window.electronAPI.getBackendRuntimeConfig()
  }
  return runtimePromise
}

function buildURL(baseURL: string, path: string): string {
  const normalizedBase = baseURL.endsWith('/') ? baseURL : `${baseURL}/`
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  return new URL(normalizedPath, normalizedBase).toString()
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const runtime = await getRuntime()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${runtime.authToken}`)

  return fetch(buildURL(runtime.httpBaseURL, path), {
    ...init,
    headers
  })
}

export async function getBackendWebSocketURL(path = '/ws'): Promise<string> {
  const runtime = await getRuntime()
  const url = new URL(buildURL(runtime.wsBaseURL, path))
  url.searchParams.set('token', runtime.authToken)
  return url.toString()
}
