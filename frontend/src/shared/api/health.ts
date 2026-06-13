import { requestApi } from './client'

export interface HealthResponse {
  status: string
  service: string
  database: string
  timestamp: string
}

export function getHealth() {
  return requestApi<HealthResponse>({
    path: '/health',
  })
}
