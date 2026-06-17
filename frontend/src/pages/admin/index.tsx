import { useEffect, useState } from 'react'
import Taro from '@tarojs/taro'
import { Button, Input, Text, View } from '@tarojs/components'

import { requestApi } from '../../shared/api/client'
import { PageShell } from '../../shared/layout'

interface AdminStats {
  schools: { total: number; enabled: number }
  accounts: number
  pendingSubmissions: number
  pendingFeedback: number
}

interface SchoolItem {
  id: string
  name: string
  shortName: string | null
  province: string | null
  city: string | null
  enabled: boolean
  status: string
  loginMode: string | null
}

interface SubmissionItem {
  id: string
  schoolName: string
  province: string | null
  city: string | null
  status: string
  createdAt: string
}

const ADMIN_KEY_STORAGE = 'cschedule.adminKey'
const STATUS_CLEAR_DELAY_MS = 3000

function getStoredAdminKey(): string {
  return String(Taro.getStorageSync(ADMIN_KEY_STORAGE) || '')
}

function setStoredAdminKey(key: string) {
  Taro.setStorageSync(ADMIN_KEY_STORAGE, key)
}

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState(getStoredAdminKey)
  const [keyInput, setKeyInput] = useState('')
  const [authed, setAuthed] = useState(false)
  const [tab, setTab] = useState<'stats' | 'schools' | 'submissions'>('stats')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [schools, setSchools] = useState<SchoolItem[]>([])
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([])
  const [schoolKeyword, setSchoolKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (adminKey) void tryAuth()
  }, [])

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

  async function tryAuth() {
    try {
      await requestApi({ path: '/admin/stats', header: { 'x-admin-api-key': adminKey } })
      setAuthed(true)
      void loadStats()
    } catch {
      setAuthed(false)
    }
  }

  function doLogin() {
    const key = keyInput.trim()
    if (!key) return
    setAdminKey(key)
    setStoredAdminKey(key)
    void tryAuth()
  }

  function doLogout() {
    setAdminKey('')
    setStoredAdminKey('')
    setAuthed(false)
    setStats(null)
    setSchools([])
    setSubmissions([])
  }

  async function loadStats() {
    setLoading(true)
    setErrorText('')
    try {
      const data = await requestApi<AdminStats>({
        path: '/admin/stats',
        header: { 'x-admin-api-key': adminKey },
      })
      setStats(data)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadSchools() {
    setLoading(true)
    setErrorText('')
    try {
      const params = new URLSearchParams()
      if (schoolKeyword) params.set('keyword', schoolKeyword)
      params.set('limit', '100')
      const data = await requestApi<{ items: SchoolItem[] }>({
        path: `/admin/schools?${params.toString()}`,
        header: { 'x-admin-api-key': adminKey },
      })
      setSchools(data.items)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadSubmissions() {
    setLoading(true)
    setErrorText('')
    try {
      const data = await requestApi<{ items: SubmissionItem[] }>({
        path: '/admin/submissions?limit=100',
        header: { 'x-admin-api-key': adminKey },
      })
      setSubmissions(data.items)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function toggleSchool(schoolId: string, enabled: boolean) {
    try {
      await requestApi({
        method: 'PATCH',
        path: `/admin/schools/${encodeURIComponent(schoolId)}`,
        header: { 'x-admin-api-key': adminKey },
        data: { enabled },
      })
      setMessage(enabled ? '已启用' : '已停用')
      void loadSchools()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '操作失败')
    }
  }

  async function updateSubmissionStatus(submissionId: string, status: string) {
    try {
      await requestApi({
        method: 'PATCH',
        path: `/admin/submissions/${encodeURIComponent(submissionId)}`,
        header: { 'x-admin-api-key': adminKey },
        data: { status },
      })
      setMessage('已更新')
      void loadSubmissions()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '操作失败')
    }
  }

  function switchTab(nextTab: 'stats' | 'schools' | 'submissions') {
    setTab(nextTab)
    setErrorText('')
    setMessage('')
    if (nextTab === 'stats') void loadStats()
    if (nextTab === 'schools') void loadSchools()
    if (nextTab === 'submissions') void loadSubmissions()
  }

  if (!authed) {
    return (
      <PageShell title='管理员' back subPage>
        {errorText && <View className='status status-error'>{errorText}</View>}
        <View className='panel'>
          <View className='field'>
            <View className='label-row'>
              <Text className='label'>Admin API Key</Text>
            </View>
            <Input
              className='input'
              password
              value={keyInput}
              placeholder='请输入管理员密钥'
              onInput={(event) => setKeyInput(event.detail.value)}
            />
          </View>
          <Button className='button' onClick={doLogin}>
            登录
          </Button>
        </View>
      </PageShell>
    )
  }

  return (
    <PageShell title='管理员' back subPage contentClassName='admin-content'>
      <View className='admin-hero'>
        <View>
          <View className='hero-title'>后台总览</View>
          <View className='hero-subtitle'>学校、申请与反馈数据管理</View>
        </View>
        <View className='refresh-button' onClick={doLogout}>
          退出
        </View>
      </View>
      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}
      {stats && (
        <View className='stat-grid'>
          <View className='soft-card stat-card'>
            <View className='stat-value'>{stats.schools.total}</View>
            <View className='stat-label'>学校总数</View>
          </View>
          <View className='soft-card stat-card'>
            <View className='stat-value'>{stats.accounts}</View>
            <View className='stat-label'>账号数</View>
          </View>
          <View className='soft-card stat-card'>
            <View className='stat-value'>{stats.pendingFeedback}</View>
            <View className='stat-label'>待反馈</View>
          </View>
        </View>
      )}
      <View className='segment'>
        <View className={'segment-item ' + (tab === 'stats' ? 'segment-active' : '')} onClick={() => switchTab('stats')}>
          <Text>概览</Text>
        </View>
        <View className={'segment-item ' + (tab === 'schools' ? 'segment-active' : '')} onClick={() => switchTab('schools')}>
          <Text>学校</Text>
        </View>
        <View className={'segment-item ' + (tab === 'submissions' ? 'segment-active' : '')} onClick={() => switchTab('submissions')}>
          <Text>申请</Text>
        </View>
      </View>

      {tab === 'stats' && stats && (
        <View className='panel card-gap'>
          <View className='row'><Text>学校总数</Text><Text className='item-title'>{stats.schools.total}</Text></View>
          <View className='row stat-row'><Text>已启用</Text><Text className='item-title stat-green'>{stats.schools.enabled}</Text></View>
          <View className='row stat-row'><Text>账号数</Text><Text className='item-title'>{stats.accounts}</Text></View>
          <View className='row stat-row'><Text>待审核申请</Text><Text className='item-title stat-yellow'>{stats.pendingSubmissions}</Text></View>
          <View className='row stat-row'><Text>待处理反馈</Text><Text className='item-title stat-red'>{stats.pendingFeedback}</Text></View>
        </View>
      )}

      {tab === 'schools' && (
        <View>
          <View className='field field-gap'>
            <Input
              className='input'
              value={schoolKeyword}
              placeholder='搜索学校'
              onInput={(event) => setSchoolKeyword(event.detail.value)}
              onConfirm={loadSchools}
            />
          </View>
          {schools.map((school) => (
            <View className='card' key={school.id}>
              <View className='row'>
                <View className='card-text-wrap'>
                  <Text className='item-title'>{school.name}</Text>
                  <Text className='item-meta'>{school.province || ''} {school.city || ''} · {school.status}</Text>
                </View>
                <View
                  className={school.enabled ? 'button-danger admin-action-btn' : 'button-secondary admin-action-btn'}
                  onClick={() => toggleSchool(school.id, !school.enabled)}
                >
                  <Text>{school.enabled ? '停用' : '启用'}</Text>
                </View>
              </View>
            </View>
          ))}
          {!loading && schools.length === 0 && <View className='empty'>无匹配学校</View>}
        </View>
      )}

      {tab === 'submissions' && (
        <View>
          {submissions.map((submission) => (
            <View className='card' key={submission.id}>
              <Text className='item-title'>{submission.schoolName}</Text>
              <Text className='item-meta'>{submission.province || ''} {submission.city || ''} · {submission.status}</Text>
              <Text className='item-meta'>{new Date(submission.createdAt).toLocaleDateString('zh-CN')}</Text>
              <View className='row admin-sub-actions'>
                <View className='button-secondary admin-action-btn' onClick={() => updateSubmissionStatus(submission.id, 'accepted')}>
                  <Text>通过</Text>
                </View>
                <View className='button-danger admin-action-btn' onClick={() => updateSubmissionStatus(submission.id, 'rejected')}>
                  <Text>驳回</Text>
                </View>
              </View>
            </View>
          ))}
          {!loading && submissions.length === 0 && <View className='empty'>无待处理申请</View>}
        </View>
      )}
      {loading && <View className='empty'>加载中...</View>}
    </PageShell>
  )
}
