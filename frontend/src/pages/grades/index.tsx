import { useEffect, useMemo, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

import { getExams, getScores } from '../../shared/api/features'
import { FeatureCacheResponse, FeatureDisplayConfig, FeatureDisplayField } from '../../shared/api/types'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId } from '../../shared/storage'

type ScoreGroup = {
  id: string
  title: string
  credit?: string
  average?: string
  gpa?: string
  items: Record<string, unknown>[]
}

type ExamItem = {
  id: string
  courseName: string
  examType: string
  date: string
  time: string
  startAt: string
  endAt: string
  location: string
  seatNo: string
  status: string
  rawStatus: string
  remark: string
}

type ExamDisplayStatus = 'upcoming' | 'unscheduled' | 'finished'

type ExamSection = {
  key: ExamDisplayStatus
  title: string
  items: ExamItem[]
}

const DEFAULT_SCORE_ITEM_FIELDS: FeatureDisplayField[] = [
  { key: 'name', label: '课程' },
  { key: 'credit', label: '学分' },
  { key: 'score', label: '成绩', primary: true },
  { key: 'gpa', label: '绩点' },
]
const STATUS_CLEAR_DELAY_MS = 3000
const EXAM_SECTION_TITLES: Record<ExamDisplayStatus, string> = {
  upcoming: '未考',
  unscheduled: '未安排',
  finished: '已结束',
}

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

function formatSemesterTitle(title: unknown, fallback: string) {
  const text = String(title || '').trim()
  const semesterMap: Record<string, string> = {
    '1': '1',
    '2': '2',
    '一': '1',
    '二': '2',
    '两': '2',
  }

  const academicYearMatch = text.match(
    /^(20\d{2}\s*[-~—至]\s*20\d{2})(?:\s*学年)?[\s._-]*(?:第)?([一二两12])(?:\s*学期)?$/,
  )

  if (academicYearMatch) {
    const year = academicYearMatch[1].replace(/\s*[-~—至]\s*/, '-')
    const semester = semesterMap[academicYearMatch[2]]

    return `${year} 第${semester}学期`
  }

  if (/^\d+$/.test(text)) {
    return semesterMap[text] ? `第${semesterMap[text]}学期` : `第${text}学期`
  }

  const semesterOnlyMatch = text.match(/^第?\s*([一二两12])\s*学期$/)

  if (semesterOnlyMatch) {
    return `第${semesterMap[semesterOnlyMatch[1]]}学期`
  }

  return text || fallback
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
    title: formatSemesterTitle(group.title || group.label, `第${index + 1}学期`),
    credit: typeof group.credit === 'string' ? group.credit : undefined,
    average: typeof group.average === 'string' ? group.average : undefined,
    gpa: typeof group.gpa === 'string' ? group.gpa : undefined,
    items: asArray(getByPath(group, itemPath)).map(asRecord),
  }))
}

function countScoreItems(groups: ScoreGroup[]) {
  return groups.reduce((count, group) => count + group.items.length, 0)
}

function getScoreFieldValueClass(field: FeatureDisplayField) {
  const fieldName = field.key.toLowerCase()

  if (fieldName.includes('credit')) {
    return 'grade-field-value grade-field-value-credit'
  }

  if (fieldName.includes('gpa')) {
    return 'grade-field-value grade-field-value-gpa'
  }

  if (field.primary || fieldName.includes('score') || fieldName.includes('grade')) {
    return 'grade-field-value grade-field-value-score'
  }

  return 'grade-field-value'
}

function hasFeatureCache(feature: FeatureCacheResponse | null) {
  return Boolean(
    feature &&
    (feature.sourceHash ||
      feature.syncedAt ||
      (feature.data !== null && feature.data !== undefined))
  )
}

