import { CourseItem, TimetableCacheResponse } from './api/types'

export interface TermOption {
  id: string
  label: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TEACHING_WEEK = 20
const ACADEMIC_YEAR_PATTERN = /(20\d{2})\s*[-~—至]\s*(20\d{2})/
const ACADEMIC_YEAR_COMPACT_PATTERN = /(20\d{2})[-~—至]?(20\d{2})/

export function formatTermLabel(id: string, label: string) {
  const text = label || id
  const parsed = parseTermDescriptor({ id, label: text })

  if (!parsed.yearStart || !parsed.yearEnd) {
    return text
  }

  return `${parsed.yearStart}-${parsed.yearEnd}学年${parsed.secondSemester ? '第2学期' : '第1学期'}`
}

export function normalizeTerm(term: unknown): TermOption | null {
  if (!term || typeof term !== 'object' || Array.isArray(term)) {
    return null
  }

  const item = term as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const rawLabel =
    (typeof item.label === 'string' && item.label.trim()) ||
    (typeof item.name === 'string' && item.name.trim()) ||
    (typeof item.title === 'string' && item.title.trim()) ||
    id
  const label = formatTermLabel(id, rawLabel)

  if (!id || isScheduleArtifactTerm(id, rawLabel, label)) {
    return null
  }

  return { id, label }
}

export function buildTermOptions(timetable: TimetableCacheResponse | null) {
  const options = dedupeAndSortTerms((timetable ? timetable.terms : [])
    .map(normalizeTerm)
    .filter((term): term is TermOption => Boolean(term)))
  const currentTermId = timetable?.termId || ''

  if (
    currentTermId &&
    !isScheduleArtifactTerm(currentTermId, currentTermId, currentTermId) &&
    !options.some(
      (term) =>
        term.id === currentTermId ||
        getTermKey(term) === getTermKey({ id: currentTermId, label: currentTermId }),
    )
  ) {
    return dedupeAndSortTerms([
      { id: currentTermId, label: formatTermLabel(currentTermId, currentTermId) },
      ...options,
    ])
  }

  if (options.length === 0 && timetable && timetable.courses.length > 0) {
    return [{ id: '__current__', label: '当前学期' }]
  }

  return options
}

export function dedupeAndSortTerms(terms: TermOption[]) {
  const termMap = new Map<string, TermOption>()

  for (const term of terms) {
    const key = getTermKey(term)

    if (!key || termMap.has(key) || isFutureAcademicYear(term) || isScheduleArtifactTerm(term.id, term.label, term.label)) {
      continue
    }

    termMap.set(key, term)
  }

  return [...termMap.values()].sort((left, right) => getTermSortKey(right) - getTermSortKey(left))
}

export function getAcademicYear(term: TermOption | null, fallbackTermId?: string) {
  const parsed = parseTermDescriptor(term, fallbackTermId)
  return parsed.yearStart
}

export function isSecondSemester(term: TermOption | null, fallbackTermId?: string) {
  return parseTermDescriptor(term, fallbackTermId).secondSemester
}

export function getTodayTermOption(terms: TermOption[]) {
  const today = new Date()
  const month = today.getMonth()
  const academicStartYear = month >= 8 ? today.getFullYear() : today.getFullYear() - 1
  const secondSemester = month >= 1 && month < 8

  return (
    terms.find(
      (term) =>
        getAcademicYear(term) === academicStartYear &&
        isSecondSemester(term) === secondSemester,
    ) || null
  )
}

export function getTeachingWeekStart(
  term: TermOption | null,
  fallbackTermId?: string,
  termStarts: Record<string, string> = {},
) {
  const customStart = term ? parseLocalDate(termStarts[term.id] || '') : null

  if (customStart) {
    return getMondayOnOrAfter(customStart)
  }

  const startYear = getAcademicYear(term, fallbackTermId)

  if (!startYear) {
    return getMondayOnOrAfter(new Date())
  }

  if (isSecondSemester(term, fallbackTermId)) {
    return getMondayOnOrAfter(new Date(startYear + 1, 1, 15))
  }

  return getMondayOnOrAfter(new Date(startYear, 8, 1))
}

export function getTeachingWeekForDate(
  date: Date,
  term: TermOption | null,
  fallbackTermId?: string,
  termStarts: Record<string, string> = {},
) {
  const start = getTeachingWeekStart(term, fallbackTermId, termStarts)
  const current = toLocalMidnight(date)
  const week = Math.floor((current.getTime() - start.getTime()) / WEEK_MS) + 1

  return Number.isFinite(week) && week > 0 ? Math.min(week, MAX_TEACHING_WEEK) : null
}

export function getCurrentTeachingWeek(
  term: TermOption | null,
  fallbackTermId?: string,
  termStarts: Record<string, string> = {},
) {
  return getTeachingWeekForDate(new Date(), term, fallbackTermId, termStarts) ?? 1
}

export function getWeekStartDate(
  term: TermOption | null,
  week: number | null,
  fallbackTermId?: string,
  termStarts: Record<string, string> = {},
) {
  const start = getTeachingWeekStart(term, fallbackTermId, termStarts)
  const offset = Math.max(Number(week || 1) - 1, 0)
  start.setDate(start.getDate() + offset * 7)
  return start
}

export function courseRunsInWeek(course: CourseItem, week: number | null) {
  if (week === null) {
    return false
  }

  const weeks = Array.isArray(course.weeks) ? course.weeks.map(Number) : []

  return weeks.length === 0 || weeks.includes(week)
}

function getTermKey(term: TermOption) {
  const parsed = parseTermDescriptor(term)

  if (!parsed.yearStart || !parsed.yearEnd) {
    return `${term.label || ''} ${term.id || ''}`.replace(/\s+/g, '')
  }

  return `${parsed.yearStart}-${parsed.yearEnd}-${parsed.secondSemester ? '2' : '1'}`
}

function isScheduleArtifactTerm(id: string, rawLabel: string, label: string) {
  const parsed = parseTermDescriptor({ id, label: [rawLabel, label].filter(Boolean).join(' ') })

  if (parsed.yearStart && parsed.yearEnd) {
    return false
  }

  return stripScheduleTermNoise([rawLabel, label].filter(Boolean).join(' ')) === ''
}

function stripScheduleTermNoise(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*学生\s*课表\s*/g, ' ')
    .replace(
      /[\s,，、;；|/\\_-]*第?\s*[\d一二三四五六七八九十]+(?:\s*[-~—至]\s*[\d一二三四五六七八九十]+)?\s*周\s*/g,
      ' ',
    )
    .replace(/[\s,，、;；|/\\_-]+/g, '')
    .trim()
}

