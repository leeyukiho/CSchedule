import Taro from '@tarojs/taro'

import {
  DataTarget,
  FeatureCacheResponse,
  TimetableCacheResponse,
} from './types'

export interface RawPayloadEnvelope {
  schoolId: string
  providerId: string
  target: DataTarget
  contentType: 'json' | 'html' | 'text' | 'csv' | 'xlsx' | 'ics' | 'pdf'
  sourceUrl?: string
  termId?: string
  payload: unknown
  meta?: Record<string, unknown>
}

export interface CloudCredentialSyncRequest {
  schoolId: string
  providerId: string
  target: DataTarget
  username: string
  password: string
  semesterId?: string
  source?: 'frontend_first_import' | 'backend_auto_sync'
}

export interface CloudParserResult {
  target: DataTarget
  termId?: string
  payload?: unknown
  cacheData?: TimetableCacheResponse | FeatureCacheResponse
  parsedCount?: number
  sourceHash?: string
  warnings?: string[]
}

export interface CloudCredentialSyncResult {
  target: DataTarget
  termId?: string
  cacheData?: TimetableCacheResponse | FeatureCacheResponse
  parsedCount?: number
  sourceHash?: string
  warnings?: string[]
  profile?: unknown
}

interface CloudFunctionResponse {
  ok?: boolean
  result?: CloudParserResult
  data?: CloudParserResult
  errorCode?: string
  errorMessage?: string
}

interface CloudCredentialSyncResponse {
  ok?: boolean
  result?: CloudCredentialSyncResult
  data?: CloudCredentialSyncResult
  cacheData?: TimetableCacheResponse | FeatureCacheResponse
  errorCode?: string
  errorMessage?: string
}

let cloudInitialized = false

function getCloudApi() {
  const cloud = (Taro as unknown as { cloud?: unknown }).cloud

  return cloud && typeof cloud === 'object'
    ? (cloud as {
        init?: (options: { env: string }) => void
        callFunction?: (options: {
          name: string
          data: RawPayloadEnvelope | CloudCredentialSyncRequest
        }) => Promise<{
          result?:
            | CloudFunctionResponse
            | CloudParserResult
            | CloudCredentialSyncResponse
            | CloudCredentialSyncResult
        }>
      })
    : null
}

function unwrapCloudParserResult(response: unknown): CloudParserResult {
  const data = response && typeof response === 'object'
    ? (response as CloudFunctionResponse)
    : {}

  if (data.ok === false || data.errorCode) {
    throw new Error(data.errorCode || data.errorMessage || 'PARSER_FAILED')
  }

  return (data.result || data.data || response) as CloudParserResult
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

  if (!result.cacheData && data.cacheData) {
    return {
      ...result,
      cacheData: data.cacheData,
    }
  }

  return result
}

export function hasCloudParser() {
  return Boolean(
    process.env.TARO_APP_CLOUD_PARSER_URL ||
      (process.env.TARO_APP_CLOUDBASE_ENV_ID && getCloudApi()?.callFunction),
  )
}

export function hasCloudCredentialSync() {
  return Boolean(
    process.env.TARO_APP_CLOUD_SYNC_URL ||
      process.env.TARO_APP_CLOUD_PARSER_URL ||
      (process.env.TARO_APP_CLOUDBASE_ENV_ID && getCloudApi()?.callFunction),
  )
}

export async function parseRawPayloadWithCloud(
  envelope: RawPayloadEnvelope,
): Promise<CloudParserResult> {
  const parserUrl = process.env.TARO_APP_CLOUD_PARSER_URL

  if (parserUrl) {
    const response = await Taro.request<CloudFunctionResponse | CloudParserResult>({
      url: parserUrl,
      method: 'POST',
      data: envelope,
      header: { 'content-type': 'application/json' },
    })

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`PARSER_FAILED: ${response.statusCode}`)
    }

    return unwrapCloudParserResult(response.data)
  }

  const envId = process.env.TARO_APP_CLOUDBASE_ENV_ID
  const cloud = getCloudApi()

  if (!envId || !cloud?.callFunction) {
    throw new Error('CLOUD_PARSER_NOT_CONFIGURED')
  }

  if (!cloudInitialized) {
    cloud.init?.({ env: envId })
    cloudInitialized = true
  }

  const response = await cloud.callFunction({
    name: process.env.TARO_APP_CLOUD_PARSER_FUNCTION || 'parseRawPayload',
    data: envelope,
  })

  return unwrapCloudParserResult(response.result)
}

export async function runCredentialSyncWithCloud(
  request: CloudCredentialSyncRequest,
): Promise<CloudCredentialSyncResult> {
  const payload = {
    source: 'frontend_first_import' as const,
    ...request,
  }
  const syncUrl =
    process.env.TARO_APP_CLOUD_SYNC_URL || process.env.TARO_APP_CLOUD_PARSER_URL

  if (syncUrl) {
    const response = await Taro.request<
      CloudCredentialSyncResponse | CloudCredentialSyncResult
    >({
      url: syncUrl,
      method: 'POST',
      data: payload,
      header: { 'content-type': 'application/json' },
    })

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`CLOUD_SYNC_FAILED: ${response.statusCode}`)
    }

    return unwrapCloudCredentialSyncResult(response.data)
  }

  const envId = process.env.TARO_APP_CLOUDBASE_ENV_ID
  const cloud = getCloudApi()

  if (!envId || !cloud?.callFunction) {
    throw new Error('CLOUD_PARSER_NOT_CONFIGURED')
  }

  if (!cloudInitialized) {
    cloud.init?.({ env: envId })
    cloudInitialized = true
  }

  const response = await cloud.callFunction({
    name:
      process.env.TARO_APP_CLOUD_SYNC_FUNCTION ||
      process.env.TARO_APP_CLOUD_PARSER_FUNCTION ||
      'runProviderSync',
    data: payload,
  })

  return unwrapCloudCredentialSyncResult(response.result)
}
