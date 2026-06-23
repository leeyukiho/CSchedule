import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Text, View, WebView } from '@tarojs/components'

import { completeWebviewSync, uploadRawData } from '../../shared/api/raw-data'
import { refreshSchoolTermStarts } from '../../shared/api/schools'
import {
  DataTarget,
  FeatureCacheResponse,
  ProfileData,
  StudentAccountSummary,
  TimetableCacheResponse,
} from '../../shared/api/types'
import { PageShell } from '../../shared/layout'
import {
  clearStoredDataCacheTerms,
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
  cacheData?: unknown
  data?: unknown
  meta?: Record<string, unknown>
}

const DEFAULT_TARGETS: DataTarget[] = ['course']
const DATA_TARGETS: DataTarget[] = ['course', 'score', 'exam', 'profile']
const BACKEND_JSON_TARGETS = new Set<DataTarget>(DATA_TARGETS)
const INITIAL_MESSAGE = '请完成学校登录'
const STATUS_CLEAR_DELAY_MS = 3000

function parseTargets(value?: string) {
  const targets = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is DataTarget =>
      DATA_TARGETS.includes(item as DataTarget),
    )

  return targets.length > 0 ? targets : DEFAULT_TARGETS
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function parseMessage(value: unknown) {
  if (typeof value !== 'string') {
    return value
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function normalizePayloadMessages(item: unknown): WebviewPayload[] {
  const data = parseMessage(item)

  if (Array.isArray(data)) {
    return data.flatMap((entry) => normalizePayloadMessages(entry))
  }

  if (!isRecord(data)) {
    return []
  }

  if (Array.isArray(data.payloads)) {
    return data.payloads.flatMap((entry) => normalizePayloadMessages(entry))
  }

  if (Array.isArray(data.cacheResults)) {
    return data.cacheResults.flatMap((entry) => normalizePayloadMessages(entry))
  }

  if (!('target' in data) && !('payload' in data) && !('cacheData' in data) && !('data' in data)) {
    return []
  }

  return [
    {
      target: data.target as DataTarget | undefined,
      contentType: data.contentType as WebviewPayload['contentType'],
      termId: getText(data.termId),
      sourceUrl: getText(data.sourceUrl),
      payload: data.payload ?? data.cacheData ?? data.data,
      cacheData: data.cacheData,
      data: data.data,
      meta: isRecord(data.meta) ? data.meta : undefined,
    },
  ]
}

function getPayloadSource(payload: unknown) {
  if (!isRecord(payload)) {
    return payload
  }

  return payload.cacheData ?? payload.data ?? payload.result ?? payload
}

function findArray(value: unknown, keys: string[]) {
  if (Array.isArray(value)) {
    return value
  }

  if (!isRecord(value)) {
    return undefined
  }

  for (const key of keys) {
    if (Array.isArray(value[key])) {
      return value[key] as unknown[]
    }
  }

  return undefined
}

function normalizeNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0)
    : undefined
}

function normalizeCourseForUpload(value: unknown, index: number) {
  const course = isRecord(value) ? value : {}
  const sections = normalizeNumberArray(course.sections)
  const startSection = Number(course.startSection ?? sections?.[0] ?? 0)
  const endSection = Number(course.endSection ?? sections?.[sections.length - 1] ?? startSection)

  return {
    id: getText(course.id) || `course-${index + 1}`,
    name: getText(course.name) || getText(course.courseName),
    teacher: getText(course.teacher) || getText(course.teacherName),
    location: getText(course.location) || getText(course.classroom) || getText(course.room),
    classroom: getText(course.classroom) || getText(course.location) || getText(course.room),
    building: getText(course.building),
    sectionTimeProfileId: getText(course.sectionTimeProfileId) || getText(course.timeProfileId),
    startTime: getText(course.startTime),
    endTime: getText(course.endTime),
    time: getText(course.time),
    weekday: Number(course.weekday ?? course.dayOfWeek ?? course.week ?? 0),
    startSection: Number.isFinite(startSection) ? startSection : undefined,
    endSection: Number.isFinite(endSection) ? endSection : undefined,
    sections,
    weeks: normalizeNumberArray(course.weeks),
    rawWeeks: getText(course.rawWeeks),
  }
}

