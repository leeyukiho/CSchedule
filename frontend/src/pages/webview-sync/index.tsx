import { useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Text, View, WebView } from '@tarojs/components'

import {
  CloudParserResult,
  hasCloudParser,
  parseRawPayloadWithCloud,
} from '../../shared/api/cloud-parser'
import { completeWebviewSync, uploadRawData } from '../../shared/api/raw-data'
import {
  DataTarget,
  FeatureCacheResponse,
  ProfileData,
  StudentAccountSummary,
  TimetableCacheResponse,
} from '../../shared/api/types'
import { PageShell } from '../../shared/layout'
import {
  setStoredAccountId,
  setStoredAccountSummary,
  setStoredDataCache,
} from '../../shared/storage'

interface WebviewPayload {
  target?: DataTarget
  contentType?: 'json' | 'html' | 'text' | 'csv' | 'xlsx' | 'ics' | 'pdf'
  termId?: string
  sourceUrl?: string
  payload?: unknown
  meta?: Record<string, unknown>
}

const DEFAULT_TARGETS: DataTarget[] = ['course']
const BACKEND_JSON_TARGETS = new Set(['course', 'score', 'exam', 'profile'])

function parseTargets(value?: string) {
  const targets = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is DataTarget =>
      ['course', 'score', 'exam', 'profile'].includes(item),
    )

  return targets.length > 0 ? targets : DEFAULT_TARGETS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function persistUploadCache(
  accountId: string,
  target: DataTarget,
  cacheData: TimetableCacheResponse | FeatureCacheResponse | undefined,
) {
  if (!cacheData) {
    return
  }

  if (target === 'course') {
    const timetable = {
      ...(cacheData as TimetableCacheResponse),
      accountId,
    }
    setStoredDataCache(accountId, 'timetable', timetable, {
      sourceHash: timetable.sourceHash,
      syncedAt: timetable.syncedAt,
    })

    if (timetable.termId) {
      setStoredDataCache(accountId, 'timetable', timetable, {
        termId: timetable.termId,
        sourceHash: timetable.sourceHash,
        syncedAt: timetable.syncedAt,
      })
    }

    return
  }

  if (!['score', 'exam', 'profile'].includes(target)) {
    return
  }

  const feature = {
    ...(cacheData as FeatureCacheResponse),
    accountId,
  }

  if (!isRecord(feature) || feature.target !== target) {
    return
  }

  setStoredDataCache(accountId, target, feature, {
    sourceHash: feature.sourceHash,
    syncedAt: feature.syncedAt,
  })

  if (feature.termId) {
    setStoredDataCache(accountId, target, feature, {
      termId: feature.termId,
      sourceHash: feature.sourceHash,
      syncedAt: feature.syncedAt,
    })
  }
}

function getUploadPayloadFromCloudResult(
  result: CloudParserResult,
  fallbackPayload: unknown,
) {
  if (result.payload !== undefined) {
    return result.payload
  }

  if (result.cacheData) {
    return result.cacheData
  }

  return fallbackPayload
}

async function parsePayloadBeforeUpload(input: {
  schoolId: string
  providerId: string
  data: WebviewPayload
  sourceUrl: string
}) {
  if (!hasCloudParser()) {
    throw new Error('CLOUD_PARSER_NOT_CONFIGURED')
  }

  const result = await parseRawPayloadWithCloud({
    schoolId: input.schoolId,
    providerId: input.providerId,
    target: input.data.target || 'course',
    contentType: input.data.contentType || 'json',
    sourceUrl: input.data.sourceUrl || input.sourceUrl,
    termId: input.data.termId,
    payload: input.data.payload,
    meta: input.data.meta,
  })

  return {
    payload: getUploadPayloadFromCloudResult(result, input.data.payload),
    contentType: 'json' as const,
    cacheData: result.cacheData,
    meta: {
      ...input.data.meta,
      parsedBy: 'cloud_function',
      cloudParser: process.env.TARO_APP_CLOUD_PARSER_FUNCTION || 'parseRawPayload',
      cloudSourceHash: result.sourceHash,
      cloudWarnings: result.warnings,
      localCachePreferred: true,
    },
  }
}

function getText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function buildAccountSummary(input: {
  accountId: string
  schoolId: string
  schoolName?: string
  schoolShortName?: string
  providerId?: string
  profile?: ProfileData
  cacheData?: TimetableCacheResponse | FeatureCacheResponse
}): StudentAccountSummary {
  const session = input.cacheData?.session
  const syncedAt = input.cacheData?.syncedAt

  return {
    id: input.accountId,
    schoolId: input.schoolId,
    providerId: input.providerId || input.cacheData?.providerId || input.schoolId,
    displayName: getText(input.profile?.name || input.profile?.displayName),
    status: session?.accountStatus || 'active',
    sessionReusable: Boolean(session?.sessionReusable),
    sessionRefreshable: Boolean(session?.sessionRefreshable),
    sessionExpireAt: session?.sessionExpireAt,
    lastCachedAt: syncedAt,
    school: {
      id: input.schoolId,
      name: input.schoolName || input.schoolId,
      shortName: input.schoolShortName,
    },
  }
}

