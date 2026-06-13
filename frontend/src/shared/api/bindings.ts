import { requestApi } from './client'
import { BindingSummary } from './types'

export function listBindings(userId?: string) {
  const query = userId ? `?userId=${encodeURIComponent(userId)}` : ''

  return requestApi<BindingSummary[]>({
    path: `/bindings${query}`,
  })
}

export function getBinding(bindingId: string) {
  return requestApi<BindingSummary>({
    path: `/bindings/${encodeURIComponent(bindingId)}`,
  })
}

export function unbind(bindingId: string) {
  return requestApi<{ success: boolean }>({
    method: 'DELETE',
    path: `/bindings/${encodeURIComponent(bindingId)}`,
  })
}

