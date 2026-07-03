export type QrcodeLoginStatus =
  | 'pending'
  | 'scanned'
  | 'confirmed'
  | 'expired'
  | 'failed'
  | 'cancelled'

export interface QrcodeLoginDescriptor {
  enabled: boolean
  title?: string
  notice?: string
  expiresInSeconds: number
  pollIntervalMs: number
}

export interface QrcodeLoginCreateResponse {
  sessionId: string
  status: QrcodeLoginStatus
  qrcodeImage?: string
  qrcodeUrl?: string
  expiresAt: string
  pollIntervalMs: number
  title?: string
  notice?: string
}

export interface QrcodeLoginStatusResponse {
  sessionId: string
  status: QrcodeLoginStatus
  expiresAt: string
  message?: string
  confirmedAt?: string
}

export interface QrcodeLoginConfig {
  enabled?: boolean
  title?: string
  notice?: string
  expiresInSeconds?: number
  pollIntervalMs?: number
  create?: {
    url?: string
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: unknown
    qrcodeImagePath?: string
    qrcodeUrlPath?: string
    qrcodeKeyPath?: string
  }
  poll?: {
    url?: string
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: unknown
    statusPath?: string
    successValues?: string[]
    scannedValues?: string[]
    pendingValues?: string[]
    expiredValues?: string[]
    failedValues?: string[]
    sessionPath?: string
  }
}
