import { useEffect, useMemo, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { Text, View } from '@tarojs/components'

import { getExams, getScores } from '../../shared/api/features'
import { FeatureCacheResponse, FeatureDisplayConfig, FeatureDisplayField } from '../../shared/api/types'
import { PageShell } from '../../shared/layout'
import { useDefaultShare } from '../../shared/share'
import { getStoredAccountId } from '../../shared/storage'

import './index.scss'

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

type ExamSummaryItem = {
  exam: ExamItem
  status: ExamDisplayStatus
  isToday: boolean
  showsTodayStatus: boolean
}

type ExamArrangementStatus = 'current' | 'next' | 'pending' | 'ended' | 'unscheduled'

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

function parseScoreNumber(value: unknown) {
  const number = Number.parseFloat(String(value || '').replace(/[^\d.-]/g, ''))

  return Number.isFinite(number) ? number : 0
}

function formatScoreStat(value: number, digits = 2) {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(digits)).toString() : '--'
}

function isLowScoreValue(value: unknown) {
  const text = String(value || '').trim()

  if (!text || text === '--') {
    return false
  }

  return (
    (/[\d]/.test(text) && parseScoreNumber(text) < 60) ||
    /^(不及格|不合格|缺考|缓考|作弊)$/u.test(text)
  )
}

function getScoreFieldValue(
  item: Record<string, unknown>,
  scoreItemFields: FeatureDisplayField[],
  matches: string[],
  fallbackIndex: number,
) {
  const matchedField = scoreItemFields.find((field, index) => (
    index > 0 &&
    matches.some((match) => field.key.toLowerCase().includes(match) || field.label.includes(match))
  ))
  const field = matchedField || scoreItemFields[fallbackIndex]

  return field ? getTextValue(item, field) : '--'
}

function isLowScoreItem(item: Record<string, unknown>, scoreValue: string) {
  const scoreLow = item.scoreLow

  return scoreLow === true || scoreLow === 'true' || isLowScoreValue(scoreValue)
}

function calculateScoreStats(items: Record<string, unknown>[], scoreItemFields: FeatureDisplayField[]) {
  return items.reduce(
    (stats, item) => {
      const credit = parseScoreNumber(getScoreFieldValue(item, scoreItemFields, ['credit', '学分'], 1))
      const scoreValue = getScoreFieldValue(item, scoreItemFields, ['score', 'grade', '成绩'], 2)
      const score = parseScoreNumber(scoreValue)
      const gpa = parseScoreNumber(getScoreFieldValue(item, scoreItemFields, ['gpa', '绩点'], 3))

      if (credit > 0 && !isLowScoreItem(item, scoreValue)) {
        stats.totalCredit += credit

        if (score > 0) {
          stats.weightedScore += score * credit
          stats.scoreCredit += credit
        }

        if (gpa > 0) {
          stats.weightedGpa += gpa * credit
          stats.gpaCredit += credit
        }
      }

      return stats
    },
    {
      totalCredit: 0,
      weightedScore: 0,
      weightedGpa: 0,
      scoreCredit: 0,
      gpaCredit: 0,
    },
  )
}

function formatCalculatedScoreStats(items: Record<string, unknown>[], scoreItemFields: FeatureDisplayField[]) {
  const stats = calculateScoreStats(items, scoreItemFields)

  return {
    totalCredit: formatScoreStat(stats.totalCredit, 1),
    average: formatScoreStat(stats.weightedScore / stats.scoreCredit, 2),
    gpa: formatScoreStat(stats.weightedGpa / stats.gpaCredit, 2),
  }
}

function getSummaryStatKey(field: FeatureDisplayField) {
  const key = field.key.toLowerCase()

  if (key.includes('totalcredit') || field.label.includes('总学分')) {
    return 'totalCredit'
  }

  if (key.includes('average') || field.label.includes('平均')) {
    return 'average'
  }

  if (key.includes('gpa') || field.label.includes('绩点')) {
    return 'gpa'
  }

  return ''
}

