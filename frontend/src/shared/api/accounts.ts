import { requestApi } from './client'
import { StudentAccountSummary } from './types'

function normalizeAccount(response: StudentAccountSummary): StudentAccountSummary {
  return {
    ...response,
    school: response.school && typeof response.school === 'object' && !Array.isArray(response.school)
      ? response.school
      : undefined,
  }
}

export function listAccounts() {
  return requestApi<StudentAccountSummary[]>({
    path: '/account',
  })
}

export async function getAccount(accountId: string) {
  const response = await requestApi<StudentAccountSummary>({
    path: `/account/${encodeURIComponent(accountId)}`,
  })

  return normalizeAccount(response)
}

export function deactivateAccount(accountId: string) {
  return requestApi<{ success: boolean }>({
    method: 'DELETE',
    path: `/account/${encodeURIComponent(accountId)}`,
  })
}
