import { useMemo, useRef, useState } from 'react'
import Taro, { useDidShow } from '@tarojs/taro'
import { Picker, RootPortal, Text, View, type ITouchEvent } from '@tarojs/components'

import { getExams } from '../../shared/api/features'
import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureCacheResponse, FeatureDisplayField, TimetableCacheResponse } from '../../shared/api/types'
import {
  DEFAULT_SECTION_TIMES,
  formatCourseTime,
  getCourseSections,
  getSectionTimeMap,
} from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { useDefaultShare } from '../../shared/share'
import { getStoredAuthState, getStoredTermStarts } from '../../shared/storage'
import {
  TermOption,
  buildTermOptions,
  courseRunsInWeek,
  dedupeAndSortTerms,
  getAcademicYear,
  getCurrentTeachingWeek,
  getTodayTermOption,
  getWeekStartDate,
  isSecondSemester,
} from '../../shared/term'

import './index.scss'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const DEFAULT_SECTION_COUNT = 13
const MAX_WEEK = 20
const LEFT_WIDTH_PERCENT = 8
const DAY_WIDTH_PERCENT = 13.14
const HEADER_HEIGHT = 100
const ROW_HEIGHT = 110
const LESSON_HORIZONTAL_GAP = 3
const LESSON_VERTICAL_GAP = 3
const EXAM_MIN_HEIGHT = 64
const WEEK_SWIPE_THRESHOLD = 48
const COURSE_COLOR_HUE_STEP = 137.508
const COURSE_COLOR_GENERATION_LIMIT = 2160
const COURSE_COLOR_YELLOW_MIN_HUE = 35
const COURSE_COLOR_YELLOW_MAX_HUE = 70
const DEFAULT_COURSE_FIELDS: FeatureDisplayField[] = [
  { key: 'name', label: '课程', primary: true },
  { key: 'classroom', label: '教室', fallbackKeys: ['location'] },
]

interface CourseColor {
  text: string
  border: string
  background: string
}

const LESSON_COLOR_PRESETS: CourseColor[] = [
  { text: '#1d4ed8', border: '#9cc4ff', background: '#d9ebff' },
  { text: '#047857', border: '#a7e4be', background: '#daf8e5' },
  { text: '#6d28d9', border: '#d6b7ff', background: '#efe0ff' },
  { text: '#e11d48', border: '#ffc1ca', background: '#ffe0e3' },
  { text: '#0f766e', border: '#99f6e4', background: '#d8fbf6' },
  { text: '#be185d', border: '#f9a8d4', background: '#fce7f3' },
  { text: '#4338ca', border: '#a5b4fc', background: '#e0e7ff' },
  { text: '#0369a1', border: '#7dd3fc', background: '#e0f2fe' },
  { text: '#4d7c0f', border: '#bef264', background: '#ecfccb' },
  { text: '#a21caf', border: '#f0abfc', background: '#fae8ff' },
  { text: '#0e7490', border: '#67e8f9', background: '#cffafe' },
  { text: '#166534', border: '#86efac', background: '#dcfce7' },
  { text: '#7e22ce', border: '#d8b4fe', background: '#f3e8ff' },
]

interface LessonDetailRow {
  label: string
  value: string
}

interface PositionedLesson {
  id: string
  type: 'course' | 'exam'
  name: string
  nameLines: string[]
  room: string
  roomLines: string[]
  teacher: string
  weekdayText: string
  section: string
  weeksText: string
  timeText: string
  detailRows: LessonDetailRow[]
  style: string
}

type PositionedScheduleItem = PositionedLesson

interface ScheduleExamItem {
  id: string
  courseName: string
  date: string
  time: string
  startAt: string
  endAt: string
  location: string
  seatNo: string
}

interface WeekOption {
  value: number
  label: string
}

interface WeekdayColumn {
  weekday: string
  dateText: string
  dateKey: string
  isToday: boolean
  style: string
}

interface TimetableGridLine {
  id: string
  style: string
}

interface SchedulePageInstance {
  onTabReselect?: () => void
}

function getCourseValue(course: CourseItem, field: FeatureDisplayField) {
  for (const key of [field.key, ...(field.fallbackKeys || [])]) {
    const value = course[key as keyof CourseItem]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

function normalizeCourseColorKey(name: string) {
  return String(name || '').trim().replace(/\s+/g, '').toLowerCase()
}

function hashCourseName(name: string) {
  return Array.from(name).reduce((hash, char) => {
    return ((hash << 5) - hash + char.charCodeAt(0)) | 0
  }, 0)
}

function hueToRgb(p: number, q: number, t: number) {
  let next = t

  if (next < 0) {
    next += 1
  }

  if (next > 1) {
    next -= 1
  }

  if (next < 1 / 6) {
    return p + (q - p) * 6 * next
  }

  if (next < 1 / 2) {
    return q
  }

  if (next < 2 / 3) {
    return p + (q - p) * (2 / 3 - next) * 6
  }

  return p
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 360) + 360) % 360 / 360
  const s = saturation / 100
  const l = lightness / 100
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channels = [
    hueToRgb(p, q, h + 1 / 3),
    hueToRgb(p, q, h),
    hueToRgb(p, q, h - 1 / 3),
  ]

  return `#${channels
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0'))
    .join('')}`
}

