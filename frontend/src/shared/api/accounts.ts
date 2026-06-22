import { requestApi } from './client'
import { StudentAccountSummary } from './types'
import { getStoredAccountSummary, setStoredAccountSummary } from '../storage'

interface AccountCacheOptions {
  forceRefresh?: boolean
}

function normalizeAccount(response: StudentAccountSummary): StudentAccountSummary {
  return {
    ...response,
    school: response.school && typeof response.school === 'object' && !Array.isArray(response.school)
      ? response.school
      : undefined,
  }
}

export async function getAccount(
  accountId: string,
  options: AccountCacheOptions = {},
) {
  const cached = getStoredAccountSummary(accountId)

  if (!options.forceRefresh && cached) {
    return cached
  }

  if (!options.forceRefresh) {
    throw new Error('CACHE_NOT_READY')
  }

  const response = await requestApi<StudentAccountSummary>({
    path: `/account/${encodeURIComponent(accountId)}`,
  })

  const account = normalizeAccount(response)
  setStoredAccountSummary(account)

  return account
}

export function deactivateAccount(accountId: string) {
  return requestApi<{ success: boolean }>({
    method: 'DELETE',
    path: `/account/${encodeURIComponent(accountId)}`,
  })
}