function buildSummary(
  data: unknown,
  display: FeatureDisplayConfig | undefined,
  groups: ScoreGroup[],
  scoreItemFields: FeatureDisplayField[],
) {
  const fields = display?.summaryFields || [
    { key: 'totalCredit', label: '总学分' },
    { key: 'average', label: '平均分' },
    { key: 'gpa', label: '绩点' },
  ]
  const record = asRecord(data)
  const summaryList = asArray(record.summary).map(asRecord)
  const calculatedStats = formatCalculatedScoreStats(
    groups.flatMap((group) => group.items),
    scoreItemFields,
  )

  return fields.slice(0, 3).map((field) => {
    const matched = summaryList.find((item) => item.label === field.label || item.key === field.key)
    const statKey = getSummaryStatKey(field)
    const value = statKey
      ? calculatedStats[statKey as keyof typeof calculatedStats]
      : (matched ? matched.value : record[field.key])

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

function getSemesterSortKey(group: Record<string, unknown>, index: number) {
  const text = [group.title, group.label, group.id]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
  const academicYearMatch = text.match(/(20\d{2})\s*[-~—至]\s*(20\d{2})/)
  const semesterMatch =
    text.match(/第?\s*([一二两12])\s*学期/) ||
    text.match(/([上下])\s*学期/) ||
    text.match(/学期\s*([12])/)
  const semesterText = semesterMatch?.[1]
  const semester =
    semesterText === '2' || semesterText === '二' || semesterText === '两' || semesterText === '下'
      ? 2
      : 1

  return academicYearMatch ? Number(academicYearMatch[1]) * 10 + semester : -index
}

function buildScoreGroups(
  data: unknown,
  display: FeatureDisplayConfig | undefined,
  scoreItemFields: FeatureDisplayField[],
): ScoreGroup[] {
  const groupPath = display?.groupPath || 'semesters'
  const itemPath = display?.itemPath || 'grades'
  const groups = asArray(getByPath(data, groupPath)).map(asRecord)

  if (!groups.length) {
    const items = asArray(getByPath(data, itemPath)).map(asRecord)
    const stats = formatCalculatedScoreStats(items, scoreItemFields)

    return items.length
      ? [{
        id: 'all',
        title: display?.title || '成绩',
        credit: stats.totalCredit,
        average: stats.average,
        gpa: stats.gpa,
        items,
      }]
      : []
  }

  return groups
    .map((group, index) => {
      const items = asArray(getByPath(group, itemPath)).map(asRecord)
      const stats = formatCalculatedScoreStats(items, scoreItemFields)

      return {
        id: String(group.id || `group-${index + 1}`),
        title: formatSemesterTitle(group.title || group.label, `第${index + 1}学期`),
        credit: stats.totalCredit,
        average: stats.average,
        gpa: stats.gpa,
        items,
        sortKey: getSemesterSortKey(group, index),
      }
    })
    .sort((left, right) => right.sortKey - left.sortKey)
    .map(({ sortKey, ...group }) => group)
}

function countScoreItems(groups: ScoreGroup[]) {
  return groups.reduce((count, group) => count + group.items.length, 0)
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

function getExamStartTime(exam: ExamItem) {
  return parseExamTimeValue(exam.startAt) || parseExamRangeTime(exam, 'start')
}

function getExamEndTime(exam: ExamItem) {
  return parseExamTimeValue(exam.endAt) || parseExamRangeTime(exam, 'end')
}

function getExamDisplayStatus(exam: ExamItem, now = Date.now()): ExamDisplayStatus {
  const endTime = getExamEndTime(exam)

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

function getCollapsedExamTimeText(item: ExamSummaryItem | undefined) {
  if (!item) {
    return ''
  }

  const timeParts = getExamTimeParts(item.exam)
  if (timeParts.date === '待定') {
    return '待安排'
  }

  const timeText = timeParts.start === '时间' && timeParts.end === '待定'
    ? '时间待定'
    : `${timeParts.start}-${timeParts.end}`

  return `${timeParts.date} ${timeText}`
}

function getCollapsedExamTitle(
  currentItem: ExamSummaryItem | undefined,
  nextItem: ExamSummaryItem | undefined,
  examCount: number,
) {
  if (currentItem && !nextItem) {
    return '当前考试'
  }

  if (!nextItem) {
    return examCount ? '暂未安排考试' : '暂无考试安排'
  }

  return `下一场考试 ${getCollapsedExamTimeText(nextItem)}`
}

function getCollapsedExamSummary(
  currentItem: ExamSummaryItem | undefined,
  nextItem: ExamSummaryItem | undefined,
  examCount: number,
) {
  if (currentItem) {
    return {
      prefix: '正在考试：',
      title: currentItem.exam.courseName || '未命名考试',
    }
  }

  if (nextItem) {
    return {
      prefix: '',
      title: nextItem.exam.courseName || '未命名考试',
    }
  }

  if (!examCount) {
    return {
      prefix: '',
      title: '请同步后查看最新考试信息',
    }
  }

  return {
    prefix: '',
    title: '',
  }
}

function isCurrentExamItem(item: ExamSummaryItem, now = Date.now()) {
  const startTime = getExamStartTime(item.exam)
  const endTime = getExamEndTime(item.exam)

  return item.status === 'upcoming' && startTime > 0 && startTime <= now && (!endTime || endTime >= now)
}

function isNextScheduledExamItem(item: ExamSummaryItem, now = Date.now()) {
  const startTime = getExamStartTime(item.exam)

  return item.status === 'upcoming' && (!startTime || startTime > now)
}

function getNextCollapsedExamItem(items: ExamSummaryItem[], now = Date.now()) {
  const nextScheduledItem = items.find((item) => isNextScheduledExamItem(item, now))

  if (nextScheduledItem) {
    return nextScheduledItem
  }

  return items.find((item) => item.status === 'unscheduled')
}

function shouldScrollCollapsedExamSummary(text: string, prefix = '') {
  return Boolean(prefix) && text.length > 18
}

function getExamArrangementStatus(item: ExamSummaryItem, now = Date.now()): ExamArrangementStatus {
  if (item.status === 'unscheduled') {
    return 'unscheduled'
  }

  if (item.status === 'finished') {
    return 'ended'
  }

  const startTime = getExamStartTime(item.exam)
  const endTime = getExamEndTime(item.exam)

  if (startTime && startTime <= now && (!endTime || endTime >= now)) {
    return 'current'
  }

  return 'pending'
}

function getExamArrangementStatusText(status: ExamArrangementStatus) {
  if (status === 'current') {
    return '当前'
  }

  if (status === 'next') {
    return '下一场'
  }

  if (status === 'pending') {
    return '待考试'
  }

  if (status === 'unscheduled') {
    return '待安排'
  }

  return '结束'
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

  const [, month = '', day = ''] =
    exam.date.match(/^\d{4}-(\d{1,2})-(\d{1,2})$/) ||
    exam.date.match(/^(\d{1,2})\/(\d{1,2})$/) ||
    []
  return month && day ? `${Number(month)}月${Number(day)}日` : exam.date
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
  useDefaultShare()
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

  const scoreItemFields = scores?.display?.itemFields?.length
    ? scores.display.itemFields
    : DEFAULT_SCORE_ITEM_FIELDS
  const scoreGroups = useMemo(
    () => buildScoreGroups(scores?.data, scores?.display, scoreItemFields),
    [scores, scoreItemFields],
  )
  const scoreSummary = useMemo(
    () => buildSummary(scores?.data, scores?.display, scoreGroups, scoreItemFields),
    [scores, scoreGroups, scoreItemFields],
  )
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

  const scoreCount = countScoreItems(scoreGroups)
  const examSections = buildExamSections(exams?.data, nowMs)
  const todayKey = getLocalDateKey()
  const examItems: ExamSummaryItem[] = examSections.flatMap((section) =>
    section.items.map((exam) => ({
      exam,
      status: section.key,
      isToday: isExamToday(exam, todayKey),
      showsTodayStatus: section.key === 'upcoming' && isExamToday(exam, todayKey),
    })),
  )
  const visibleCollapsedExamItems = examItems.filter((item) => item.status === 'upcoming' || item.status === 'unscheduled')
  const visibleExamItems = showAllExams ? examItems : visibleCollapsedExamItems
  const nextExamStartTime = Math.min(
    ...visibleExamItems
      .filter((item) => getExamArrangementStatus(item, nowMs) === 'pending')
      .map((item) => getExamStartTime(item.exam))
      .filter((time) => time > 0),
  )
  const examCount = examSections.reduce((count, section) => count + section.items.length, 0)
  const currentExamItem = examItems.find((item) => isCurrentExamItem(item, nowMs))
  const nextCollapsedExamItem = getNextCollapsedExamItem(examItems, nowMs)
  const examSummaryTitle = getCollapsedExamTitle(currentExamItem, nextCollapsedExamItem, examCount)
  const examSummarySubtitle = getCollapsedExamSummary(currentExamItem, nextCollapsedExamItem, examCount)
  const shouldShowExamSummarySubtitle = Boolean(examSummarySubtitle.prefix || examSummarySubtitle.title)
  const examSummarySubtitleScrolls = shouldScrollCollapsedExamSummary(
    examSummarySubtitle.title,
    examSummarySubtitle.prefix,
  )
  const toggleSemester = (id: string) => {
    setCollapsedSemesters((current) => ({ ...current, [id]: !(current[id] ?? true) }))
  }
  const toggleExamSection = () => {
    setShowAllExams((current) => !current)
  }
  const getExamKey = (status: ExamDisplayStatus, exam: ExamItem, index: number) =>
    `${status}-${exam.id}-${index}`

  return (
    <PageShell title='成 绩' activeTab='grades' customNav contentClassName='grades-page'>
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
      {loading && <View className='soft-card state-card'>正在读取成绩</View>}

      <View className='exam-section'>
        <View className='filter'>考试安排 <View className='exam-count'>{examCount}</View></View>
        {!examCount && (
          <View className='soft-card exam-empty'>请同步后查看最新考试信息</View>
        )}
        {examCount > 0 && (
          <View
            className={`soft-card exam-stack${showAllExams ? ' exam-stack-open' : ''}`}
            onClick={toggleExamSection}
          >
            <View className='exam-stack-main'>
              <View className={`exam-stack-title${shouldShowExamSummarySubtitle ? '' : ' exam-stack-title-only'}`}>
                {examSummaryTitle}
              </View>
              {shouldShowExamSummarySubtitle && (
                <View className='exam-stack-subtitle'>
                  {examSummarySubtitle.prefix && (
                    <Text className='exam-stack-subtitle-prefix'>{examSummarySubtitle.prefix}</Text>
                  )}
                  <View className='exam-stack-subtitle-name'>
                    {examSummarySubtitleScrolls ? (
                      <View className='exam-stack-subtitle-track exam-stack-subtitle-track-scroll'>
                        <Text className='exam-stack-subtitle-text'>
                          {examSummarySubtitle.title}
                        </Text>
                        <Text className='exam-stack-subtitle-text exam-stack-subtitle-text-copy'>
                          {examSummarySubtitle.title}
                        </Text>
                      </View>
                    ) : (
                      <Text className='exam-stack-subtitle-static'>
                        {examSummarySubtitle.title}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </View>
            <View className='exam-stack-count'>{examCount}</View>
            <View className='exam-stack-toggle' />
          </View>
        )}
        {showAllExams && visibleExamItems.length > 0 && (
          <View className='exam-list'>
            {visibleExamItems.map((item, index) => {
              const { exam, status } = item
              const timeParts = getExamTimeParts(exam)
              const examKey = getExamKey(status, exam, index)
              const baseArrangementStatus = getExamArrangementStatus(item, nowMs)
              const arrangementStatus = baseArrangementStatus === 'pending' &&
                nextExamStartTime > 0 &&
                getExamStartTime(exam) === nextExamStartTime
                ? 'next'
                : baseArrangementStatus
              const arrangementStatusText = getExamArrangementStatusText(arrangementStatus)

              return (
                <View
                  className={`soft-card exam-row exam-row-${arrangementStatus}`}
                  key={examKey}
                >
                  <View className='exam-head'>
                    <View className='exam-date'>
                      <Text>{timeParts.date}</Text>
                      <Text className='exam-date-time'>{status === 'upcoming' ? `${timeParts.start}-${timeParts.end}` : getExamStatusText(status)}</Text>
                    </View>
                    <View className='exam-main'>
                      <View className='exam-title'>{exam.courseName}</View>
                      <View className='exam-meta'>
                        <Text className='exam-meta-location'>{status === 'upcoming' ? (exam.location || '地点待安排') : getExamStatusText(status)}</Text>
                        {exam.seatNo && <Text>座位：{exam.seatNo}</Text>}
                      </View>
                    </View>
                    <View className={`exam-status exam-status-${arrangementStatus}`}>
                      {arrangementStatusText}
                    </View>
                  </View>
                </View>
              )
            })}
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
            <View className={(collapsedSemesters[group.id] ?? true) ? 'chevron-down' : 'chevron-down chevron-up'} />
          </View>
          {!(collapsedSemesters[group.id] ?? true) && (
            <View className='grade-table'>
              <View className='grade-row'>
                <View className='grade-cell grade-head grade-name'>课程名称</View>
                <View className='grade-cell grade-head grade-num'>学分</View>
                <View className='grade-cell grade-head grade-num'>成绩</View>
                <View className='grade-cell grade-head grade-num'>绩点</View>
              </View>
              {group.items.map((item, index) => {
                const scoreValue = getScoreFieldValue(item, scoreItemFields, ['score', 'grade', '成绩'], 2)
                const scoreLow = isLowScoreItem(item, scoreValue)

                return (
                  <View className={scoreLow ? 'grade-row grade-row-low' : 'grade-row'} key={`${group.id}-${index}`}>
                    <View className='grade-cell grade-name'>{getTextValue(item, scoreItemFields[0])}</View>
                    <View className='grade-cell grade-num'>{getScoreFieldValue(item, scoreItemFields, ['credit', '学分'], 1)}</View>
                    <View className={scoreLow ? 'grade-cell grade-num grade-score grade-score-low' : 'grade-cell grade-num grade-score'}>{scoreValue}</View>
                    <View className='grade-cell grade-num'>{getScoreFieldValue(item, scoreItemFields, ['gpa', '绩点'], 3)}</View>
                  </View>
                )
              })}
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
