import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'

import { getExams, getScores } from '../../shared/api/features'
import { FeatureCacheResponse } from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredBindingId } from '../../shared/storage'

export default function GradesPage() {
  const [scores, setScores] = useState<FeatureCacheResponse | null>(null)
  const [exams, setExams] = useState<FeatureCacheResponse | null>(null)
  const [errorText, setErrorText] = useState('')

  useEffect(() => {
    const bindingId = getStoredBindingId()

    if (!bindingId) {
      setErrorText('请先绑定学校账号')
      return
    }

    void Promise.all([getScores(bindingId), getExams(bindingId)])
      .then(([scoreData, examData]) => {
        setScores(scoreData)
        setExams(examData)
      })
      .catch((error) => setErrorText(error instanceof Error ? error.message : '能力缓存读取失败'))
  }, [])

  return (
    <PageShell title='成绩' activeTab='grades'>
      <View className='score-summary'>
        <View className='score-summary-title'>学业总览</View>
        <View className='metric-row'>
          <View className='metric'>
            <View className='metric-value'>{scores && scores.data ? '已同步' : '--'}</View>
            <View className='metric-label'>成绩</View>
          </View>
          <View className='metric'>
            <View className='metric-value'>{exams && exams.data ? '已同步' : '--'}</View>
            <View className='metric-label'>考试</View>
          </View>
          <View className='metric'>
            <View className='metric-value'>{formatTime(scores ? scores.syncedAt : undefined)}</View>
            <View className='metric-label'>最近同步</View>
          </View>
        </View>
        <View className='cap-icon' />
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}

      <View className='filter'>
        <Text>考试安排</Text>
        <View className='exam-count'>{exams && exams.data ? 1 : 0}</View>
      </View>
      <View className='soft-card exam-stack'>
        <View className='exam-stack-main'>
          <View className='exam-stack-title'>{exams && exams.data ? '考试缓存已同步' : '暂无考试缓存'}</View>
          <View className='exam-stack-subtitle'>同步时间：{formatTime(exams ? exams.syncedAt : undefined)}</View>
        </View>
        <View className='exam-stack-count'>{exams && exams.data ? 1 : 0}</View>
        <View className='chevron-down' />
      </View>

      <View className='filter'>
        <Text>全部学期</Text>
        <View className='chevron-down' />
      </View>
      <View className='soft-card semester-card'>
        <View className='semester-top'>
          <View>
            <View className='semester-title'>成绩缓存</View>
            <View className='semester-stats'>
              <Text>数据：{scores && scores.data ? '已同步' : '暂无'}</Text>
              <Text>同步：{formatTime(scores ? scores.syncedAt : undefined)}</Text>
            </View>
          </View>
          <View className='chevron-down' />
        </View>
        {!(scores && scores.data) && <View className='grade-state'>暂无成绩缓存</View>}
      </View>
    </PageShell>
  )
}