export default function WebviewSyncPage() {
  const router = useRouter()
  const params = router.params || {}
  const initialAccountId = String(params.accountId || '')
  const schoolId = String(params.schoolId || '')
  const schoolName = decodeURIComponent(String(params.schoolName || ''))
  const schoolShortName = decodeURIComponent(String(params.shortName || ''))
  const providerId = String(params.providerId || schoolId)
  const [activeAccountId, setActiveAccountId] = useState(initialAccountId)
  const contextId = String(params.contextId || '')
  const sourceUrl = decodeURIComponent(String(params.url || ''))
  const requiredTargets = useMemo(
    () => parseTargets(params.targets),
    [params.targets],
  )
  const [completedTargets, setCompletedTargets] = useState<DataTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('请在学校页面完成登录，数据同步完成后会自动返回小程序。')
  const [errorText, setErrorText] = useState('')

  async function handleMessage(event: { detail?: { data?: unknown[] } }) {
    const data = event.detail ? event.detail.data : undefined
    const messages = Array.isArray(data) ? data : []

    for (const item of messages) {
      await handlePayload(item)
    }
  }

  async function handlePayload(item: unknown) {
    if (!activeAccountId) {
      setErrorText('缺少账号信息，请返回重新登录。')
      return
    }

    const data =
      item && typeof item === 'object' ? (item as WebviewPayload) : {}
    const target = data.target || 'course'

    if (!data.payload || !BACKEND_JSON_TARGETS.has(target)) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      const parsed = await parsePayloadBeforeUpload({
        schoolId,
        providerId,
        data,
        sourceUrl,
      })

      persistUploadCache(activeAccountId, target, parsed.cacheData)

      const uploadResult = await uploadRawData(activeAccountId, {
        contextId,
        target,
        accessMode: 'webview_client_fetch',
        termId: data.termId,
        contentType: parsed.contentType,
        sourceUrl: data.sourceUrl || sourceUrl,
        payload: parsed.payload,
        meta: parsed.meta,
      })

      const nextAccountId = uploadResult.accountId || activeAccountId

      if (nextAccountId !== activeAccountId) {
        setActiveAccountId(nextAccountId)
      }

      setStoredAccountId(nextAccountId, schoolId)
      persistUploadCache(nextAccountId, target, uploadResult.cacheData)
      setStoredAccountSummary(buildAccountSummary({
        accountId: nextAccountId,
        schoolId,
        schoolName,
        schoolShortName,
        providerId,
        profile: target === 'profile'
          ? (uploadResult.cacheData as FeatureCacheResponse<ProfileData> | undefined)?.data || undefined
          : undefined,
        cacheData: uploadResult.cacheData,
      }))

      const nextTargets = Array.from(new Set([...completedTargets, target]))
      setCompletedTargets(nextTargets)

      const result = uploadResult.syncStatus || {
        accountId: nextAccountId,
        status: 'partial' as const,
        canCloseWebview: false,
        missingRequiredTargets: ['course'] as DataTarget[],
      }

      if (result.canCloseWebview) {
        setMessage('同步完成，正在进入小程序。')
        Taro.switchTab({ url: '/pages/index/index' })
      } else {
        setMessage(
          `已同步 ${nextTargets.length} 项，仍需继续：${result.missingRequiredTargets.join(', ')}`,
        )
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '网页同步失败')
    } finally {
      setLoading(false)
    }
  }

  function finishManually() {
    if (!activeAccountId) {
      Taro.navigateBack()
      return
    }

    void completeWebviewSync(activeAccountId, {
      contextId,
      completedTargets,
    })
      .then((result) => {
        if (result.canCloseWebview) {
          setStoredAccountId(activeAccountId, schoolId)
          Taro.switchTab({ url: '/pages/index/index' })
        } else {
          setErrorText(
            `仍缺少必要数据：${result.missingRequiredTargets.join(', ') || 'course'}`,
          )
        }
      })
      .catch((error) =>
        setErrorText(
          error instanceof Error ? error.message : '同步状态确认失败',
        ),
      )
  }

  return (
    <PageShell title='网页登录同步' back subPage>
      <View className='webview-sync-header'>
        <View>
          <Text className='item-meta'>
            必需数据：{requiredTargets.join(', ')}
          </Text>
        </View>
        <Button
          className='button button-secondary webview-sync-button'
          loading={loading}
          onClick={finishManually}
        >
          完成
        </Button>
      </View>

      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}

      {sourceUrl ? (
        <WebView src={sourceUrl} onMessage={handleMessage} />
      ) : (
        <View className='soft-card state-card'>缺少学校登录页面地址</View>
      )}
    </PageShell>
  )
}