function normalizeExamItem(item: Record<string, unknown>, index: number): ExamItem {
  const courseName = getTextValue(item, {
    key: 'courseName',
    label: '课程',
    fallbackKeys: ['name', 'course'],
  })
  const date = getTextValue(item, { key: 'date', label: '日期' })
  const time = getTextValue(item, { key: 'time', label: '时间' })
  const location = getTextValue(item, {
    key: 'location',
    label: '地点',
    fallbackKeys: ['classroom', 'room'],
  })
  const seatNo = getTextValue(item, {
    key: 'seatNo',
    label: '座位',
    fallbackKeys: ['seat', 'seatNumber'],
  })
  const status = getTextValue(item, { key: 'status', label: '状态' })

  return {
    id: String(item.id || item.courseCode || `${courseName}-${index}`),
    courseName,
    examType: getTextValue(item, {
      key: 'examType',
      label: '类别',
      fallbackKeys: ['type'],
    }),
    date: date === '--' ? '' : date,
    time: time === '--' ? '' : time,
    startAt: getTextValue(item, { key: 'startAt', label: '开始时间' }).replace(/^--$/, ''),
    endAt: getTextValue(item, { key: 'endAt', label: '结束时间' }).replace(/^--$/, ''),
    location: location === '--' ? '' : location,
    seatNo: seatNo === '--' ? '' : seatNo,
    status: status === '--' ? '' : status,
    rawStatus: getTextValue(item, { key: 'rawStatus', label: '状态' }),
    remark: getTextValue(item, { key: 'remark', label: '备注' }),
  }
}

function parseExamTimeValue(value: string) {
  const text = value === '--' ? '' : value
  const time = text ? Date.parse(text) : 0

  return Number.isFinite(time) ? time : 0
}

function parseExamRangeTime(exam: ExamItem, edge: 'start' | 'end') {
  const match = exam.time.match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (!exam.date || !match) {
    return 0
  }

  const dateMatch = exam.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!dateMatch) {
    return 0
  }

  const hour = edge === 'start' ? match[1] : match[3]
  const minute = edge === 'start' ? match[2] : match[4]

  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(hour),
    Number(minute),
  ).getTime()
}

function getExamSortTime(exam: ExamItem) {
  return (
    parseExamTimeValue(exam.startAt) ||
    parseExamRangeTime(exam, 'start') ||
    parseExamTimeValue(exam.endAt) ||
    Number.MAX_SAFE_INTEGER
  )
}

function getExamDisplayStatus(exam: ExamItem, now = Date.now()): ExamDisplayStatus {
  const endTime = parseExamTimeValue(exam.endAt) || parseExamRangeTime(exam, 'end')

  if (exam.status === 'finished') {
    return 'finished'
  }

  if (!exam.date || !exam.time || exam.status === 'unscheduled') {
    return 'unscheduled'
  }

  if (endTime && endTime < now) {
    return 'finished'
  }

  return 'upcoming'
}

function normalizeExamItems(items: Record<string, unknown>[], status?: ExamDisplayStatus) {
  return items.map((item, index) => {
    const exam = normalizeExamItem(item, index)

    return status ? { ...exam, status } : exam
  })
}

function buildExamSections(data: unknown, now = Date.now()): ExamSection[] {
  const record = asRecord(data)
  const directList = Array.isArray(data) ? data : []
  const upcoming = asArray(record.upcoming).map(asRecord)
  const finished = asArray(record.finished).map(asRecord)
  const fallback = directList.length ? directList.map(asRecord) : asArray(record.items).map(asRecord)
  const sourceItems = upcoming.length || finished.length
    ? [
      ...normalizeExamItems(upcoming, 'upcoming'),
      ...normalizeExamItems(finished, 'finished'),
    ]
    : normalizeExamItems(fallback)
  const grouped: Record<ExamDisplayStatus, ExamItem[]> = {
    upcoming: [],
    unscheduled: [],
    finished: [],
  }

  sourceItems.forEach((exam) => {
    grouped[getExamDisplayStatus(exam, now)].push(exam)
  })

  grouped.upcoming.sort((left, right) => getExamSortTime(left) - getExamSortTime(right))
  grouped.unscheduled.sort((left, right) => left.courseName.localeCompare(right.courseName, 'zh-Hans-CN'))
  grouped.finished.sort((left, right) => getExamSortTime(left) - getExamSortTime(right))

  return (['upcoming', 'unscheduled', 'finished'] as ExamDisplayStatus[])
    .map((key) => ({
      key,
      title: EXAM_SECTION_TITLES[key],
      items: grouped[key],
    }))
    .filter((section) => section.items.length > 0)
}

