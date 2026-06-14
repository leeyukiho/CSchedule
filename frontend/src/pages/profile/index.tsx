import { useEffect, useMemo, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components'

import { getBinding, unbind } from '../../shared/api/bindings'
import { getProfile, saveProfile } from '../../shared/api/features'
import { createManualSync } from '../../shared/api/sync'
import { BindingSummary, FeatureDisplayConfig, FeatureDisplayField, ProfileData } from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { clearStoredBindingId, getStoredBindingId } from '../../shared/storage'

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
  { key: 'studentStatus', label: '学生状态' },
  { key: 'dormitory', label: '宿舍信息' },
  { key: 'counselor', label: '辅导员' },
]

const FALLBACK_DETAIL_FIELDS: FeatureDisplayField[] = [
  { key: 'grade', label: '年级' },
  { key: 'gender', label: '性别' },
  { key: 'phone', label: '手机号' },
  { key: 'email', label: '邮箱' },
]

function formatBindingStatus(status?: BindingSummary['status']) {
  if (status === 'unbound' || status === 'disabled') {
    return '未绑定'
  }

  return status ? '已绑定' : '未知'
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
  const [binding, setBinding] = useState<BindingSummary | null>(null)
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

  useEffect(() => {
    const bindingId = getStoredBindingId()

    if (!bindingId) {
      setErrorText('请先绑定学校账号')
      return
    }

    void loadBinding(bindingId)
  }, [])

  const bindingDisplayName = binding ? binding.displayName : undefined
  const profileSource = useMemo(
    () => ({
      ...profile,
      displayName: bindingDisplayName,
      bindingStatus: formatBindingStatus(binding ? binding.status : undefined),
      schoolName: (binding && binding.school && binding.school.name) || '未绑定',
      lastCachedAt: formatTime(binding ? binding.lastCachedAt : undefined),
    }),
    [binding, bindingDisplayName, profile],
  )

  const student = useMemo(
    () => ({
      name: getText(profileSource.name || profileSource.displayName, '课程表用户'),
      number: getText(profileSource.maskedStudentId || profileSource.studentId, '暂无学号'),
      major: getText(profileSource.major, '暂无专业信息'),
      className: getText(profileSource.className, ''),
      level: getText(profileSource.level || profileSource.grade, '暂无层次信息'),
      avatarUrl: getText(profileSource.avatarUrl, ''),
    }),
    [profileSource],
  )

  const baseInfo = useMemo(
    () => {
      const schoolRows = [
        { label: '绑定状态', value: String(profileSource.bindingStatus) },
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
        { label: '课表缓存', value: String(profileSource.lastCachedAt) },
      ]
    },
    [profileDisplay, profileSource, student.number],
  )

  async function loadBinding(bindingId: string) {
    setErrorText('')

    try {
      const bindingData = await getBinding(bindingId)
      setBinding(bindingData)

      const profileData = await getProfile(bindingId)
      setProfile(profileData.data || {})
      setProfileDisplay(profileData.display)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '账号信息读取失败')
    }
  }

  function openProfileEditor() {
    if (!(binding && binding.id)) {
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
    if (!(binding && binding.id) || savingProfile) {
      return
    }

    setSavingProfile(true)
    setMessage('')
    setErrorText('')

    try {
      const response = await saveProfile(binding.id, rowsToProfile(editRows))
      setProfile(response.data || {})
      setEditVisible(false)
      setMessage('个人信息已保存')
      Taro.showToast({ title: '已保存', icon: 'success' })
      await loadBinding(binding.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleSync() {
    if (!(binding && binding.id)) {
      Taro.navigateTo({ url: '/pages/bind/index' })
      return
    }

    if (!syncUsername.trim() || !syncPassword) {
      setErrorText('请输入教务系统账号和密码')
      return
    }

    setLoading(true)
    setMessage('')
    setErrorText('')

    try {
      const job = await createManualSync(binding.id, 'course', {
        username: syncUsername.trim(),
        password: syncPassword,
      })
      setMessage(job.status === 'success' ? '课表已同步' : `同步状态：${job.status}`)
      setSyncPassword('')
      await loadBinding(binding.id)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '同步失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleUnbind() {
    if (!(binding && binding.id)) {
      return
    }

    try {
      await unbind(binding.id)
      clearStoredBindingId()
      setMessage('已退出绑定')
      Taro.navigateTo({ url: '/pages/bind/index' })
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '退出绑定失败')
    }
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

      {binding && binding.id && (
        <View className='soft-card feedback-card card-gap'>
          <Text className='item-title'>手动同步课表</Text>
          <Text className='item-meta'>像登录学校官网一样输入教务系统账号密码。</Text>
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
              type='password'
              value={syncPassword}
              placeholder='教务系统密码'
              onInput={(event) => setSyncPassword(event.detail.value)}
            />
          </View>
          <Button className='button' loading={loading} onClick={handleSync}>
            同步课表
          </Button>
        </View>
      )}

      <View className='soft-card action-panel'>
        <View className='action-row' onClick={() => Taro.navigateTo({ url: '/pages/bind/index' })}>
          <View className='action-icon action-refresh' />
          <Text>绑定学校账号</Text>
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
        {binding && binding.id && (
          <Button className='button button-danger' onClick={handleUnbind}>
            退出绑定
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
