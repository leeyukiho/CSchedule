import { useEffect, useMemo, useRef, useState } from 'react'
import { useDidShow } from '@tarojs/taro'
import { Picker, Text, View, type ITouchEvent } from '@tarojs/components'

import { getTimetable } from '../../shared/api/timetable'
import { CourseItem, FeatureDisplayField, TimetableCacheResponse } from '../../shared/api/types'
import { SECTION_TIMES, getCourseSections } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { getStoredAccountId, getStoredTermStarts } from '../../shared/storage'
import {
  TermOption,
  buildTermOptions,
  courseRunsInWeek,
  dedupeAndSortTerms,
  getCurrentTeachingWeek,
  getTodayTermOption,
  getWeekStartDate,
} from '../../shared/term'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const TOTAL_SECTIONS = 12
const MAX_WEEK = 20
const LEFT_WIDTH = 54
const DAY_WIDTH = 90
const HEADER_HEIGHT = 80
const ROW_HEIGHT = 92
const LESSON_GAP = 2
const WEEK_SWIPE_THRESHOLD = 48
const STATUS_CLEAR_DELAY_MS = 3000
interface LessonPalette {
  background: string
  border: string
  text: string
}

const LESSON_PALETTES: LessonPalette[] = [
  { background: '#fecaca', border: '#ef4444', text: '#7f1d1d' },
  { background: '#cffafe', border: '#06b6d4', text: '#155e75' },
  { background: '#fed7aa', border: '#f97316', text: '#9a3412' },
  { background: '#c7d2fe', border: '#6366f1', text: '#312e81' },
  { background: '#fef08a', border: '#ca8a04', text: '#713f12' },
  { background: '#f5d0fe', border: '#d946ef', text: '#86198f' },
  { background: '#bbf7d0', border: '#22c55e', text: '#14532d' },
  { background: '#bae6fd', border: '#0ea5e9', text: '#0c4a6e' },
  { background: '#ddd6fe', border: '#8b5cf6', text: '#4c1d95' },
  { background: '#fecdd3', border: '#f43f5e', text: '#881337' },
  { background: '#bfdbfe', border: '#3b82f6', text: '#1e3a8a' },
  { background: '#d9f99d', border: '#84cc16', text: '#365314' },
  { background: '#fbcfe8', border: '#ec4899', text: '#831843' },
  { background: '#a7f3d0', border: '#10b981', text: '#064e3b' },
  { background: '#e9d5ff', border: '#a855f7', text: '#581c87' },
  { background: '#fde68a', border: '#f59e0b', text: '#78350f' },
  { background: '#fca5a5', border: '#dc2626', text: '#7f1d1d' },
  { background: '#a5f3fc', border: '#0891b2', text: '#164e63' },
  { background: '#fdba74', border: '#ea580c', text: '#7c2d12' },
  { background: '#c4b5fd', border: '#7c3aed', text: '#3b0764' },
  { background: '#bef264', border: '#65a30d', text: '#365314' },
  { background: '#f9a8d4', border: '#db2777', text: '#831843' },
  { background: '#99f6e4', border: '#0d9488', text: '#134e4a' },
  { background: '#93c5fd', border: '#2563eb', text: '#1e3a8a' },
]
const GENERATED_PALETTE_HUES = [
  2, 190, 28, 250, 54, 312, 138, 202, 274, 344, 222, 82, 326, 162, 292, 36, 258, 176,
]
const GENERATED_PALETTE_VARIANTS = [
  { backgroundS: 88, backgroundL: 88, borderS: 76, borderL: 44, textS: 72, textL: 24 },
  { backgroundS: 82, backgroundL: 84, borderS: 72, borderL: 40, textS: 68, textL: 22 },
  { backgroundS: 92, backgroundL: 91, borderS: 82, borderL: 50, textS: 72, textL: 28 },
]
const DEFAULT_COURSE_FIELDS: FeatureDisplayField[] = [
  { key: 'name', label: '课程', primary: true },
  { key: 'classroom', label: '教室', fallbackKeys: ['location'] },
]

interface PositionedLesson {
  id: string
  name: string
  room: string
  teacher: string
  weeksText: string
  sectionsText: string
  timeText: string
  style: string
}

