import { Request } from 'express'

const TRUST_PROXY_HEADERS =
  process.env.TRUST_PROXY_HEADERS === 'true' ||
  process.env.TRUST_PROXY_HEADERS === '1'

export function getRequestClientIp(request: Request) {
  const directIp = normalizeIp(request.ip || request.socket.remoteAddress)

  if (!TRUST_PROXY_HEADERS) {
    return directIp
  }

  return getHeaderIp(request, 'x-forwarded-for') || getHeaderIp(request, 'x-real-ip') || directIp
}

function getHeaderIp(request: Request, headerName: string) {
  const value = request.headers[headerName]
  const firstValue = Array.isArray(value) ? value[0] : value?.split(',')[0]

  return normalizeIp(firstValue)
}

function normalizeIp(value: unknown) {
  const text = String(value || '').trim()

  if (!text) {
    return 'unknown'
  }

  return text.replace(/^::ffff:/, '')
}