function normalizeCourseHue(hue: number) {
  const normalized = ((hue % 360) + 360) % 360

  if (normalized >= COURSE_COLOR_YELLOW_MIN_HUE && normalized <= COURSE_COLOR_YELLOW_MAX_HUE) {
    return COURSE_COLOR_YELLOW_MAX_HUE + 14 + (normalized - COURSE_COLOR_YELLOW_MIN_HUE)
  }

  return normalized
}

function getCourseColorSignature(color: CourseColor) {
  return `${color.text}|${color.border}|${color.background}`
}

function findPresetCourseColor(name: string, usedColors: Set<string>) {
  const start = Math.abs(hashCourseName(name)) % LESSON_COLOR_PRESETS.length

  for (let offset = 0; offset < LESSON_COLOR_PRESETS.length; offset += 1) {
    const color = LESSON_COLOR_PRESETS[(start + offset) % LESSON_COLOR_PRESETS.length]

    if (!usedColors.has(getCourseColorSignature(color))) {
      return color
    }
  }

  return null
}

function generateCourseColor(name: string, usedColors: Set<string>): CourseColor {
  const presetColor = findPresetCourseColor(name, usedColors)

  if (presetColor) {
    return presetColor
  }

  const hash = Math.abs(hashCourseName(name))
  let attempt = 0

  while (attempt < COURSE_COLOR_GENERATION_LIMIT) {
    const hue = normalizeCourseHue(hash + attempt * COURSE_COLOR_HUE_STEP)
    const variant = Math.floor(attempt / 360)
    const color = {
      text: hslToHex(hue, 64 + (variant % 3) * 4, 32 + (variant % 3) * 2),
      border: hslToHex(hue, 76 + (variant % 3) * 3, 76 + (variant % 2) * 3),
      background: hslToHex(hue, 82 + (variant % 3) * 2, 91 + (variant % 2)),
    }

    if (!usedColors.has(getCourseColorSignature(color))) {
      return color
    }

    attempt += 1
  }

  return {
    text: hslToHex(normalizeCourseHue(hash), 68, 35),
    border: hslToHex(normalizeCourseHue(hash), 82, 78),
    background: hslToHex(normalizeCourseHue(hash), 86, 92),
  }
}

function buildCourseColorMap(courses: CourseItem[], primaryCourseField: FeatureDisplayField) {
  const courseNames = new Map<string, string>()

  courses.forEach((course) => {
    const name = (getCourseValue(course, primaryCourseField) || course.name || '').trim()

    if (name) {
      courseNames.set(normalizeCourseColorKey(name), name)
    }
  })

  const names = Array.from(courseNames.values()).sort((left, right) => {
    const hashDelta = hashCourseName(left) - hashCourseName(right)

    return hashDelta || left.localeCompare(right, 'zh-Hans-CN')
  })
  const colors = new Map<string, CourseColor>()
  const usedColors = new Set<string>()

  names.forEach((name) => {
    const color = generateCourseColor(name, usedColors)

    usedColors.add(getCourseColorSignature(color))
    colors.set(normalizeCourseColorKey(name), color)
  })

  return colors
}

function getCourseColorStyle(name: string, colors: Map<string, CourseColor>) {
  const color = colors.get(normalizeCourseColorKey(name)) || LESSON_COLOR_PRESETS[0]

  return `color:${color.text};border:1rpx solid ${color.border};background:${color.background}`
}

function mergeTermOptions(current: TermOption[], next: TermOption[]) {
  return dedupeAndSortTerms([...current, ...next])
}

function mergeTermStarts(defaultStarts: Record<string, string> | undefined, localStarts: Record<string, string>) {
  return {
    ...(defaultStarts || {}),
    ...localStarts,
  }
}

function isTodayAcademicTerm(term: TermOption | null, fallbackTermId = '') {
  const today = new Date()
  const month = today.getMonth()
  const academicStartYear = month >= 8 ? today.getFullYear() : today.getFullYear() - 1
  const secondSemester = month >= 1 && month < 8

  return (
    getAcademicYear(term, fallbackTermId) === academicStartYear &&
    isSecondSemester(term, fallbackTermId) === secondSemester
  )
}

function resolveTermOptionId(term: TermOption | null, termId: string) {
  if (!termId || term?.id === termId) {
    return term
  }

  return {
    id: termId,
    label: term?.label || termId,
  }
}

function buildWeekOptions(): WeekOption[] {
  return Array.from({ length: MAX_WEEK }, (_, index) => {
    const week = index + 1

    return { value: week, label: `第${week}周` }
  })
}

