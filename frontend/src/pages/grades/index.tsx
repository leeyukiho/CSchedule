import { useEffect, useState } from 'react'
import { Text, View } from '@tarojs/components'

import { getExams, getScores } from '../../shared/api/features'
import { FeatureCacheResponse, FeatureDisplayConfig, FeatureDisplayField } from '../../shared/api/types'
import { formatTime } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredBindingId } from '../../shared/storage'

type ScoreGroup = {
  id: string
  title: string
  credit?: string
  average?: string
  gpa?: string
  items: Record<string, unknown>[]
}

const DEFAULT_SCORE_ITEM_FIELDS: FeatureDisplayField[] = [
  { key: 'name', label: '课程' },
  { key: 'credit', label: '学分' },
  { key: 'score', label: '成绩', primary: true },
  { key: 'gpa', label: '绩点' },
]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function getByPath(source: unknown, path?: string) {
  if (!path) {
    return source
  }

  return path.split('.').reduce<unknown>((value, key) => asRecord(value)[key], source)
}

function getTextValue(source: Record<string, unknown>, field: FeatureDisplayField) {
  for (const key of [field.key, ...(field.fallbackKeys || [])]) {
    const value = source[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return '--'
}

function buildSummary(data: unknown, display?: FeatureDisplayConfig) {
  const fields = display?.summaryFields || [
    { key: 'totalCredit', label: '总学分' },
    { key: 'average', label: '平均分' },
    { key: 'gpa', label: '绩点' },
  ]
  const record = asRecord(data)
  const summaryList = asArray(record.summary).map(asRecord)

  return fields.slice(0, 3).map((field) => {
    const matched = summaryList.find((item) => item.label === field.label || item.key === field.key)
    const value = matched ? matched.value : record[field.key]

    return {
      label: field.label,
      value: getTextValue({ [field.key]: value }, field),
    }
  })
}

function buildScoreGroups(data: unknown, display?: FeatureDisplayConfig): ScoreGroup[] {
  const groupPath = display?.groupPath || 'semesters'
  const itemPath = display?.itemPath || 'grades'
  const groups = asArray(getByPath(data, groupPath)).map(asRecord)

  if (!groups.length) {
    const items = asArray(getByPath(data, itemPath)).map(asRecord)

    return items.length
      ? [{ id: 'all', title: display?.title || '成绩', items }]
      : []
  }

  return groups.map((group, index) => ({
    id: String(group.id || `group-${index + 1}`),
    title: String(group.title || group.label || `学期 ${index + 1}`),
    credit: typeof group.credit === 'string' ? group.credit : undefined,
    average: typeof group.average === 'string' ? group.average : undefined,
    gpa: typeof group.gpa === 'string' ? group.gpa : undefined,
    items: asArray(getByPath(group, itemPath)).map(asRecord),
  }))
}

function countScoreItems(groups: ScoreGroup[]) {
  return groups.reduce((count, group) => count + group.items.length, 0)
}

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

  const scoreSummary = buildSummary(scores?.data, scores?.display)
  const scoreGroups = buildScoreGroups(scores?.data, scores?.display)
  const scoreItemFields = scores?.display?.itemFields?.length
    ? scores.display.itemFields
    : DEFAULT_SCORE_ITEM_FIELDS
  const scoreCount = countScoreItems(scoreGroups)

  return (
    <PageShell title='成绩' activeTab='grades'>
      <View className='score-summary'>
        <View className='score-summary-title'>学业总览</View>
        <View className='metric-row'>
          {scoreSummary.map((item) => (
            <View className='metric' key={item.label}>
              <View className='metric-value'>{scores && scores.data ? item.value : '--'}</View>
              <View className='metric-label'>{item.label}</View>
            </View>
          ))}
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
        <View className='exam-count'>{scoreCount}</View>
      </View>
      {scoreGroups.map((group) => (
        <View className='soft-card semester-card' key={group.id}>
          <View className='semester-top'>
            <View>
              <View className='semester-title'>{group.title}</View>
              <View className='semester-stats'>
                <Text>课程：{group.items.length}</Text>
                {group.credit && <Text>学分：{group.credit}</Text>}
                {group.average && <Text>均分：{group.average}</Text>}
                {group.gpa && <Text>绩点：{group.gpa}</Text>}
              </View>
            </View>
            <View className='chevron-down' />
          </View>
          <View className='grade-list'>
            {group.items.map((item, index) => (
              <View className='grade-row' key={`${group.id}-${index}`}>
                <View className='grade-course'>{getTextValue(item, scoreItemFields[0])}</View>
                <View className='grade-fields'>
                  {scoreItemFields.slice(1).map((field) => (
                    <Text
                      className={field.primary ? 'grade-field grade-field-primary' : 'grade-field'}
                      key={field.key}
                    >
                      {field.label}：{getTextValue(item, field)}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
      {!scoreGroups.length && (
        <View className='soft-card semester-card'>
          <View className='grade-state'>{scores?.display?.emptyText || '暂无成绩缓存'}</View>
        </View>
      )}
    </PageShell>
  )
}
