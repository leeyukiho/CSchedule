import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'

import { deactivateAccount, getAccount } from '../../shared/api/accounts'
import { getProfile, saveProfile } from '../../shared/api/features'
import { listSchools } from '../../shared/api/schools'
import { createManualSync } from '../../shared/api/sync'
import {
  FeatureDisplayConfig,
  FeatureDisplayField,
  ProfileData,
  SchoolListItem,
  StudentAccountSummary,
} from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { clearStoredAccountId, getStoredAccountId } from '../../shared/storage'

type EditField = {
  key: keyof ProfileData
  label: string
}

type EditRow = EditField & {
  value: string
}

const EDIT_FIELDS: EditField[] = [
  { key: 'name', label: '姓名' },
  { key: 'major', label: '专业' },
  { key: 'grade', label: '年级' },
  { key: 'level', label: '层次' },
  { key: 'className', label: '班级' },
  { key: 'gender', label: '性别' },
  { key: 'birthDate', label: '出生年月' },
  { key: 'politicalStatus', label: '政治面貌' },
  { key: 'phone', label: '手机号' },
  { key: 'email', label: '邮箱' },
  { key: 'nativePlace', label: '籍贯' },
  { key: 'enrollmentDate', label: '入学时间' },
  { key: 'studentStatus', label: '学籍状态' },
  { key: 'dormitory', label: '宿舍信息' },
  { key: 'counselor', label: '辅导员' },
]

const FALLBACK_DETAIL_FIELDS: FeatureDisplayField[] = [
  { key: 'grade', label: '年级' },
  { key: 'gender', label: '性别' },
  { key: 'phone', label: '手机号' },
  { key: 'email', label: '邮箱' },
]

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

function getProfileValue(
  source: Record<string, unknown>,
  field: Pick<FeatureDisplayField, 'key' | 'fallbackKeys'>,
  fallback = '暂无',
) {
  const keys = [field.key, ...(field.fallbackKeys || [])]

  for (const key of keys) {
    const value = source[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return fallback
}

function getEditableFields(display?: FeatureDisplayConfig): EditField[] {
  const fields =
    display?.editableFields ||
    display?.detailFields?.filter((field) => field.editable && field.visible !== false)

  if (!fields?.length) {
    return EDIT_FIELDS
  }

  return fields.map((field) => ({
    key: field.key as keyof ProfileData,
    label: field.label,
  }))
}

function getDetailFields(display?: FeatureDisplayConfig) {
  const fields = display?.detailFields?.filter((field) => field.visible !== false)

  return fields?.length ? fields : FALLBACK_DETAIL_FIELDS
}

function buildEditRows(profile: ProfileData, fields: EditField[]): EditRow[] {
  return fields.map((field) => ({
    ...field,
    value: typeof profile[field.key] === 'string' ? String(profile[field.key]) : '',
  }))
}

function rowsToProfile(rows: EditRow[]): ProfileData {
  return rows.reduce<ProfileData>((profile, row) => {
    profile[row.key] = row.value.trim()
    return profile
  }, {})
}

export default function ProfilePage() {
  const [account, setAccount] = useState<StudentAccountSummary | null>(null)
  const [hasStoredAccount, setHasStoredAccount] = useState(() => Boolean(getStoredAccountId()))
  const [schools, setSchools] = useState<SchoolListItem[]>([])
  const [keyword, setKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [profile, setProfile] = useState<ProfileData>({})
  const [profileDisplay, setProfileDisplay] = useState<FeatureDisplayConfig | undefined>()
  const [syncUsername, setSyncUsername] = useState('')
  const [syncPassword, setSyncPassword] = useState('')
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
      setProfileDisplay(undefined)
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
    const schoolRows = [
      { label: '账号状态', value: String(profileSource.accountStatus) },
      { label: '学校', value: String(profileSource.schoolName) },
      { label: '学号', value: student.number },
    ]
    const detailRows = getDetailFields(profileDisplay)
      .filter((field) => !['studentId', 'maskedStudentId'].includes(field.key))
      .map((field) => ({
        label: field.label,
        value: getProfileValue(profileSource, field),
      }))

    return [
      ...schoolRows,
      ...detailRows,
      { label: '更新时间', value: String(profileSource.lastCachedAt) },
    ]
  }, [profileDisplay, profileSource, student.number])

  async function loadAccount(accountId: string) {
    setErrorText('')

    try {
      const accountData = await getAccount(accountId)
      setAccount(accountData)

      const profileData = await getProfile(accountId)
      setProfile(profileData.data || {})
      setProfileDisplay(profileData.display)
    } catch (error) {
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

    setEditRows(buildEditRows(profile, getEditableFields(profileDisplay)))
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
      await loadAccount(account.id)
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

    if (!hasSavedPassword && (!syncUsername.trim() || !syncPassword)) {
      setErrorText('请输入教务系统账号和密码')
      return
    }

    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const job = await createManualSync(
        account.id,
        'course',
        hasSavedPassword
          ? undefined
          : {
              username: syncUsername.trim(),
              password: syncPassword,
            },
      )
      setMessage(job.status === 'success' ? '课表已同步' : `同步状态：${job.status}`)
      setSyncPassword('')
      await loadAccount(account.id)
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
      clearStoredAccountId()
      setHasStoredAccount(false)
      setAccount(null)
      setProfile({})
      setProfileDisplay(undefined)
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
          {!hasSavedPassword && (
            <View>
              <View className='field field-gap'>
                <Input
                  className='input'
                  value={syncUsername}
                  placeholder='教务系统账号'
                  onInput={(event) => setSyncUsername(event.detail.value)}
                />
              </View>
              <View className='field field-gap'>
                <Input
                  className='input'
                  password
                  value={syncPassword}
                  placeholder='教务系统密码'
                  onInput={(event) => setSyncPassword(event.detail.value)}
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