function formatMonthDay(date: Date) {
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function normalizeDateKey(date: string) {
  const match = String(date || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)

  if (!match) {
    return ''
  }

  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function parseClockMinutes(value: string) {
  const match = String(value || '').match(/(\d{1,2})\s*:\s*(\d{2})/)

  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }

  return hour * 60 + minute
}

function parseExamTimeValue(value: string) {
  const time = value ? Date.parse(value) : 0

  return Number.isFinite(time) ? time : 0
}

function getDateKeyFromTimeValue(value: string) {
  const time = parseExamTimeValue(value)

  return time ? getLocalDateKey(new Date(time)) : ''
}

function parseExamRangeTime(exam: Pick<ScheduleExamItem, 'date' | 'time'>, edge: 'start' | 'end') {
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

function getTextValue(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key]

    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }

  return ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function normalizeScheduleExamItem(item: Record<string, unknown>, index: number): ScheduleExamItem {
  const courseName = getTextValue(item, ['courseName', 'name', 'course']) || '未命名考试'
  const startAt = getTextValue(item, ['startAt'])
  const endAt = getTextValue(item, ['endAt'])

  return {
    id: String(item.id || item.courseCode || `${courseName}-${index}`),
    courseName,
    date: getTextValue(item, ['date']) || getDateKeyFromTimeValue(startAt) || getDateKeyFromTimeValue(endAt),
    time: getTextValue(item, ['time']),
    startAt,
    endAt,
    location: getTextValue(item, ['location', 'classroom', 'room']),
    seatNo: getTextValue(item, ['seatNo', 'seat', 'seatNumber']),
  }
}

function buildScheduleExamItems(data: unknown): ScheduleExamItem[] {
  const record = asRecord(data)
  const directList = Array.isArray(data) ? data : []
  const upcoming = asArray(record.upcoming)
  const finished = asArray(record.finished)
  const fallback = directList.length ? directList : asArray(record.items)
  const sourceItems = upcoming.length || finished.length
    ? [...upcoming, ...finished]
    : fallback

  return sourceItems.map((item, index) => normalizeScheduleExamItem(asRecord(item), index))
}

function getExamStartTime(exam: ScheduleExamItem) {
  return parseExamTimeValue(exam.startAt) || parseExamRangeTime(exam, 'start') || 0
}

function getExamEndTime(exam: ScheduleExamItem) {
  return parseExamTimeValue(exam.endAt) || parseExamRangeTime(exam, 'end') || 0
}

function getExamTimeParts(exam: ScheduleExamItem) {
  const match = exam.time.match(/(\d{1,2})\s*:\s*(\d{2})\s*[~\-—至]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (match) {
    return {
      start: `${match[1].padStart(2, '0')}:${match[2]}`,
      end: `${match[3].padStart(2, '0')}:${match[4]}`,
    }
  }

  const startAt = getExamStartTime(exam)
  const endAt = getExamEndTime(exam)

  if (startAt || endAt) {
    return {
      start: startAt ? formatClockTime(new Date(startAt)) : '开始待定',
      end: endAt ? formatClockTime(new Date(endAt)) : '结束待定',
    }
  }

  return {
    start: exam.time || '时间',
    end: '待定',
  }
}

function formatClockTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function getExamTimeText(exam: ScheduleExamItem) {
  const timeParts = getExamTimeParts(exam)

  if (!exam.time && !exam.startAt && !exam.endAt) {
    return '时间待定'
  }

  return `${timeParts.start}-${timeParts.end}`
}

async function getExamsSafely(accountId: string, termId?: string) {
  try {
    return await getExams(accountId, termId)
  } catch {
    return null
  }
}

function formatSectionsText(sections: number[]) {
  if (sections.length === 0) {
    return ''
  }

  if (sections.length === 1) {
    return `${sections[0]}节`
  }

  return `${sections[0]}-${sections[sections.length - 1]}节`
}

function formatWeeksText(weeks: number[] | undefined) {
  const sortedWeeks = Array.from(new Set(Array.isArray(weeks) ? weeks.map(Number) : []))
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((a, b) => a - b)

  if (sortedWeeks.length === 0) {
    return '整学期'
  }

  const ranges: string[] = []
  let start = sortedWeeks[0]
  let end = sortedWeeks[0]

  for (let index = 1; index < sortedWeeks.length; index += 1) {
    const week = sortedWeeks[index]

    if (week === end + 1) {
      end = week
      continue
    }

    ranges.push(start === end ? String(start) : `${start}-${end}`)
    start = week
    end = week
  }

  ranges.push(start === end ? String(start) : `${start}-${end}`)

  return `第${ranges.join('、')}周`
}

function getLessonTextUnit(char: string) {
  if (/^[（）]$/.test(char)) {
    return 1
  }

  return /^[\x00-\x7F]$/.test(char) ? 1 : 2
}

function splitLessonText(value: string, fallback: string, lineLength: number) {
  const chars = Array.from((String(value || '').trim() || fallback))
  const maxUnits = lineLength * 2
  const lines: string[] = []
  let currentLine = ''
  let currentUnits = 0

  chars.forEach((char) => {
    const charUnits = getLessonTextUnit(char)

    if (currentLine && currentUnits + charUnits > maxUnits) {
      lines.push(currentLine)
      currentLine = ''
      currentUnits = 0
    }

    currentLine += char
    currentUnits += charUnits
  })

  if (currentLine) {
    lines.push(currentLine)
  }

  return lines.length > 0 ? lines : [fallback]
}

function splitCourseName(name: string) {
  return splitLessonText(name, '课程', 3)
}

function splitRoomName(room: string) {
  return splitLessonText(room, '地点', 4)
}

export default function SchedulePage() {
  useDefaultShare()
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [termOptions, setTermOptions] = useState<TermOption[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [latestTermId, setLatestTermId] = useState('')
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [exams, setExams] = useState<FeatureCacheResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [selectedItem, setSelectedItem] = useState<PositionedScheduleItem | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const resetToTodayRef = useRef<() => void>(() => undefined)

  const sectionTimeMap = useMemo(
    () => getSectionTimeMap(timetable?.sectionTimes, timetable?.providerId),
    [timetable?.providerId, timetable?.sectionTimes],
  )
  const maxCourseSection = useMemo(
    () =>
      (timetable?.courses || []).reduce((max, course) => {
        const courseMax = Math.max(
          0,
          ...getCourseSections(course)
            .map(Number)
            .filter((section) => Number.isFinite(section) && section > 0),
        )

        return Math.max(max, courseMax)
      }, 0),
    [timetable?.courses],
  )
  const sectionCount = useMemo(() => {
    const maxConfiguredSection = Math.max(
      0,
      ...Object.keys(sectionTimeMap)
        .map(Number)
        .filter((section) => Number.isFinite(section) && section > 0),
    )

    return Math.max(DEFAULT_SECTION_COUNT, maxCourseSection, maxConfiguredSection)
  }, [maxCourseSection, sectionTimeMap])
  const timetableStyle = useMemo(
    () => `height:${HEADER_HEIGHT + sectionCount * ROW_HEIGHT}rpx;`,
    [sectionCount],
  )
  const periods = useMemo(
    () =>
      Array.from({ length: sectionCount }, (_, index) => {
        const section = index + 1
        const time = sectionTimeMap[section] || DEFAULT_SECTION_TIMES[section]
        const isLastSection = section === sectionCount

        return {
          section,
          start: time ? time.start : '',
          end: time ? time.end : '',
          style: [
            'left:0;',
            `top:${HEADER_HEIGHT + index * ROW_HEIGHT}rpx`,
            `width:${LEFT_WIDTH_PERCENT}%;`,
            isLastSection ? 'bottom:0;' : `height:${ROW_HEIGHT}rpx`,
          ].join(';'),
        }
      }),
    [sectionCount, sectionTimeMap],
  )
  const rowGridLines = useMemo<TimetableGridLine[]>(
    () =>
      Array.from({ length: sectionCount + 1 }, (_, index) => ({
        id: `row-${index}`,
        style: index === sectionCount ? 'bottom:0;' : `top:${HEADER_HEIGHT + index * ROW_HEIGHT}rpx;`,
      })),
    [sectionCount],
  )
  const columnGridLines = useMemo<TimetableGridLine[]>(
    () => {
      const dayBoundaries = Array.from({ length: WEEKDAYS.length }, (_, index) => ({
        id: `day-${index + 1}`,
        style: index === WEEKDAYS.length - 1
          ? 'right:0;'
          : `left:${LEFT_WIDTH_PERCENT + DAY_WIDTH_PERCENT * (index + 1)}%;`,
      }))

      return [
        { id: 'start', style: 'left:0;' },
        { id: 'time', style: `left:${LEFT_WIDTH_PERCENT}%;` },
        ...dayBoundaries,
      ]
    },
    [],
  )

  const selectedTermIndex = Math.max(
    termOptions.findIndex((term) => term.id === (selectedTermId || timetable?.termId || '')),
    0,
  )
  const selectedTerm = termOptions[selectedTermIndex] || null
  const activeTermId = timetable?.termId || selectedTermId || ''
  const activeTerm = useMemo(
    () => resolveTermOptionId(
      termOptions.find((term) => term.id === activeTermId) || selectedTerm,
      activeTermId,
    ),
    [activeTermId, selectedTerm, termOptions],
  )
  const weekOptions = useMemo(() => buildWeekOptions(), [])
  const selectedWeekIndex = Math.max(
    weekOptions.findIndex((week) => week.value === selectedWeek),
    0,
  )
  const selectedTermLabel = termOptions[selectedTermIndex]?.label || timetable?.termId || '当前学期'
  const selectedWeekLabel = weekOptions[selectedWeekIndex]?.label || '第1周'
  const termPickerRange = useMemo(
    () => (termOptions.length > 0 ? termOptions.map((term) => term.label) : [selectedTermLabel]),
    [selectedTermLabel, termOptions],
  )
  const weekPickerRange = useMemo(
    () => weekOptions.map((week) => week.label),
    [weekOptions],
  )
  const courseFields = timetable?.display?.itemFields?.length
    ? timetable.display.itemFields
    : DEFAULT_COURSE_FIELDS
  const primaryCourseField = courseFields.find((field) => field.primary) || courseFields[0]
  const roomCourseField =
    courseFields.find((field) => ['classroom', 'location', 'campus'].includes(field.key)) ||
    DEFAULT_COURSE_FIELDS[1]
  const effectiveTermStarts = useMemo(
    () => mergeTermStarts(timetable?.termStarts, termStarts),
    [termStarts, timetable?.termStarts],
  )
  const currentTeachingTerm = useMemo(
    () => {
      if (isTodayAcademicTerm(activeTerm, activeTermId)) {
        return activeTerm
      }

      return getTodayTermOption(termOptions) || activeTerm
    },
    [activeTerm, activeTermId, termOptions],
  )
  const currentTeachingWeek = useMemo(
    () => getCurrentTeachingWeek(
      currentTeachingTerm,
      currentTeachingTerm?.id || activeTermId,
      effectiveTermStarts,
    ),
    [activeTermId, currentTeachingTerm, effectiveTermStarts],
  )
  const currentTeachingTermId = currentTeachingTerm?.id || ''
  const showBackThisWeekButton = Boolean(
    !loading &&
      selectedWeek !== null &&
      (
        selectedWeek !== currentTeachingWeek ||
        (currentTeachingTermId && activeTermId && currentTeachingTermId !== activeTermId)
      ),
  )
  const weekdays = useMemo<WeekdayColumn[]>(() => {
    const startDate = getWeekStartDate(activeTerm, selectedWeek, activeTermId, effectiveTermStarts)
    const today = new Date()

    return WEEKDAYS.map((weekday, index) => {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + index)
      const isToday =
        date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
      const dateText = formatMonthDay(date)

      return {
        weekday,
        dateText,
        dateKey: getLocalDateKey(date),
        isToday,
        style: [
          `left:${LEFT_WIDTH_PERCENT + DAY_WIDTH_PERCENT * index}%;`,
          'top:0;',
          index === WEEKDAYS.length - 1 ? 'right:0;' : `width:${DAY_WIDTH_PERCENT}%;`,
          `height:${HEADER_HEIGHT}rpx`,
        ].join(''),
      }
    })
  }, [activeTerm, activeTermId, effectiveTermStarts, selectedWeek])
  const courseColorMap = useMemo(
    () => buildCourseColorMap(timetable?.courses || [], primaryCourseField),
    [primaryCourseField, timetable?.courses],
  )

  const lessons = useMemo<PositionedLesson[]>(() => {
    return (timetable ? timetable.courses : [])
      .filter((course) => {
        if (selectedWeek === null) {
          return true
        }

        return courseRunsInWeek(course, selectedWeek)
      })
      .map((course, index) => toLesson(course, index, courseColorMap))
      .filter((lesson): lesson is PositionedLesson => Boolean(lesson))
  }, [
    courseColorMap,
    primaryCourseField,
    roomCourseField,
    sectionCount,
    sectionTimeMap,
    selectedWeek,
    timetable,
  ])
  const examItems = useMemo<PositionedLesson[]>(() => {
    const weekDateIndex = new Map(weekdays.map((weekday, index) => [weekday.dateKey, index]))

    return buildScheduleExamItems(exams?.data)
      .map((exam, index) => toExamItem(exam, index, weekDateIndex))
      .filter((exam): exam is PositionedLesson => Boolean(exam))
  }, [
    exams,
    sectionCount,
    sectionTimeMap,
    weekdays,
  ])

  useDidShow(() => {
    const authState = getStoredAuthState()
    const id = authState.accountId
    const storedTermStarts = getStoredTermStarts()
    const page = Taro.getCurrentInstance().page as SchedulePageInstance | undefined
    if (page) {
      page.onTabReselect = () => resetToTodayRef.current()
    }

    setAccountId(id)
    setTermStarts(storedTermStarts)

    if (!id) {
      setTimetable(null)
      setExams(null)
      setTermOptions([])
      setSelectedTermId('')
      setLatestTermId('')
      setSelectedWeek(null)
      setLoading(false)
      setErrorText('')
      return
    }

    if (id) {
      void loadTimetable(id, '', storedTermStarts, { resetToToday: true })
    }
  })

  async function loadTimetable(
    id = accountId,
    termId = selectedTermId,
    starts = termStarts,
    options?: { resetToToday?: boolean },
  ) {
    if (!id) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      const requestedTermId = options?.resetToToday ? '' : termId
      const [nextTimetable, nextExams] = await Promise.all([
        getTimetable(id, requestedTermId || undefined),
        getExamsSafely(id, requestedTermId || undefined),
      ])
      const nextTermOptions = buildTermOptions(nextTimetable)
      const todayTerm = requestedTermId ? null : getTodayTermOption(nextTermOptions)

      if (!requestedTermId && nextTimetable.termId) {
        setLatestTermId(nextTimetable.termId)
      }

      if (todayTerm && nextTimetable.termId !== todayTerm.id) {
        const [todayTimetable, todayExams] = await Promise.all([
          getTimetable(id, todayTerm.id),
          getExamsSafely(id, todayTerm.id),
        ])
        const todayTermOptions = buildTermOptions(todayTimetable)
        const mergedTermOptions = mergeTermOptions(nextTermOptions, todayTermOptions)
        const todaySelectedTerm =
          todayTermOptions.find((term) => term.id === (todayTimetable.termId || todayTerm.id)) ||
          todayTerm

        setTimetable(todayTimetable)
        setExams(todayExams)
        setTermOptions((current) => mergeTermOptions(current, mergedTermOptions))
        setSelectedTermId(todayTimetable.termId || todayTerm.id)
        setSelectedWeek(getCurrentTeachingWeek(
          todaySelectedTerm,
          todayTimetable.termId || todayTerm.id,
          mergeTermStarts(todayTimetable.termStarts, starts),
        ))
        return
      }

      const nextSelectedTerm =
        nextTermOptions.find((term) => term.id === (nextTimetable.termId || requestedTermId)) || null
      const nextSelectedTermId = nextTimetable.termId || requestedTermId || ''

      if (!requestedTermId && nextSelectedTermId) {
        setLatestTermId(nextSelectedTermId)
      }

      setTimetable(nextTimetable)
      setExams(nextExams)
      setTermOptions((current) => mergeTermOptions(current, nextTermOptions))
      setSelectedTermId(nextSelectedTermId)
      setSelectedWeek((current) =>
        options?.resetToToday || current === null
          ? getCurrentTeachingWeek(
            nextSelectedTerm,
            nextTimetable.termId,
            mergeTermStarts(nextTimetable.termStarts, starts),
          )
          : current,
      )
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '课表读取失败')
    } finally {
      setLoading(false)
    }
  }

  function handleTermChange(index: number) {
    const term = termOptions[index] || selectedTerm

    if (!term || loading) {
      return
    }

    setSelectedItem(null)

    if (term.id === selectedTermId) {
      return
    }

    setSelectedTermId(term.id)
    void loadTimetable(accountId, term.id === '__current__' || term.id === latestTermId ? '' : term.id)
  }

  function handleWeekChange(index: number) {
    const week = weekOptions[index]

    if (!week || loading) {
      return
    }

    setSelectedItem(null)
    setSelectedWeek(week.value)
  }

  function handleWeekPage(offset: number) {
    const nextWeek = weekOptions[selectedWeekIndex + offset]

    if (!nextWeek) {
      return
    }

    setSelectedItem(null)
    setSelectedWeek(nextWeek.value)
  }

  function handleBackThisWeek() {
    if (loading) {
      return
    }

    const todayTerm = currentTeachingTerm
    const todayWeek = currentTeachingWeek

    if (todayTerm && todayTerm.id !== activeTermId) {
      setSelectedTermId(todayTerm.id)
      void loadTimetable(accountId, todayTerm.id === '__current__' || todayTerm.id === latestTermId ? '' : todayTerm.id)
    }

    setSelectedItem(null)
    setSelectedWeek(todayWeek)
  }

  resetToTodayRef.current = handleBackThisWeek

  function handleScheduleTouchStart(event: ITouchEvent) {
    const touch = event.touches[0]

    if (!touch) {
      return
    }

    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  function handleScheduleTouchEnd(event: ITouchEvent) {
    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null

    if (!start || !touch || selectedItem) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (
      Math.abs(deltaX) < WEEK_SWIPE_THRESHOLD ||
      Math.abs(deltaX) < Math.abs(deltaY) * 1.25
    ) {
      return
    }

    handleWeekPage(deltaX < 0 ? 1 : -1)
  }

  function handleScheduleTouchCancel() {
    touchStartRef.current = null
  }

  function closeLessonDetail() {
    setSelectedItem(null)
  }

  function getSectionStartMinutes(section: number) {
    const time = sectionTimeMap[section] || DEFAULT_SECTION_TIMES[section]

    return time ? parseClockMinutes(time.start) : null
  }

  function getSectionEndMinutes(section: number) {
    const time = sectionTimeMap[section] || DEFAULT_SECTION_TIMES[section]

    return time ? parseClockMinutes(time.end) : null
  }

  function getScheduleTopByMinutes(minutes: number) {
    const firstStart = getSectionStartMinutes(1)
    const lastEnd = getSectionEndMinutes(sectionCount)

    if (firstStart === null || lastEnd === null) {
      return null
    }

    if (minutes < firstStart) {
      return HEADER_HEIGHT
    }

    if (minutes > lastEnd) {
      return HEADER_HEIGHT + sectionCount * ROW_HEIGHT
    }

    for (let section = 1; section <= sectionCount; section += 1) {
      const sectionStart = getSectionStartMinutes(section)
      const sectionEnd = getSectionEndMinutes(section)

      if (sectionStart !== null && sectionEnd !== null && minutes >= sectionStart && minutes <= sectionEnd) {
        const duration = Math.max(sectionEnd - sectionStart, 1)
        const offset = (minutes - sectionStart) / duration

        return HEADER_HEIGHT + (section - 1 + offset) * ROW_HEIGHT
      }

      const nextStart = getSectionStartMinutes(section + 1)

      if (sectionEnd !== null && nextStart !== null && minutes > sectionEnd && minutes < nextStart) {
        return HEADER_HEIGHT + section * ROW_HEIGHT
      }
    }

    return null
  }

  function toLesson(course: CourseItem, index: number, colors: Map<string, CourseColor>): PositionedLesson | null {
    const weekday = Number(course.weekday)

    if (weekday < 1 || weekday > 7) {
      return null
    }

    const sections = getCourseSections(course)
      .map(Number)
      .filter((section) => Number.isFinite(section) && section > 0)
      .sort((a, b) => a - b)
    const visibleSections = sections.filter((section) => section <= sectionCount)

    if (visibleSections.length === 0) {
      return null
    }

    const start = Math.max(Number(visibleSections[0] || 1), 1)
    const end = Math.min(Number(visibleSections[visibleSections.length - 1] || start), sectionCount)
    const span = Math.max(end - start + 1, 1)
    const top = HEADER_HEIGHT + (start - 1) * ROW_HEIGHT
    const height = span * ROW_HEIGHT
    const leftIndex = weekday - 1
    const isLastDay = leftIndex === WEEKDAYS.length - 1
    const endsAtLastSection = end === sectionCount
    const name = getCourseValue(course, primaryCourseField) || '未命名课程'
    const style = [
      `left:calc(${LEFT_WIDTH_PERCENT + leftIndex * DAY_WIDTH_PERCENT}% + ${LESSON_HORIZONTAL_GAP}rpx)`,
      isLastDay ? `right:${LESSON_HORIZONTAL_GAP}rpx` : '',
      `top:${top + LESSON_VERTICAL_GAP}rpx`,
      isLastDay ? '' : `width:calc(${DAY_WIDTH_PERCENT}% - ${LESSON_HORIZONTAL_GAP * 2}rpx)`,
      endsAtLastSection ? `bottom:${LESSON_VERTICAL_GAP}rpx` : `height:${height - LESSON_VERTICAL_GAP * 2}rpx`,
      getCourseColorStyle(name, colors),
    ].filter(Boolean).join(';')
    const detailStart = Number(sections[0] || start)
    const detailEnd = Number(sections[sections.length - 1] || end)
    const startTime = (sectionTimeMap[detailStart] || DEFAULT_SECTION_TIMES[detailStart])?.start || ''
    const endTime = (sectionTimeMap[detailEnd] || DEFAULT_SECTION_TIMES[detailEnd])?.end || ''
    const room = getCourseValue(course, roomCourseField) || '地点待定'
    const teacher = course.teacher?.trim() || '教师待定'
    const section = formatSectionsText(sections)
    const timeText = formatCourseTime(
      course,
      timetable?.sectionTimes,
      timetable?.providerId,
      timetable?.sectionTimeProfiles,
    ) || (startTime && endTime ? `${startTime}-${endTime}` : '时间待定')
    const weekdayText = WEEKDAYS[weekday - 1] || ''
    const weeksText = formatWeeksText(course.weeks)

    return {
      id: course.id || `${weekday}-${start}-${course.name || index}`,
      type: 'course',
      name,
      nameLines: splitCourseName(name),
      room,
      roomLines: splitRoomName(room),
      teacher,
      weekdayText,
      section,
      weeksText,
      timeText,
      detailRows: [
        { label: '任课教师', value: teacher },
        { label: '上课地点', value: room },
        { label: '上课周次', value: weeksText },
      ].filter((row) => row.value),
      style,
    }
  }

  function toExamItem(
    exam: ScheduleExamItem,
    index: number,
    weekDateIndex: Map<string, number>,
  ): PositionedLesson | null {
    const dateKey = normalizeDateKey(exam.date)
    const leftIndex = weekDateIndex.get(dateKey)

    if (leftIndex === undefined) {
      return null
    }

    const startTime = getExamStartTime(exam)
    const endTime = getExamEndTime(exam)
    const startDate = startTime ? new Date(startTime) : null
    const endDate = endTime ? new Date(endTime) : null
    const timeParts = getExamTimeParts(exam)
    const startMinutes = startDate ? startDate.getHours() * 60 + startDate.getMinutes() : parseClockMinutes(timeParts.start)
    const endMinutes = endDate ? endDate.getHours() * 60 + endDate.getMinutes() : parseClockMinutes(timeParts.end)

    if (startMinutes === null) {
      return null
    }

    const top = getScheduleTopByMinutes(startMinutes)

    if (top === null) {
      return null
    }

    const parsedEnd = parseClockMinutes(timeParts.end)
    const fallbackEnd = parsedEnd !== null && parsedEnd > startMinutes ? parsedEnd : startMinutes + 90
    const resolvedEndMinutes = endMinutes !== null && endMinutes > startMinutes ? endMinutes : fallbackEnd
    const endTop = getScheduleTopByMinutes(resolvedEndMinutes)
    const height = Math.max(
      EXAM_MIN_HEIGHT,
      endTop !== null && endTop > top ? endTop - top : ROW_HEIGHT,
    )
    const isLastDay = leftIndex === WEEKDAYS.length - 1
    const name = exam.courseName || '未命名考试'
    const room = exam.location || '地点待安排'
    const timeText = getExamTimeText(exam)
    const style = [
      `left:calc(${LEFT_WIDTH_PERCENT + leftIndex * DAY_WIDTH_PERCENT}% + ${LESSON_HORIZONTAL_GAP}rpx)`,
      isLastDay ? `right:${LESSON_HORIZONTAL_GAP}rpx` : '',
      `top:${top + LESSON_VERTICAL_GAP}rpx`,
      isLastDay ? '' : `width:calc(${DAY_WIDTH_PERCENT}% - ${LESSON_HORIZONTAL_GAP * 2}rpx)`,
      `height:${Math.max(EXAM_MIN_HEIGHT, height - LESSON_VERTICAL_GAP * 2)}rpx`,
    ].filter(Boolean).join(';')

    return {
      id: `exam-${exam.id || `${dateKey}-${index}`}`,
      type: 'exam',
      name,
      nameLines: splitCourseName(name),
      room,
      roomLines: splitRoomName(room),
      teacher: '',
      weekdayText: WEEKDAYS[leftIndex] || '',
      section: '考试',
      weeksText: dateKey,
      timeText,
      detailRows: [
        { label: '考试日期', value: dateKey },
        { label: '考试地点', value: room },
        { label: '座位号', value: exam.seatNo || '待安排' },
      ].filter((row) => row.value),
      style,
    }
  }

  return (
    <PageShell title='课 表' activeTab='schedule' contentClassName='schedule-content' customNav>
      <View className='schedule-filters'>
        <Picker
          className='filter-picker semester-picker'
          mode='selector'
          range={termPickerRange}
          value={selectedTermIndex}
          disabled={loading || termOptions.length === 0}
          onChange={(event) => handleTermChange(Number(event.detail.value))}
        >
          <View className='filter-select'>
            <Text>{selectedTermLabel}</Text>
            <View className='chevron-down' />
          </View>
        </Picker>
        <Picker
          className='filter-picker week-picker'
          mode='selector'
          range={weekPickerRange}
          value={selectedWeekIndex}
          disabled={loading}
          onChange={(event) => handleWeekChange(Number(event.detail.value))}
        >
          <View className='filter-select'>
            <Text>{selectedWeekLabel}</Text>
            <View className='chevron-down' />
          </View>
        </Picker>
      </View>

      {loading && <View className='soft-card state-card'>正在读取课表</View>}
      {errorText && <View className='soft-card state-card state-error'>{errorText}</View>}

      {showBackThisWeekButton && (
        <View className='schedule-back-this-week-button' onClick={handleBackThisWeek}>
          回到今天
        </View>
      )}

      <View
        className='timetable'
        style={timetableStyle}
        onTouchStart={handleScheduleTouchStart}
        onTouchEnd={handleScheduleTouchEnd}
        onTouchCancel={handleScheduleTouchCancel}
      >
        {rowGridLines.map((line) => (
          <View className='timetable-grid-line timetable-row-line' key={line.id} style={line.style} />
        ))}
        {columnGridLines.map((line) => (
          <View className='timetable-grid-line timetable-column-line' key={line.id} style={line.style} />
        ))}

        {weekdays.map((item) => (
          <View className={`weekday ${item.isToday ? 'weekday-today' : ''}`} key={item.weekday} style={item.style}>
            <View className='weekday-name'>{item.weekday}</View>
            <View className='weekday-date'>{item.dateText}</View>
          </View>
        ))}

        {periods.map((item) => (
          <View className='time-cell' key={item.section} style={item.style}>
            <View className='period-index'>{item.section}</View>
            <View>{item.start}</View>
            <View>{item.end}</View>
          </View>
        ))}

        {lessons.map((lesson) => (
          <View
            className='lesson-block'
            key={lesson.id}
            style={lesson.style}
            onClick={() => setSelectedItem(lesson)}
          >
            <View className='lesson-name'>
              {lesson.nameLines.map((line, index) => (
                <View
                  className='lesson-name-text'
                  key={`${lesson.id}-name-${line}-${index}`}
                >
                  {line}
                </View>
              ))}
            </View>
            <View className='lesson-room'>
              {lesson.roomLines.map((line, index) => (
                <View
                  className='lesson-room-text'
                  key={`${lesson.id}-room-${line}-${index}`}
                >
                  {line}
                </View>
              ))}
            </View>
          </View>
        ))}
        {examItems.map((exam) => (
          <View
            className='lesson-block exam-block'
            key={exam.id}
            style={exam.style}
            onClick={() => setSelectedItem(exam)}
          >
            <View className='exam-badge'>考试</View>
            <View className='lesson-name exam-name'>
              {exam.nameLines.map((line, index) => (
                <View
                  className='lesson-name-text'
                  key={`${exam.id}-name-${line}-${index}`}
                >
                  {line}
                </View>
              ))}
            </View>
            <View className='lesson-room exam-room'>
              {exam.roomLines.map((line, index) => (
                <View
                  className='lesson-room-text'
                  key={`${exam.id}-room-${line}-${index}`}
                >
                  {line}
                </View>
              ))}
            </View>
          </View>
        ))}
      </View>

      {!loading && !errorText && timetable && lessons.length === 0 && examItems.length === 0 && (
        <View className='soft-card state-card empty-schedule'>暂无课表数据</View>
      )}

      {selectedItem && (
        <RootPortal>
          <View className='lesson-detail-mask' onClick={closeLessonDetail}>
            <View
              className='lesson-detail-card'
              onClick={(event) => event.stopPropagation()}
            >
              <View className='lesson-detail-head'>
                <View>
                  <View className='lesson-detail-kicker'>
                    {selectedItem.weekdayText} {selectedItem.section}
                  </View>
                  <View className='lesson-detail-title'>{selectedItem.name}</View>
                </View>
                <View className='lesson-detail-close' onClick={closeLessonDetail} />
              </View>
              <View className='lesson-detail-time'>{selectedItem.timeText}</View>
              <View className='lesson-detail-list'>
                {selectedItem.detailRows.map((row) => (
                  <View className='lesson-detail-row' key={row.label}>
                    <Text>{row.label}</Text>
                    <Text>{row.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </RootPortal>
      )}
    </PageShell>
  )
}
