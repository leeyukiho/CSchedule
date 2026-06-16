import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'

import { deactivateAccount, getAccount } from '../../shared/api/accounts'
import { getProfile, saveProfile } from '../../shared/api/features'
import { listSchools } from '../../shared/api/schools'
import { createManualSync, getSyncJob } from '../../shared/api/sync'
import { getTimetable } from '../../shared/api/timetable'
import {
  ProfileData,
  SchoolListItem,
  SyncJobResponse,
  StudentAccountSummary,
  TimetableCacheResponse,
} from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import {
  clearStoredAccountId,
  clearStoredAccountSummary,
  clearStoredDataCaches,
  getStoredAccountId,
  setStoredDataCache,
} from '../../shared/storage'

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
    key: 'studentId',
    label: '学号',
    readonly: true,
    getValue: (source) => getText(source.maskedStudentId || source.studentId),
  },
  { key: 'gender', label: '性别' },
  { key: 'phone', label: '手机号' },
]
const SYNC_POLL_INTERVAL_MS = 1500
const SYNC_POLL_TIMEOUT_MS = 120000

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

function rowsToProfile(rows: EditRow[]): ProfileData {
  return rows.filter((row) => !row.readonly).reduce<ProfileData>((profile, row) => {
    profile[row.key] = row.value.trim()
    return profile
  }, {})
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isTerminalSyncStatus(status: SyncJobResponse['status']) {
  return ['success', 'failed', 'need_login', 'need_webview_fetch', 'rate_limited', 'cancelled'].includes(status)
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

  return currentJob
}

function persistSyncCache(accountId: string, job: SyncJobResponse) {
  if (job.target !== 'course' || !job.cacheData) {
    return false
  }

  const timetable = {
    ...(job.cacheData as TimetableCacheResponse),
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

  return true
}

function getBindUrl(account: StudentAccountSummary) {
  const params = new URLSearchParams({
    schoolId: account.schoolId,
    schoolName: account.school?.name || '',
    shortName: account.school?.shortName || '',
    providerId: account.providerId,
  })

  return `/pages/bind/index?${params.toString()}`
}

export default function ProfilePage() {
  const [account, setAccount] = useState<StudentAccountSummary | null>(null)
  const [hasStoredAccount, setHasStoredAccount] = useState(() => Boolean(getStoredAccountId()))
  const [schools, setSchools] = useState<SchoolListItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [profile, setProfile] = useState<ProfileData>({})
  const [loading, setLoading] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [editVisible, setEditVisible] = useState(false)
  const [editRows, setEditRows] = useState<EditRow[]>([])
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')
  const requestSeq = useRef(0)
  const searchCache = useRef(new Map<string, SchoolListItem[]>())

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
    if (hasStoredAccount) {
      return undefined
    }

    const timer = setTimeout(() => {
      void searchSchools(keyword)
    }, 220)

    return () => clearTimeout(timer)
  }, [hasStoredAccount, keyword])

  const accountDisplayName = account ? account.displayName : undefined
  const hasSavedPassword = account?.credentialSaveMode === 'password_vault'
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
      number: getText(profileSource.maskedStudentId || profileSource.studentId, '暂无学号'),
      major: getText(profileSource.major, '暂无专业信息'),
      className: getText(profileSource.className, ''),
      level: getText(profileSource.level || profileSource.grade, '暂无层次信息'),
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

  async function searchSchools(value: string) {
    const text = value.trim()
    if (searchCache.current.has(text)) {
      setSchools((searchCache.current.get(text) || []).filter((school) => school.enabled))
      return
    }

    const seq = requestSeq.current + 1
    requestSeq.current = seq
    setSearching(true)
    setErrorText('')

    try {
      const result = await listSchools({ keyword: text, limit: 30, enabledOnly: true })
      if (seq !== requestSeq.current) return
      searchCache.current.set(text, result.items)
      setSchools(result.items.filter((school) => school.enabled))
    } catch (error) {
      if (seq === requestSeq.current) {
        setErrorText(error instanceof Error ? error.message : '学校列表加载失败')
      }
    } finally {
      if (seq === requestSeq.current) setSearching(false)
    }
  }

  function selectSchoolForLogin(school: SchoolListItem) {
    const params = [
      ['schoolId', school.id],
      ['schoolName', school.name],
      ['shortName', school.shortName],
      ['providerId', school.providerId],
      ['city', school.city],
      ['province', school.province],
      ['level', school.level],
      ['status', school.status],
      ['enabled', String(school.enabled)],
    ]
      .filter((item): item is [string, string] => Boolean(item[1]))
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&')

    Taro.navigateTo({ url: `/pages/bind/index?${params}` })
  }

  function openSchoolSubmission() {
    const query = keyword.trim() ? `?schoolName=${encodeURIComponent(keyword.trim())}` : ''
    Taro.navigateTo({ url: `/pages/submission/index${query}` })
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
      const response = await saveProfile(account.id, rowsToProfile(editRows))
      setProfile(response.data || {})
      setEditVisible(false)
      setMessage('个人信息已保存')
      Taro.showToast({ title: '已保存', icon: 'success' })
      await loadAccount(account.id, true)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSync() {
    if (!(account && account.id)) {
      Taro.navigateTo({ url: '/pages/bind/index' })
      return
    }

    if (!hasSavedPassword) {
      setMessage('请通过学校页面重新导入课表。')
      Taro.navigateTo({ url: getBindUrl(account) })
      return
    }

    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const job = await createManualSync(account.id, 'course')
      setMessage(job.status === 'pending' ? '同步已排队' : `同步状态：${job.status}`)
      const finalJob = await waitForSyncJob(job)

      if (finalJob.status === 'success') {
        const cachePersisted = persistSyncCache(account.id, finalJob)

        if (!cachePersisted) {
          await getTimetable(account.id, undefined, { forceRefresh: true })
        }
      }

      if (finalJob.status === 'need_webview_fetch') {
        setMessage('该学校需要通过前端导入更新课表。')
        Taro.navigateTo({ url: getBindUrl(account) })
        return
      }

      setMessage(finalJob.status === 'success' ? '课表已同步' : `同步状态：${finalJob.status}`)
      await loadAccount(account.id, true)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '同步失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    if (!(account && account.id)) {
      return
    }

    try {
      await deactivateAccount(account.id)
      clearStoredDataCaches(account.id)
      clearStoredAccountSummary(account.id)
      clearStoredAccountId()
      setHasStoredAccount(false)
      setAccount(null)
      setProfile({})
      setMessage('已退出账号')
      Taro.navigateTo({ url: '/pages/bind/index' })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '退出失败')
    }
  }

  if (!hasStoredAccount) {
    return (
      <PageShell title='个人' activeTab='profile' contentClassName='login-content'>
        <View className='login-hero'>
          <View className='hero-icon'>
            <View className='hero-icon-book' />
          </View>
          <View className='title'>选择学校</View>
          <View className='subtitle'>选择你的学校后，将进入对应的教务认证流程。</View>
        </View>

        {errorText && <View className='status status-error'>{errorText}</View>}

        <View className='panel'>
          <View className='field school-field'>
            <View className='label-row'>
              <Text className='label'>学校</Text>
              <Text className='field-hint'>{searching ? '正在搜索' : '可选择学校'}</Text>
            </View>
            <Input
              className='input'
              value={keyword}
              placeholder='搜索或选择学校'
              onInput={(event) => setKeyword(event.detail.value)}
            />
            <View className='school-list'>
              {schools.map((school) => (
                <View
                  className='school-option'
                  key={school.id}
                  onClick={() => selectSchoolForLogin(school)}
                >
                  <View className='school-option-main'>
                    <Text className='school-name'>{school.name}</Text>
                  </View>
                  <View className='row-arrow' />
                </View>
              ))}
              {!searching && schools.length === 0 && (
                <View className='empty-state'>
                  <Text className='empty-title'>未找到匹配学校</Text>
                  <Text className='empty-desc'>可以提交学校接入申请</Text>
                </View>
              )}
            </View>
          </View>
          <View className='card-gap'>
            <Button className='button button-secondary' onClick={openSchoolSubmission}>
              申请添加学校
            </Button>
            <Text className='item-meta'>留下联系方式后，管理员会主动联系你。</Text>
          </View>
        </View>
      </PageShell>
    )
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
          <View className='profile-line'>{student.level}</View>
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

      {account && account.id && (
        <View className='soft-card feedback-card card-gap'>
          <Text className='item-title'>{hasSavedPassword ? '一键更新课表' : '手动同步课表'}</Text>
          <Text className='item-meta'>
            {hasSavedPassword
              ? '将使用已加密保存的教务账号密码更新全部学期课表。'
              : '像登录学校官网一样输入教务系统账号密码。'}
          </Text>
          {false && !hasSavedPassword && (
            <View>
              <View className='field field-gap'>
                <Input
                  className='input'
                  value=''
                  placeholder='教务系统账号'
                  onInput={() => undefined}
                />
              </View>
              <View className='field field-gap'>
                <Input
                  className='input'
                  password
                  value=''
                  placeholder='教务系统密码'
                  onInput={() => undefined}
                />
              </View>
            </View>
          )}
          <Button className='button' loading={loading} onClick={handleSync}>
            {hasSavedPassword ? '一键更新课表' : '同步课表'}
          </Button>
        </View>
      )}

      <View className='soft-card action-panel'>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>
          <View className='action-icon action-refresh' />
          <Text>登录学校账号</Text>
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
        {account && account.id && (
          <Button className='button button-danger' onClick={handleLogout}>
            退出账号
          </Button>
        )}
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
