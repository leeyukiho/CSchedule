import Taro from '@tarojs/taro'

import {
  CloudSyncFunctionConfig,
  DataTarget,
} from './types'

export interface CloudImportProof {
  version: 1
  source: 'frontend_cloud_import'
  schoolId: string
  providerId: string
  contextId: string
  targets: DataTarget[]
  resultHash: string
  issuedAt: string
  expiresAt: string
  signature: string
}

export interface CloudCredentialSyncRequest {
  schoolId: string
  providerId: string
  contextId: string
  targets: DataTarget[]
  username: string
  password: string
  semesterId?: string
  clientImportToken?: string
  cloudFunction?: CloudSyncFunctionConfig
}

export interface CloudCredentialCacheResult {
  target: DataTarget
  termId?: string
  cacheData: Record<string, unknown>
  parsedCount?: number
  sourceHash?: string
  syncedAt?: string
  warnings?: string[]
}

export interface CloudCredentialSyncResult {
  cacheResults: CloudCredentialCacheResult[]
  cloudProof?: CloudImportProof
}

interface CloudCredentialSyncResponse {
  ok?: boolean
  result?: CloudCredentialSyncResult
  data?: CloudCredentialSyncResult
  errorCode?: string
  errorMessage?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>

    for (const key of ['errMsg', 'message', 'errorMessage']) {
      const value = record[key]

      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
  }

  return String(error || '')
}

function unwrapCloudCredentialSyncResult(
  response: unknown,
): CloudCredentialSyncResult {
  const data = response && typeof response === 'object'
    ? (response as CloudCredentialSyncResponse)
    : {}

  if (data.ok === false || data.errorCode) {
    throw new Error(data.errorCode || data.errorMessage || 'CLOUD_SYNC_FAILED')
  }

  const result = (data.result || data.data || response) as CloudCredentialSyncResult

  if (!Array.isArray(result.cacheResults) || result.cacheResults.length === 0) {
    throw new Error('CLOUD_SYNC_EMPTY_RESULT')
  }

  const cacheResults = result.cacheResults.filter((item) => {
    return Boolean(
      item &&
        ['course', 'score', 'exam', 'profile'].includes(item.target) &&
        item.cacheData &&
        typeof item.cacheData === 'object' &&
        !Array.isArray(item.cacheData),
    )
  })

  if (cacheResults.length === 0) {
    throw new Error('CLOUD_SYNC_EMPTY_RESULT')
  }

  return {
    cacheResults,
    cloudProof: result.cloudProof,
  }
}

export function hasCloudCredentialSync(
  cloudFunction?: CloudSyncFunctionConfig,
  clientImportToken?: string,
) {
  return Boolean(cloudFunction?.url && clientImportToken)
}

export async function runCredentialSyncWithCloud(
  request: CloudCredentialSyncRequest,
): Promise<CloudCredentialSyncResult> {
  const { cloudFunction, clientImportToken, ...syncRequest } = request
  const syncUrl = cloudFunction?.url

  if (!syncUrl) {
    throw new Error('CLOUD_SYNC_FUNCTION_NOT_CONFIGURED')
  }

  if (!clientImportToken) {
    throw new Error('CLOUD_IMPORT_TOKEN_NOT_CONFIGURED')
  }

  let response: Taro.request.SuccessCallbackResult<
    CloudCredentialSyncResponse | CloudCredentialSyncResult
  >

  try {
    response = await Taro.request<
      CloudCredentialSyncResponse | CloudCredentialSyncResult
    >({
      url: syncUrl,
      method: 'POST',
      data: {
        source: 'frontend_cloud_import',
        ...syncRequest,
        clientImportToken,
      },
      timeout: 30000,
      header: {
        'content-type': 'application/json',
        'x-cschedule-client-import-token': clientImportToken,
      },
    })
  } catch (error) {
    throw new Error(getErrorMessage(error) || 'CLOUD_SYNC_REQUEST_FAILED')
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`CLOUD_SYNC_FAILED: ${response.statusCode}`)
  }

  return unwrapCloudCredentialSyncResult(response.data)
}