interface WeekOption {
  value: number | null
  label: string
}

interface WeekdayColumn {
  weekday: string
  dateText: string
  isToday: boolean
  style: string
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

function getCoursePaletteKey(course: CourseItem, primaryField: FeatureDisplayField) {
  const name = getCourseValue(course, primaryField) || course.name?.trim() || ''
  const teacher = course.teacher?.trim() || ''
  const key = [name, teacher].filter(Boolean).join('|')

  return key || course.id || ''
}

function getPaletteHash(key: string, fallbackIndex = 0) {
  return key
    .split('')
    .reduce((sum, char) => ((sum * 31 + char.charCodeAt(0)) >>> 0), fallbackIndex >>> 0)
}

function getStablePaletteIndex(key: string, fallbackIndex = 0) {
  const hash = getPaletteHash(key, fallbackIndex)

  return hash % LESSON_PALETTES.length
}

function getPaletteStyle(index: number) {
  const palette = LESSON_PALETTES[index % LESSON_PALETTES.length]

  return `background:${palette.background};border-color:${palette.border};color:${palette.text}`
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedHue = ((hue % 360) + 360) % 360 / 360
  const s = Math.max(0, Math.min(100, saturation)) / 100
  const l = Math.max(0, Math.min(100, lightness)) / 100

  if (s === 0) {
    const gray = Math.round(l * 255).toString(16).padStart(2, '0')
    return `#${gray}${gray}${gray}`
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q

  const hueToRgb = (t: number) => {
    let value = t

    if (value < 0) {
      value += 1
    } else if (value > 1) {
      value -= 1
    }

    if (value < 1 / 6) {
      return p + (q - p) * 6 * value
    }

    if (value < 1 / 2) {
      return q
    }

    if (value < 2 / 3) {
      return p + (q - p) * (2 / 3 - value) * 6
    }

    return p
  }

  const red = Math.round(hueToRgb(normalizedHue + 1 / 3) * 255)
    .toString(16)
    .padStart(2, '0')
  const green = Math.round(hueToRgb(normalizedHue) * 255)
    .toString(16)
    .padStart(2, '0')
  const blue = Math.round(hueToRgb(normalizedHue - 1 / 3) * 255)
    .toString(16)
    .padStart(2, '0')

  return `#${red}${green}${blue}`
}

function getGeneratedPaletteStyle(key: string) {
  const hash = getPaletteHash(key)
  const hueSeed = GENERATED_PALETTE_HUES[hash % GENERATED_PALETTE_HUES.length]
  const variant = GENERATED_PALETTE_VARIANTS[
    Math.floor(hash / GENERATED_PALETTE_HUES.length) % GENERATED_PALETTE_VARIANTS.length
  ]
  const hueShift = Math.floor(
    hash / (GENERATED_PALETTE_HUES.length * GENERATED_PALETTE_VARIANTS.length),
  )
  const hue = (hueSeed + (hueShift % 24) * 13) % 360

  return `background:${hslToHex(hue, variant.backgroundS, variant.backgroundL)};border-color:${hslToHex((hue + 8) % 360, variant.borderS, variant.borderL)};color:${hslToHex((hue + 8) % 360, variant.textS, variant.textL)}`
}

function buildCoursePaletteMap(courses: CourseItem[], primaryField: FeatureDisplayField) {
  const keys = Array.from(
    new Set(courses.map((course) => getCoursePaletteKey(course, primaryField)).filter(Boolean)),
  ).sort()
  const usedIndexes = new Set<number>()

  return keys.reduce<Record<string, string>>((map, key) => {
    if (usedIndexes.size < LESSON_PALETTES.length) {
      let paletteIndex = getStablePaletteIndex(key)

      while (usedIndexes.has(paletteIndex)) {
        paletteIndex = (paletteIndex + 1) % LESSON_PALETTES.length
      }
      usedIndexes.add(paletteIndex)

      map[key] = getPaletteStyle(paletteIndex)
      return map
    }

    map[key] = getGeneratedPaletteStyle(key)
    return map
  }, {})
}

function mergeTermOptions(current: TermOption[], next: TermOption[]) {
  return dedupeAndSortTerms([...current, ...next])
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

function isSameDate(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatSectionsText(sections: number[]) {
  if (sections.length === 0) {
    return ''
  }

  if (sections.length === 1) {
    return `第 ${sections[0]} 节`
  }

  return `第 ${sections[0]}-${sections[sections.length - 1]} 节`
}

function formatWeeksText(weeks: number[] | undefined) {
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return '整学期'
  }

  const sortedWeeks = [...new Set(weeks.map(Number))]
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((a, b) => a - b)

  if (sortedWeeks.length === 0) {
    return '整学期'
  }

  return sortedWeeks.length > 8
    ? `第 ${sortedWeeks[0]}-${sortedWeeks[sortedWeeks.length - 1]} 周`
    : `第 ${sortedWeeks.join('、')} 周`
}

export default function SchedulePage() {
  const [accountId, setAccountId] = useState('')
  const [timetable, setTimetable] = useState<TimetableCacheResponse | null>(null)
  const [termOptions, setTermOptions] = useState<TermOption[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [termStarts, setTermStarts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [selectedLesson, setSelectedLesson] = useState<PositionedLesson | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!errorText) {
      return undefined
    }

    const timer = setTimeout(() => setErrorText(''), STATUS_CLEAR_DELAY_MS)

    return () => clearTimeout(timer)
  }, [errorText])

  const periods = useMemo(
    () =>
      Array.from({ length: TOTAL_SECTIONS }, (_, index) => {
        const section = index + 1
        const time = SECTION_TIMES[section]
        const top = HEADER_HEIGHT + index * ROW_HEIGHT

        return {
          section,
          start: time ? time.start : '',
          end: time ? time.end : '',
          style: `left:0rpx;top:${top}rpx;width:${LEFT_WIDTH}rpx;height:${ROW_HEIGHT}rpx;`,
        }
      }),
    [],
  )

  const selectedTermIndex = Math.max(
    termOptions.findIndex((term) => term.id === (selectedTermId || timetable?.termId || '')),
    0,
  )
  const selectedTerm = termOptions[selectedTermIndex] || null
  const weekOptions = useMemo(() => buildWeekOptions(), [])
  const selectedWeekIndex = Math.max(
    weekOptions.findIndex((week) => week.value === selectedWeek),
    0,
  )
  const selectedTermLabel = termOptions[selectedTermIndex]?.label || timetable?.termId || '当前学期'
  const termWeekRange = useMemo(
    () => [
      termOptions.length > 0 ? termOptions.map((term) => term.label) : [selectedTermLabel],
      weekOptions.map((week) => week.label),
    ],
    [selectedTermLabel, termOptions, weekOptions],
  )
  const courseFields = timetable?.display?.itemFields?.length
    ? timetable.display.itemFields
    : DEFAULT_COURSE_FIELDS
  const primaryCourseField = courseFields.find((field) => field.primary) || courseFields[0]
  const roomCourseField =
    courseFields.find((field) => ['classroom', 'location', 'campus'].includes(field.key)) ||
    DEFAULT_COURSE_FIELDS[1]
  const coursePaletteMap = useMemo(
    () => buildCoursePaletteMap(timetable ? timetable.courses : [], primaryCourseField),
    [primaryCourseField, timetable],
  )
  const weekdays = useMemo<WeekdayColumn[]>(() => {
    const today = new Date()
    const startDate = getWeekStartDate(selectedTerm, selectedWeek, timetable?.termId, termStarts)

    return WEEKDAYS.map((weekday, index) => {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + index)

      return {
        weekday,
        dateText: formatMonthDay(date),
        isToday: isSameDate(date, today),
        style: `left:${LEFT_WIDTH + DAY_WIDTH * index}rpx;top:0rpx;width:${DAY_WIDTH}rpx;height:${HEADER_HEIGHT}rpx;`,
      }
    })
  }, [selectedTerm, selectedWeek, termStarts, timetable?.termId])

  const lessons = useMemo<PositionedLesson[]>(() => {
    return (timetable ? timetable.courses : [])
      .filter((course) => {
        if (selectedWeek === null) {
          return true
        }

        return courseRunsInWeek(course, selectedWeek)
      })
      .map((course, index) => toLesson(course, index))
      .filter((lesson): lesson is PositionedLesson => Boolean(lesson))
  }, [coursePaletteMap, primaryCourseField, roomCourseField, selectedWeek, timetable])

  useDidShow(() => {
    const id = getStoredAccountId()
    const storedTermStarts = getStoredTermStarts()
    setAccountId(id)
    setTermStarts(storedTermStarts)

    if (!id) {
      setTimetable(null)
      setTermOptions([])
      setSelectedTermId('')
      setSelectedWeek(null)
      setLoading(false)
      setErrorText('')
      return
    }

    if (id) {
      void loadTimetable(id, selectedTermId, storedTermStarts)
    }
  })

  async function loadTimetable(
    id = accountId,
    termId = selectedTermId,
    starts = termStarts,
  ) {
    if (!id) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      const nextTimetable = await getTimetable(id, termId || undefined)
      const nextTermOptions = buildTermOptions(nextTimetable)
      const todayTerm = termId ? null : getTodayTermOption(nextTermOptions)

      if (todayTerm && nextTimetable.termId !== todayTerm.id) {
        const todayTimetable = await getTimetable(id, todayTerm.id)
        const todayTermOptions = buildTermOptions(todayTimetable)
        const mergedTermOptions = mergeTermOptions(nextTermOptions, todayTermOptions)
        const todaySelectedTerm =
          todayTermOptions.find((term) => term.id === (todayTimetable.termId || todayTerm.id)) ||
          todayTerm

        setTimetable(todayTimetable)
        setTermOptions((current) => mergeTermOptions(current, mergedTermOptions))
        setSelectedTermId(todayTimetable.termId || todayTerm.id)
        setSelectedWeek(getCurrentTeachingWeek(todaySelectedTerm, todayTimetable.termId || todayTerm.id, starts))
        return
      }

      const nextSelectedTerm =
        nextTermOptions.find((term) => term.id === (nextTimetable.termId || termId)) || null
      setTimetable(nextTimetable)
      setTermOptions((current) => mergeTermOptions(current, nextTermOptions))
      setSelectedTermId(nextTimetable.termId || termId || '')
      setSelectedWeek((current) =>
        current === null ? getCurrentTeachingWeek(nextSelectedTerm, nextTimetable.termId, starts) : current,
      )
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '课表读取失败')
    } finally {
      setLoading(false)
    }
  }

  function handleTermWeekChange(value: Array<string | number>) {
    const [termValue, weekValue] = value
    const term = termOptions[Number(termValue)] || selectedTerm
    const week = weekOptions[Number(weekValue)]

    if (!term || !week || loading) {
      return
    }

    if (term.id !== selectedTermId) {
      setSelectedTermId(term.id)
      void loadTimetable(accountId, term.id === '__current__' ? '' : term.id)
    }

    setSelectedLesson(null)
    setSelectedWeek(week.value)
  }

  function handleWeekPage(offset: number) {
    const nextWeek = weekOptions[selectedWeekIndex + offset]

    if (!nextWeek) {
      return
    }

    setSelectedLesson(null)
    setSelectedWeek(nextWeek.value)
  }

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

    if (!start || !touch) {
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

  function handleBackToday() {
    const todayTerm = getTodayTermOption(termOptions) || selectedTerm
    const todayWeek = getCurrentTeachingWeek(todayTerm, todayTerm?.id || timetable?.termId, termStarts)

    if (todayTerm && todayTerm.id !== selectedTermId) {
      setSelectedTermId(todayTerm.id)
      void loadTimetable(accountId, todayTerm.id === '__current__' ? '' : todayTerm.id)
    }

    setSelectedLesson(null)
    setSelectedWeek(todayWeek)
  }

  function closeLessonDetail() {
    setSelectedLesson(null)
  }

  function toLesson(course: CourseItem, index: number): PositionedLesson | null {
    const weekday = Number(course.weekday)

    if (weekday < 1 || weekday > 7) {
      return null
    }

    const sections = getCourseSections(course)
      .map(Number)
      .filter((section) => Number.isFinite(section) && section > 0)
      .sort((a, b) => a - b)
    const visibleSections = sections.filter((section) => section <= TOTAL_SECTIONS)

    if (visibleSections.length === 0) {
      return null
    }

    const start = Math.max(Number(visibleSections[0] || 1), 1)
    const end = Math.min(Number(visibleSections[visibleSections.length - 1] || start), TOTAL_SECTIONS)
    const span = Math.max(end - start + 1, 1)
    const top = HEADER_HEIGHT + (start - 1) * ROW_HEIGHT
    const height = span * ROW_HEIGHT
    const leftIndex = weekday - 1
    const courseKey = getCoursePaletteKey(course, primaryCourseField)
    const paletteStyle =
      coursePaletteMap[courseKey] || getPaletteStyle(getStablePaletteIndex(courseKey, index))
    const style = [
      `left:${LEFT_WIDTH + DAY_WIDTH * leftIndex + LESSON_GAP}rpx`,
      `top:${top + LESSON_GAP}rpx`,
      `width:${DAY_WIDTH - LESSON_GAP * 2}rpx`,
      `height:${height - LESSON_GAP * 2}rpx`,
      paletteStyle,
    ].join(';')
    const detailStart = Number(sections[0] || start)
    const detailEnd = Number(sections[sections.length - 1] || end)
    const startTime = SECTION_TIMES[detailStart]?.start || ''
    const endTime = SECTION_TIMES[detailEnd]?.end || ''

    return {
      id: course.id || `${weekday}-${start}-${course.name || index}`,
      name: getCourseValue(course, primaryCourseField) || '未命名课程',
      room: getCourseValue(course, roomCourseField),
      teacher: course.teacher?.trim() || '',
      weeksText: formatWeeksText(course.weeks),
      sectionsText: formatSectionsText(sections),
      timeText: startTime && endTime ? `${startTime}-${endTime}` : '',
      style,
    }
  }

  return (
    <PageShell title='课表' activeTab='schedule' contentClassName='schedule-content'>
      <View className='schedule-header'>
        <Picker
          className='term-week-picker'
          mode='multiSelector'
          range={termWeekRange}
          value={[selectedTermIndex, selectedWeekIndex]}
          disabled={loading || termOptions.length === 0}
          onChange={(event) => handleTermWeekChange(event.detail.value)}
        >
          <View className='filter-select term-week-select'>
            <Text>{selectedTermLabel}</Text>
            <View className='chevron-down' />
          </View>
        </Picker>
        <View className='schedule-today-button' onClick={handleBackToday}>今天</View>
      </View>

      {errorText && <View className='status status-error'>{errorText}</View>}
      {loading && <View className='soft-card state-card'>正在读取课表...</View>}

      <View
        className='timetable'
        onTouchStart={handleScheduleTouchStart}
        onTouchEnd={handleScheduleTouchEnd}
        onTouchCancel={handleScheduleTouchCancel}
      >
        {weekdays.map((item) => (
          <View
            className={'weekday ' + (item.isToday ? 'weekday-active' : '')}
            key={item.weekday}
            style={item.style}
          >
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
            onClick={() => setSelectedLesson(lesson)}
          >
            <View className='lesson-name'>{lesson.name}</View>
            {lesson.room && <View className='lesson-room'>{lesson.room}</View>}
          </View>
        ))}
      </View>

      {selectedLesson && (
        <View className='lesson-detail-mask' onClick={closeLessonDetail}>
          <View className='lesson-detail-card' onClick={(event) => event.stopPropagation()}>
            <View className='lesson-detail-title'>{selectedLesson.name}</View>
            <View className='lesson-detail-row'>
              <Text>时间</Text>
              <Text>{[selectedLesson.sectionsText, selectedLesson.timeText].filter(Boolean).join(' ') || '--'}</Text>
            </View>
            <View className='lesson-detail-row'>
              <Text>周次</Text>
              <Text>{selectedLesson.weeksText}</Text>
            </View>
            <View className='lesson-detail-row'>
              <Text>地点</Text>
              <Text>{selectedLesson.room || '--'}</Text>
            </View>
            <View className='lesson-detail-row'>
              <Text>教师</Text>
              <Text>{selectedLesson.teacher || '--'}</Text>
            </View>
            <View className='lesson-detail-close' onClick={closeLessonDetail}>关闭</View>
          </View>
        </View>
      )}
    </PageShell>
  )
}