function getExamStatusText(status: ExamDisplayStatus) {
  return EXAM_SECTION_TITLES[status]
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function isExamToday(exam: ExamItem, todayKey = getLocalDateKey()) {
  const match = exam.date.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

  if (!match) {
    return false
  }

  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` === todayKey
}

function getExamDateText(exam: ExamItem) {
  if (!exam.date) {
    return '待定'
  }

  const [, month = '', day = ''] = exam.date.match(/^\d{4}-(\d{2})-(\d{2})$/) || []
  return month && day ? `${month}/${day}` : exam.date
}

function getExamTimeParts(exam: ExamItem) {
  const match = exam.time.match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (match) {
    return {
      date: getExamDateText(exam),
      start: `${match[1].padStart(2, '0')}:${match[2]}`,
      end: `${match[3].padStart(2, '0')}:${match[4]}`,
    }
  }

  if (exam.time) {
    return {
      date: getExamDateText(exam),
      start: exam.time,
      end: '结束待定',
    }
  }

  return {
    date: getExamDateText(exam),
    start: '时间',
    end: '待定',
  }
}

export default function GradesPage() {
  const [scores, setScores] = useState<FeatureCacheResponse | null>(null)
  const [exams, setExams] = useState<FeatureCacheResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [collapsedSemesters, setCollapsedSemesters] = useState<Record<string, boolean>>({})
  const [showAllExams, setShowAllExams] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!errorText) {
      return undefined
    }

    const timer = setTimeout(() => setErrorText(''), STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [errorText])

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000)

    return () => clearInterval(timer)
  }, [])

  useDidShow(() => {
    const accountId = getStoredAccountId()

    if (!accountId) {
      setScores(null)
      setExams(null)
      setLoading(false)
      setErrorText('')
      setCollapsedSemesters({})
      setShowAllExams(false)
      return
    }

    setLoading(true)
    setErrorText('')
    void Promise.all([
      getScores(accountId),
      getExams(accountId),
    ])
      .then(async ([cachedScoreData, cachedExamData]) => {
        setScores(cachedScoreData)
        setExams(cachedExamData)
        setCollapsedSemesters({})
        setShowAllExams(false)

        const [scoreData, examData] = await Promise.all([
          hasFeatureCache(cachedScoreData)
            ? cachedScoreData
            : getScores(accountId, undefined, { forceRefresh: true }),
          hasFeatureCache(cachedExamData)
            ? cachedExamData
            : getExams(accountId, undefined, { forceRefresh: true }),
        ])

        setScores(scoreData)
        setExams(examData)
      })
      .catch((error) => setErrorText(error instanceof Error ? error.message : '成绩读取失败'))
      .finally(() => setLoading(false))
  })

  const scoreSummary = useMemo(() => buildSummary(scores?.data, scores?.display), [scores])
  const scoreGroups = useMemo(() => buildScoreGroups(scores?.data, scores?.display), [scores])
  useEffect(() => {
    setCollapsedSemesters((current) => {
      const next = { ...current }
      let changed = false

      scoreGroups.forEach((group) => {
        if (!(group.id in next)) {
          next[group.id] = true
          changed = true
        }
      })

      return changed ? next : current
    })
  }, [scoreGroups])

  const scoreItemFields = scores?.display?.itemFields?.length
    ? scores.display.itemFields
    : DEFAULT_SCORE_ITEM_FIELDS
  const scoreCount = countScoreItems(scoreGroups)
  const examSections = buildExamSections(exams?.data, nowMs)
  const todayKey = getLocalDateKey()
  const examItems = examSections.flatMap((section) =>
    section.items.map((exam) => ({
      exam,
      status: section.key,
      isToday: isExamToday(exam, todayKey),
      showsTodayStatus: section.key === 'upcoming' && isExamToday(exam, todayKey),
    })),
  )
  const visibleCollapsedExamItems = examItems.filter((item) => item.status === 'upcoming' || item.isToday)
  const visibleExamItems = showAllExams ? examItems : visibleCollapsedExamItems
  const examCount = examSections.reduce((count, section) => count + section.items.length, 0)
  const shouldShowCollapsedExamPlaceholder = !showAllExams && examCount > 0 && visibleCollapsedExamItems.length === 0
  const toggleSemester = (id: string) => {
    setCollapsedSemesters((current) => ({ ...current, [id]: !current[id] }))
  }
  const toggleExamSection = () => {
    setShowAllExams((current) => !current)
  }

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
      {loading && <View className='soft-card state-card'>正在读取成绩...</View>}

      <View className='exam-list'>
        <View className='exam-section-title'>
          <View>
            <Text>考试安排</Text>
            <View className='exam-count'>{examCount}</View>
          </View>
          <View className='exam-toggle' onClick={toggleExamSection}>
            <View className={showAllExams ? 'chevron-down chevron-up' : 'chevron-down'} />
          </View>
        </View>
        {visibleExamItems.map(({ exam, status, isToday, showsTodayStatus }, index) => {
          const timeParts = getExamTimeParts(exam)

          return (
            <View
              className={`soft-card exam-card exam-card-${status}${isToday ? ' exam-card-today' : ''}`}
              key={`${status}-${exam.id}-${index}`}
            >
              <View className='exam-time-column'>
                <Text className='exam-date'>{timeParts.date}</Text>
                <Text className='exam-time-text'>
                  {timeParts.start}
                </Text>
                <Text className='exam-time-separator'>~</Text>
                <Text className='exam-time-text'>
                  {timeParts.end}
                </Text>
              </View>
              <View className='exam-main'>
                <View className='exam-course'>{exam.courseName}</View>
                <View className='exam-meta'>
                  <Text>{exam.location || '地点待安排'}</Text>
                  {exam.seatNo && <Text>座位：{exam.seatNo}</Text>}
                </View>
                {exam.remark && exam.remark !== '--' && <View className='exam-remark'>{exam.remark}</View>}
              </View>
              <View className={`exam-status exam-status-${showsTodayStatus ? 'today' : status}`}>
                {showsTodayStatus ? '今日' : getExamStatusText(status)}
              </View>
            </View>
          )
        })}
        {shouldShowCollapsedExamPlaceholder && (
          <View className='soft-card exam-card'>
            <View>
              <View className='exam-course'>暂未安排任何考试</View>
              <View className='exam-meta'>
                <Text>点击右侧箭头可查看全部考试记录</Text>
              </View>
            </View>
          </View>
        )}
        {!examCount && (
          <View className='soft-card exam-empty-card'>
            <View className='exam-empty-title'>暂无考试安排</View>
            <View className='exam-empty-desc'>请同步后查看最新考试信息</View>
          </View>
        )}
      </View>

      <View className='filter'>
        <Text>全部学期</Text>
        <View className='exam-count'>{scoreCount}</View>
      </View>
      {scoreGroups.map((group) => (
        <View className='soft-card semester-card' key={group.id}>
          <View className='semester-top' onClick={() => toggleSemester(group.id)}>
            <View>
              <View className='semester-title'>{group.title}</View>
              <View className='semester-stats'>
                <Text className='semester-stat'>
                  <Text>课程：</Text>
                  <Text className='semester-stat-value semester-stat-value-courses'>{group.items.length}</Text>
                </Text>
                {group.credit && (
                  <Text className='semester-stat'>
                    <Text>学分：</Text>
                    <Text className='semester-stat-value semester-stat-value-decimal'>{group.credit}</Text>
                  </Text>
                )}
                {group.average && (
                  <Text className='semester-stat'>
                    <Text>均分：</Text>
                    <Text className='semester-stat-value semester-stat-value-decimal'>{group.average}</Text>
                  </Text>
                )}
                {group.gpa && (
                  <Text className='semester-stat'>
                    <Text>绩点：</Text>
                    <Text className='semester-stat-value semester-stat-value-gpa'>{group.gpa}</Text>
                  </Text>
                )}
              </View>
            </View>
            <View className={collapsedSemesters[group.id] ? 'chevron-down' : 'chevron-down chevron-up'} />
          </View>
          {!collapsedSemesters[group.id] && (
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
                        <Text>{field.label}：</Text>
                        <Text className={getScoreFieldValueClass(field)}>{getTextValue(item, field)}</Text>
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
      {!scoreGroups.length && (
        <View className='soft-card semester-card'>
          <View className='grade-state'>{scores?.display?.emptyText || '暂无成绩数据'}</View>
        </View>
      )}
    </PageShell>
  )
}