function compactPayload(target: DataTarget, payload: unknown) {
  const source = getPayloadSource(payload)
  const sourceRecord = isRecord(source) ? source : {}

  if (target === 'course') {
    const courses = findArray(source, ['courses', 'courseList', 'lessons'])

    if (!courses) {
      return null
    }

    return {
      termId: getText(sourceRecord.termId) || getText(sourceRecord.selectedSemesterId),
      courses: courses.map((course, index) => normalizeCourseForUpload(course, index)),
      terms: findArray(source, ['terms', 'semesters']) || [],
      sectionTimes: findArray(source, ['sectionTimes', 'sections']) || [],
    }
  }

  if (isRecord(source) && ('data' in source || 'meta' in source || 'termId' in source)) {
    return {
      termId: getText(source.termId) || getText(source.selectedSemesterId),
      data: source.data ?? null,
      meta: isRecord(source.meta) ? source.meta : {},
    }
  }

  return { data: source, meta: {} }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function hashPayload(value: unknown) {
  const text = stableStringify(value)
  let hash = 2166136261

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(36)
}

function createClientSession() {
  return {
    sessionReusable: false,
    sessionRefreshable: false,
    accountStatus: 'active' as const,
  }
}

function buildLocalCacheData(input: {
  accountId: string
  schoolId: string
  providerId: string
  target: DataTarget
  payload: unknown
  sourceHash?: string
  syncedAt?: string
}): TimetableCacheResponse | FeatureCacheResponse | undefined {
  const payload = isRecord(input.payload) ? input.payload : {}
  const base = {
    accountId: input.accountId,
    schoolId: input.schoolId,
    providerId: input.providerId,
    termId: getText(payload.termId),
    sourceHash: input.sourceHash,
    syncedAt: input.syncedAt,
    session: createClientSession(),
  }

  if (input.target === 'course') {
    if (!Array.isArray(payload.courses)) {
      return undefined
    }

    return {
      ...base,
      courses: payload.courses as TimetableCacheResponse['courses'],
      terms: Array.isArray(payload.terms) ? payload.terms : [],
      sectionTimes: Array.isArray(payload.sectionTimes) ? payload.sectionTimes : [],
    }
  }

  return {
    ...base,
    target: input.target,
    data: 'data' in payload ? payload.data : null,
    meta: payload.meta ?? {},
  } as FeatureCacheResponse
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
    clearStoredDataCacheTerms(accountId, 'timetable')

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
  const [message, setMessage] = useState(INITIAL_MESSAGE)
  const [errorText, setErrorText] = useState('')
  const completedTargetsRef = useRef<DataTarget[]>([])
  const uploadedPayloadHashes = useRef(new Set<string>())
  const uploadingPayloadHashes = useRef(new Set<string>())
  const closingRef = useRef(false)
  const termStartsRequestRef = useRef<Promise<unknown> | null>(null)

  useEffect(() => {
    if (!schoolId) {
      return
    }

    termStartsRequestRef.current = refreshSchoolTermStarts(schoolId).catch(() => null)
  }, [schoolId])

  useEffect(() => {
    if (!message && !errorText) {
      return undefined
    }

    const timer = setTimeout(() => {
      setMessage('')
      setErrorText('')
    }, STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [message, errorText])

  async function handleMessage(event: { detail?: { data?: unknown[] } }) {
    const data = event.detail ? event.detail.data : undefined
    const messages = Array.isArray(data) ? data : []

    for (const item of messages) {
      for (const payload of normalizePayloadMessages(item)) {
        await handlePayload(payload)
      }
    }
  }

  async function handlePayload(item: unknown) {
    if (!activeAccountId) {
      setErrorText('缺少账号信息')
      return
    }

    const data = isRecord(item) ? (item as WebviewPayload) : {}
    const target = data.target || 'course'
    const contentType = data.contentType || 'json'

    if (!data.payload || !BACKEND_JSON_TARGETS.has(target)) {
      return
    }

    if (contentType !== 'json') {
      setErrorText('暂时无法导入')
      return
    }

    const payload = compactPayload(target, data.payload)

    if (!payload) {
      setErrorText('暂时无法导入')
      return
    }

    const payloadHash = hashPayload({
      accountId: activeAccountId,
      contextId,
      target,
      termId: data.termId,
      payload,
    })

    if (
      uploadedPayloadHashes.current.has(payloadHash) ||
      uploadingPayloadHashes.current.has(payloadHash)
    ) {
      return
    }

    uploadingPayloadHashes.current.add(payloadHash)
    setLoading(true)
    setErrorText('')

    try {
      const uploadResult = await uploadRawData(activeAccountId, {
        contextId,
        target,
        accessMode: 'webview_client_fetch',
        termId: data.termId,
        contentType,
        sourceUrl: data.sourceUrl || sourceUrl,
        payload,
        completedTargets: completedTargetsRef.current,
        requiredTargets,
        responseMode: 'status_only',
        meta: {
          ...data.meta,
          parsedBy: 'webview_structured_json',
          localCachePreferred: true,
          payloadHash,
        },
      })

      const nextAccountId = uploadResult.accountId || activeAccountId

      if (nextAccountId !== activeAccountId) {
        setActiveAccountId(nextAccountId)
      }

      const cacheData =
        uploadResult.cacheData ||
        buildLocalCacheData({
          accountId: nextAccountId,
          schoolId,
          providerId,
          target,
          payload,
          sourceHash: uploadResult.sourceHash,
          syncedAt: uploadResult.syncedAt,
        })

      setStoredAccountId(nextAccountId, schoolId)
      persistUploadCache(nextAccountId, target, cacheData)
      setStoredAccountSummary(buildAccountSummary({
        accountId: nextAccountId,
        schoolId,
        schoolName,
        schoolShortName,
        providerId,
        profile: target === 'profile'
          ? (cacheData as FeatureCacheResponse<ProfileData> | undefined)?.data || undefined
          : undefined,
        cacheData,
      }))

      const nextTargets = Array.from(new Set([...completedTargetsRef.current, target]))
      completedTargetsRef.current = nextTargets
      setCompletedTargets(nextTargets)
      uploadedPayloadHashes.current.add(payloadHash)

      const result = uploadResult.syncStatus || {
        accountId: nextAccountId,
        status: 'partial' as const,
        canCloseWebview: false,
        missingRequiredTargets: requiredTargets,
      }

      if (result.canCloseWebview && !closingRef.current) {
        await termStartsRequestRef.current
        closingRef.current = true
        setMessage('同步完成')
        Taro.switchTab({ url: '/pages/index/index' })
      } else {
        setMessage(
          `已同步 ${nextTargets.length} 项`,
        )
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '网页同步失败')
    } finally {
      uploadingPayloadHashes.current.delete(payloadHash)
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
      completedTargets: completedTargetsRef.current,
      requiredTargets,
    })
      .then((result) => {
        if (result.canCloseWebview && !closingRef.current) {
          closingRef.current = true
          setStoredAccountId(activeAccountId, schoolId)
          void Promise.resolve(termStartsRequestRef.current).then(() => {
            Taro.switchTab({ url: '/pages/index/index' })
          })
        } else {
          setErrorText(
            `仍缺少必要数据：${result.missingRequiredTargets.join(', ') || 'course'}`,
          )
        }
      })
      .catch((error) =>
        setErrorText(
          error instanceof Error ? error.message : '同步确认失败',
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
          {completedTargets.length > 0 && (
            <Text className='item-meta'>
              已同步：{completedTargets.join(', ')}
            </Text>
          )}
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
