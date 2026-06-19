import { useEffect, useMemo, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'

import { getAccount } from '../../shared/api/accounts'
import { getProfile, saveProfile } from '../../shared/api/features'
import { createManualSync, getSyncJob } from '../../shared/api/sync'
import { getTimetable } from '../../shared/api/timetable'
import {
  ProfileData,
  FeatureCacheResponse,
  SyncJobResponse,
  StudentAccountSummary,
  TimetableCacheResponse,
} from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import {
  clearStoredDataCacheTerms,
  getStoredAccountId,
  setStoredDataCache,
} from '../../shared/storage'
import { BindAccountPanel } from '../../features/bind/BindAccountPanel'

type EditField = {
  key: keyof ProfileData
  label: string
  readonly?: boolean
  getValue?: (source: Record<string, unknown>) => string
}

type EditRow = EditField & {
  value: string
}

const EDIT_FIELDS: EditField[] = [
  {
    key: 'schoolName',
    label: '学校',
    readonly: true,
    getValue: (source) => getText(source.schoolName),
  },
  {
    key: 'gender',
    label: '性别',
    readonly: true,
    getValue: (source) => getText(source.gender),
  },
  { key: 'phone', label: '手机号' },
]
const SYNC_POLL_INTERVAL_MS = 2500
const SYNC_POLL_TIMEOUT_MS = 120000
const STATUS_CLEAR_DELAY_MS = 3000

function formatAccountStatus(status?: StudentAccountSummary['status']) {
  if (status === 'unbound' || status === 'disabled') {
    return '未登录'
  }

  return status ? '已登录' : '未知'
}

function getText(value: unknown, fallback = '暂无') {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  return fallback
}

function getEditableFields(): EditField[] {
  return EDIT_FIELDS
}

function needsSchoolLogin(account: StudentAccountSummary | null, hasStoredAccount: boolean) {
  return !hasStoredAccount || account?.status === 'unbound' || account?.status === 'disabled'
}

function buildEditRows(source: Record<string, unknown>, fields: EditField[]): EditRow[] {
  return fields.map((field) => ({
    ...field,
    value: field.getValue
      ? field.getValue(source)
      : typeof source[field.key] === 'string'
        ? String(source[field.key])
        : '',
  }))
}

function rowsToProfile(rows: EditRow[], baseProfile: ProfileData = {}): ProfileData {
  return rows.filter((row) => !row.readonly).reduce<ProfileData>((profile, row) => {
    profile[row.key] = row.value.trim()
    return profile
  }, { ...baseProfile })
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isTerminalSyncStatus(status: SyncJobResponse['status']) {
  return ['success', 'failed', 'need_login', 'need_webview_fetch', 'rate_limited', 'cancelled'].includes(status)
}

function getSyncResultMessage(status: SyncJobResponse['status']) {
  if (status === 'success') {
    return '课表已同步'
  }

  if (status === 'need_login' || status === 'need_webview_fetch') {
    return '请重新导入课表。'
  }

  if (status === 'rate_limited') {
    return '同步太频繁，请稍后再试。'
  }

  return '同步未完成，请稍后再试。'
}

function getUserSyncResultMessage(status: SyncJobResponse['status'], errorCode?: string) {
  if (status === 'success') {
    return '同步完成'
  }

  if (
    status === 'need_login' ||
    errorCode === 'INVALID_CREDENTIAL' ||
    errorCode === 'SAVED_CREDENTIAL_REQUIRED' ||
    errorCode === 'SESSION_EXPIRED'
  ) {
    return '账号密码有问题，请重新登录并保存账号信息'
  }

  if (status === 'rate_limited') {
    return '同步太频繁，请稍后再试'
  }

  return '系统错误，请稍后再试'
}

function isCredentialSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')

  return (
    message.includes('INVALID_CREDENTIAL') ||
    message.includes('SAVED_CREDENTIAL_REQUIRED') ||
    message.includes('SESSION_EXPIRED') ||
    message.includes('WTBU_INVALID_CREDENTIALS') ||
    message.includes('WHHXIT_INVALID_CREDENTIALS')
  )
}

function getBindUrl(account?: StudentAccountSummary | null) {
  if (!account) {
    return '/pages/bind/index'
  }

  const school = account.school
  const params = [
    ['accountId', account.id],
    ['schoolId', school?.id || account.schoolId],
    ['schoolName', school?.name || account.schoolId],
    ['shortName', school?.shortName],
    ['providerId', account.providerId],
  ]
    .filter((item): item is [string, string] => Boolean(item[1]))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&')

  return params ? `/pages/bind/index?${params}` : '/pages/bind/index'
}

function shouldOpenBindForManualSync(account: StudentAccountSummary) {
  return (
    account.credentialSaveMode !== 'password_vault' ||
    account.syncStrategy?.manualSyncRequired ||
    account.syncStrategy?.passwordVaultRequired
  )
}

function shouldOpenBindForSyncJob(job: SyncJobResponse) {
  return (
    job.status === 'need_login' ||
    job.status === 'need_webview_fetch' ||
    job.errorCode === 'INVALID_CREDENTIAL' ||
    job.errorCode === 'SAVED_CREDENTIAL_REQUIRED' ||
    job.errorCode === 'SESSION_EXPIRED' ||
    job.errorCode === 'CLOUD_SYNC_UNSUPPORTED'
  )
}

function logSyncFailure(job: SyncJobResponse) {
  if (job.status === 'success') {
    return
  }

  console.warn('[sync] job did not complete successfully', {
    status: job.status,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    legacyMessage: getSyncResultMessage(job.status),
    jobId: job.jobId,
    accountId: job.accountId,
    target: job.target,
  })
}

async function waitForSyncJob(job: SyncJobResponse) {
  let currentJob = job
  const startedAt = Date.now()

  while (
    !isTerminalSyncStatus(currentJob.status) &&
    Date.now() - startedAt < SYNC_POLL_TIMEOUT_MS
  ) {
    await delay(SYNC_POLL_INTERVAL_MS)
    currentJob = await getSyncJob(job.jobId)
  }

  if (currentJob.status === 'success' && !Array.isArray(currentJob.cacheResults)) {
    return getSyncJob(job.jobId, { includeCache: true })
  }

  return currentJob
}

function persistSyncCache(accountId: string, job: SyncJobResponse) {
  const cacheResults = Array.isArray(job.cacheResults) ? job.cacheResults : []
  let persisted = false

  for (const item of cacheResults) {
    if (item.target === 'course') {
      const timetable = {
        ...(item.cacheData as TimetableCacheResponse),
        accountId,
      }

      if (!Array.isArray(timetable.courses)) {
        continue
      }

      setStoredDataCache(accountId, 'timetable', timetable, {
        sourceHash: timetable.sourceHash,
        syncedAt: timetable.syncedAt,
      })
      clearStoredDataCacheTerms(accountId, 'timetable')

      persisted = true
      continue
    }

    if (!['profile', 'score', 'exam'].includes(item.target)) {
      continue
    }

    const feature = {
      ...(item.cacheData as FeatureCacheResponse),
      accountId,
    }

    setStoredDataCache(accountId, item.target, feature, {
      sourceHash: feature.sourceHash,
      syncedAt: feature.syncedAt,
    })

    if (feature.termId) {
      setStoredDataCache(accountId, item.target, feature, {
        termId: feature.termId,
        sourceHash: feature.sourceHash,
        syncedAt: feature.syncedAt,
      })
    }

    persisted = true
  }

  return persisted
}

export default function ProfilePage() {
  const [account, setAccount] = useState<StudentAccountSummary | null>(null)
  const [hasStoredAccount, setHasStoredAccount] = useState(() => Boolean(getStoredAccountId()))
  const [profile, setProfile] = useState<ProfileData>({})
  const [loading, setLoading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [editVisible, setEditVisible] = useState(false)
  const [editRows, setEditRows] = useState<EditRow[]>([])
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const shouldShowSchoolLogin = needsSchoolLogin(account, hasStoredAccount)

  useDidShow(() => {
    const accountId = getStoredAccountId()

    if (!accountId) {
      setHasStoredAccount(false)
      setAccount(null)
      setProfile({})
      setMessage('')
      setErrorText('')
      return
    }

    setHasStoredAccount(true)
    void loadAccount(accountId)
  })

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

  const accountDisplayName = account ? account.displayName : undefined
  const profileSource = useMemo(
    () => ({
      ...profile,
      displayName: accountDisplayName,
      accountStatus: formatAccountStatus(account ? account.status : undefined),
      schoolName: (account && account.school && account.school.name) || '未登录',
      lastCachedAt: formatTime(account ? account.lastCachedAt : undefined),
    }),
    [account, accountDisplayName, profile],
  )

  const student = useMemo(
    () => ({
      name: getText(profileSource.name || profileSource.displayName, '课表用户'),
      number: getText(profileSource.studentId || profileSource.maskedStudentId, '暂无学号'),
      major: getText(profileSource.major, '暂无专业信息'),
      className: getText(profileSource.className, ''),
      grade: getText(profileSource.grade, ''),
      level: getText(profileSource.level, '暂无层次信息'),
      avatarUrl: getText(profileSource.avatarUrl, ''),
    }),
    [profileSource],
  )

  const baseInfo = useMemo(() => {
    return EDIT_FIELDS.map((field) => ({
      label: field.label,
      value: field.getValue
        ? field.getValue(profileSource)
        : getText(profileSource[field.key]),
    }))
  }, [profileSource])

  async function loadAccount(accountId: string, forceRefresh = false) {
    setErrorText('')

    try {
      const accountData = await getAccount(accountId, { forceRefresh })
      setAccount(accountData)

      const profileData = await getProfile(accountId)
      setProfile(profileData.data || {})
    } catch (error) {
      if (error instanceof Error && error.message === 'CACHE_NOT_READY') {
        return
      }

      setErrorText(error instanceof Error ? error.message : '账号信息读取失败')
    }
  }

  function openSchoolAccount() {
    if (loading) {
      return
    }

    void handleSync()
  }

  function openProfileEditor() {
    if (!(account && account.id)) {
      Taro.navigateTo({ url: '/pages/bind/index' })
      return
    }

    setEditRows(buildEditRows(profileSource, getEditableFields()))
    setEditVisible(true)
  }

  function closeProfileEditor() {
    if (!savingProfile) {
      setEditVisible(false)
    }
  }

  function updateEditRow(index: number, value: string) {
    setEditRows((rows) =>
      rows.map((row, rowIndex) => (rowIndex === index ? { ...row, value } : row)),
    )
  }

  async function handleSaveProfile() {
    if (!(account && account.id) || savingProfile) {
      return
    }

    setSavingProfile(true)
    setMessage('')
    setErrorText('')

    try {
      const response = await saveProfile(account.id, rowsToProfile(editRows, profile))
      setProfile(response.data || {})
      setEditVisible(false)
      setMessage('个人信息已保存')
      await loadAccount(account.id, true)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSync() {
    if (!(account && account.id)) {
      Taro.navigateTo({ url: getBindUrl(account) })
      return
    }

    const syncAccount = account

    if (shouldOpenBindForManualSync(syncAccount)) {
      Taro.navigateTo({ url: getBindUrl(syncAccount) })
      return
    }

    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const job = await createManualSync(syncAccount.id, { targets: ['course', 'profile', 'score', 'exam'] })
      const finalJob = await waitForSyncJob(job)

      if (finalJob.status === 'success') {
        const cachePersisted = persistSyncCache(syncAccount.id, finalJob)

        if (!cachePersisted) {
          await getTimetable(syncAccount.id, undefined, { forceRefresh: true })
        }
      }

      if (finalJob.status !== 'success') {
        logSyncFailure(finalJob)
        if (shouldOpenBindForSyncJob(finalJob)) {
          Taro.navigateTo({ url: getBindUrl(syncAccount) })
        } else {
          setMessage(getUserSyncResultMessage(finalJob.status, finalJob.errorCode))
        }
        return
      }

      if (finalJob.status === 'success') {
        setMessage(getUserSyncResultMessage(finalJob.status, finalJob.errorCode))
        setAccount((current) =>
          current && current.id === syncAccount.id
            ? { ...current, lastCachedAt: finalJob.finishedAt || finalJob.startedAt || finalJob.createdAt }
            : current,
        )
        return
      }

      logSyncFailure(finalJob)
      setMessage(getUserSyncResultMessage(finalJob.status, finalJob.errorCode))
    } catch (error) {
      console.warn('[sync] request failed', error)
      if (isCredentialSyncError(error)) {
        Taro.navigateTo({ url: getBindUrl(syncAccount) })
      } else {
        setMessage(getUserSyncResultMessage('failed'))
      }
    } finally {
      setLoading(false)
    }
  }

  if (shouldShowSchoolLogin) {
    return <BindAccountPanel subPage={false} />
  }

  return (
    <PageShell title='个人' activeTab='profile'>
      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}

      <View className='profile-card' onClick={openProfileEditor}>
        <View className='avatar-button'>
          {student.avatarUrl ? (
            <Image className='avatar-image' src={student.avatarUrl} mode='aspectFill' />
          ) : (
            <View className='avatar' />
          )}
        </View>
        <View>
          <View className='profile-name'>{student.name}</View>
          <View className='profile-line'>学号：{student.number}</View>
          <View className='profile-meta-row'>
            <Text className='profile-meta'>{student.major}</Text>
            {student.className && <Text className='profile-meta'>{student.className}</Text>}
          </View>
          <View className='profile-line'>{[student.grade, student.level].filter(Boolean).join(' ')}</View>
        </View>
        <View className='profile-arrow' />
      </View>
      <View className='edit-hint'>点击卡片补充或修改个人信息</View>

      <View className='soft-card info-panel'>
        <View className='panel-title'>基本信息</View>
        {baseInfo.map((item) => (
          <View className='info-row' key={item.label}>
            <Text>{item.label}</Text>
            <Text className='info-value'>{item.value}</Text>
          </View>
        ))}
      </View>

      <View className='soft-card action-panel'>
        <View className='action-row' onClick={openSchoolAccount}>
          <View className='action-icon action-refresh' />
          <View className='action-text'>
            <Text className='action-title'>同步最新教务系统数据</Text>
            <Text className='action-desc'>刷新课表、成绩等信息</Text>
          </View>
          {loading && <Text className='action-loading'>同步中</Text>}
          <View className='row-arrow' />
        </View>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/feedback/index' })}>
          <View className='action-icon action-feedback' />
          <Text>意见反馈</Text>
          <View className='row-arrow' />
        </View>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/settings/index' })}>
          <View className='action-icon action-settings' />
          <Text>设置</Text>
          <View className='row-arrow' />
        </View>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/about/index' })}>
          <View className='action-icon action-about' />
          <Text>关于</Text>
          <View className='row-arrow' />
        </View>
      </View>

      {editVisible && (
        <View className='edit-mask' onClick={closeProfileEditor}>
          <View className='edit-panel' onClick={(event) => event.stopPropagation()}>
            <View className='edit-head'>
              <View className='edit-title'>编辑个人信息</View>
              <View className='edit-close' onClick={closeProfileEditor} />
            </View>
            <View className='edit-subtitle'>补充常用资料，方便在个人页集中查看。</View>
            <ScrollView scrollY className='edit-scroll'>
              <View className='edit-field-list'>
                {editRows.map((row, index) => (
                  <View className='edit-field' key={row.key}>
                    <Text className='edit-label'>{row.label}</Text>
                    <Input
                      className='edit-input'
                      disabled={row.readonly}
                      value={row.value}
                      placeholder='点击填写'
                      placeholderClass='edit-placeholder'
                      onInput={(event) => updateEditRow(index, event.detail.value)}
                    />
                  </View>
                ))}
              </View>
            </ScrollView>
            <Button
              className='edit-save'
              loading={savingProfile}
              disabled={savingProfile}
              onClick={handleSaveProfile}
            >
              保存
            </Button>
          </View>
        </View>
      )}
    </PageShell>
  )
}