function getTermSortKey(term: TermOption) {
  const match = getTermKey(term).match(/^(20\d{2})-(20\d{2})-([12])$/)

  return match ? Number(match[1]) * 10 + Number(match[3]) : Number.NEGATIVE_INFINITY
}

function isFutureAcademicYear(term: TermOption) {
  const match = getTermKey(term).match(/^(20\d{2})-(20\d{2})-([12])$/)

  if (!match) {
    return false
  }

  return Number(match[1]) > getCurrentAcademicStartYear()
}

function parseTermDescriptor(term: Pick<TermOption, 'id' | 'label'> | null, fallbackTermId = '') {
  const textParts = [term?.label || '', term?.id || '', fallbackTermId].filter(Boolean)
  const normalizedText = textParts.join(' ').replace(/\s+/g, ' ').trim()
  const normalizedCompactText = normalizedText.replace(/\s+/g, '')
  const yearMatch =
    normalizedText.match(ACADEMIC_YEAR_PATTERN) ||
    normalizedCompactText.match(ACADEMIC_YEAR_COMPACT_PATTERN)

  const semesterToken = detectSemesterToken(normalizedText, normalizedCompactText)

  return {
    yearStart: yearMatch ? Number(yearMatch[1]) : undefined,
    yearEnd: yearMatch ? Number(yearMatch[2]) : undefined,
    secondSemester: semesterToken === '2',
  }
}

function detectSemesterToken(text: string, compactText: string) {
  const explicitMatch =
    text.match(/第?\s*([一二三四五六七八九十1-9])\s*学期/) ||
    text.match(/([上下])\s*学期/) ||
    text.match(/学期\s*([12])/)

  if (explicitMatch) {
    return toSemesterToken(explicitMatch[1])
  }

  if (compactText.includes('第二学期') || compactText.includes('下学期')) {
    return '2'
  }

  if (compactText.includes('第一学期') || compactText.includes('上学期')) {
    return '1'
  }

  return '1'
}

function toSemesterToken(value: string) {
  return value === '2' || value === '二' || value === '下' ? '2' : '1'
}

function getCurrentAcademicStartYear(baseDate = new Date()) {
  const year = baseDate.getFullYear()
  const month = baseDate.getMonth()

  return month >= 8 ? year : year - 1
}

function parseLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function toLocalMidnight(date: Date) {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

function getMondayOnOrAfter(date: Date) {
  const result = toLocalMidnight(date)
  const day = result.getDay() || 7
  const offset = day === 1 ? 0 : 8 - day
  result.setDate(result.getDate() + offset)
  return result
}
