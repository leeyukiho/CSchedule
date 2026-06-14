import { useMemo, useState } from 'react'
import Taro, { useRouter } from '@tarojs/taro'
import { Button, Text, View, WebView } from '@tarojs/components'

import { completeWebviewSync, uploadRawData } from '../../shared/api/raw-data'
import { DataTarget } from '../../shared/api/types'
import { PageShell } from '../../shared/layout'
import { setStoredAccountId } from '../../shared/storage'

interface WebviewPayload {
  target?: DataTarget
  contentType?: 'json' | 'html' | 'text' | 'csv' | 'xlsx' | 'ics' | 'pdf'
  termId?: string
  sourceUrl?: string
  payload?: unknown
  meta?: Record<string, unknown>
}

const DEFAULT_TARGETS: DataTarget[] = ['course']

function parseTargets(value?: string) {
  const targets = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is DataTarget =>
      ['course', 'score', 'exam', 'profile'].includes(item),
    )

  return targets.length > 0 ? targets : DEFAULT_TARGETS
}

export default function WebviewSyncPage() {
  const router = useRouter()
  const params = router.params || {}
  const initialAccountId = String(params.accountId || '')
  const schoolId = String(params.schoolId || '')
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

    if (!data.payload) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      const uploadResult = await uploadRawData(activeAccountId, {
        contextId,
        target,
        accessMode: 'webview_client_fetch',
        termId: data.termId,
        contentType: data.contentType || 'json',
        sourceUrl: data.sourceUrl || sourceUrl,
        payload: data.payload,
        meta: data.meta,
      })

      const nextAccountId = uploadResult.accountId || activeAccountId

      if (nextAccountId !== activeAccountId) {
        setActiveAccountId(nextAccountId)
      }

      setStoredAccountId(nextAccountId, schoolId)

      const nextTargets = Array.from(new Set([...completedTargets, target]))
      setCompletedTargets(nextTargets)

      const result = await completeWebviewSync(nextAccountId, {
        contextId,
        completedTargets: nextTargets,
      })

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
