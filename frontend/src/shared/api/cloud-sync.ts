import Taro from '@tarojs/taro'

import {
  CloudSyncFunctionConfig,
  DataTarget,
} from './types'

export interface CloudCredentialSyncRequest {
  schoolId: string
  providerId: string
  targets: DataTarget[]
  username: string
  password: string
  semesterId?: string
  source?: 'frontend_first_import' | 'backend_auto_sync'
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
}

interface CloudCredentialSyncResponse {
  ok?: boolean
  result?: CloudCredentialSyncResult
  data?: CloudCredentialSyncResult
  errorCode?: string
  errorMessage?: string
}

let cloudInitialized = false

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

function getCloudApi() {
  const cloud = (Taro as unknown as { cloud?: unknown }).cloud

  return cloud && typeof cloud === 'object'
    ? (cloud as {
        init?: (options: { env: string }) => void
        callFunction?: (options: {
          name: string
          data: Omit<CloudCredentialSyncRequest, 'cloudFunction'>
        }) => Promise<{
          result?: CloudCredentialSyncResponse | CloudCredentialSyncResult
        }>
      })
    : null
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

  return { cacheResults }
}

export function hasCloudCredentialSync(cloudFunction?: CloudSyncFunctionConfig) {
  return Boolean(
    cloudFunction?.url ||
      (cloudFunction?.functionName &&
        process.env.TARO_APP_CLOUDBASE_ENV_ID &&
        getCloudApi()?.callFunction),
  )
}

export async function runCredentialSyncWithCloud(
  request: CloudCredentialSyncRequest,
): Promise<CloudCredentialSyncResult> {
  const { cloudFunction, ...syncRequest } = request
  const payload = {
    source: 'frontend_first_import' as const,
    ...syncRequest,
  }
  const syncUrl = cloudFunction?.url
  const envId = process.env.TARO_APP_CLOUDBASE_ENV_ID
  const cloud = getCloudApi()

  if (cloudFunction?.functionName && envId && cloud?.callFunction) {
    if (!cloudInitialized) {
      cloud.init?.({ env: envId })
      cloudInitialized = true
    }

    try {
      const response = await cloud.callFunction({
        name: cloudFunction.functionName,
        data: payload,
      })

      return unwrapCloudCredentialSyncResult(response.result)
    } catch (error) {
      if (!syncUrl) {
        throw new Error(getErrorMessage(error) || 'CLOUD_SYNC_CALL_FAILED')
      }
    }
  }

  if (syncUrl) {
    let response: Taro.request.SuccessCallbackResult<
      CloudCredentialSyncResponse | CloudCredentialSyncResult
    >

    try {
      response = await Taro.request<
        CloudCredentialSyncResponse | CloudCredentialSyncResult
      >({
        url: syncUrl,
        method: 'POST',
        data: payload,
        timeout: 20000,
        header: { 'content-type': 'application/json' },
      })
    } catch (error) {
      throw new Error(getErrorMessage(error) || 'CLOUD_SYNC_REQUEST_FAILED')
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`CLOUD_SYNC_FAILED: ${response.statusCode}`)
    }

    return unwrapCloudCredentialSyncResult(response.data)
  }

  if (!cloudFunction?.functionName) {
    throw new Error('CLOUD_SYNC_FUNCTION_NOT_CONFIGURED')
  }

  if (!envId || !cloud?.callFunction) {
    throw new Error('CLOUD_SYNC_NOT_CONFIGURED')
  }

  if (!cloudInitialized) {
    cloud.init?.({ env: envId })
    cloudInitialized = true
  }

  const response = await cloud.callFunction({
    name: cloudFunction.functionName,
    data: payload,
  })

  return unwrapCloudCredentialSyncResult(response.result)
}
