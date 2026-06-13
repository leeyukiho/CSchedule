import { CourseItem, SchoolListItem, SchoolStatus } from './api/types'

export const SECTION_TIMES: Record<number, { start: string; end: string }> = {
  1: { start: '08:20', end: '09:05' },
  2: { start: '09:15', end: '10:00' },
  3: { start: '10:20', end: '11:05' },
  4: { start: '11:15', end: '12:00' },
  5: { start: '12:10', end: '12:55' },
  6: { start: '13:05', end: '13:50' },
  7: { start: '14:10', end: '14:55' },
  8: { start: '15:05', end: '15:50' },
  9: { start: '16:10', end: '16:55' },
  10: { start: '17:05', end: '17:50' },
  11: { start: '18:30', end: '19:15' },
  12: { start: '19:20', end: '20:10' },
  13: { start: '20:20', end: '21:05' },
}

export function getWeekday() {
  const day = new Date().getDay()
  return day === 0 ? 7 : day
}

export function formatDateText() {
  const date = new Date()
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
}

export function formatTime(value?: string) {
  if (!value) {
    return '暂无'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '暂无'
  }

  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function getCourseSections(course: CourseItem) {
  const sections = Array.isArray(course.sections) ? course.sections : []
  const start = Number(course.startSection || sections[0] || 1)
  const end = Number(course.endSection || sections[sections.length - 1] || start)

  return sections.length > 0
    ? sections
    : Array.from({ length: Math.max(end - start + 1, 1) }, (_, index) => start + index)
}

export function formatSections(course: CourseItem) {
  const sections = getCourseSections(course)

  return sections.length > 1 ? `${sections[0]}-${sections[sections.length - 1]}节` : `${sections[0]}节`
}

export function formatCourseTime(course: CourseItem) {
  const sections = getCourseSections(course)
  const first = SECTION_TIMES[sections[0]]
  const last = SECTION_TIMES[sections[sections.length - 1]]

  return first && last ? `${first.start}-${last.end}` : ''
}

const SCHOOL_STATUS_LABELS: Record<SchoolStatus, string> = {
  catalog_only: '已收录',
  candidate: '待调研',
  researching: '适配中',
  beta: '内测中',
  enabled: '已接入',
  disabled: '已停用',
}

export function formatSchoolStatus(school: Pick<SchoolListItem, 'status' | 'enabled'>) {
  if (school.enabled || school.status === 'enabled') {
    return '已接入'
  }

  return SCHOOL_STATUS_LABELS[school.status] || '已收录'
}

export function formatSchoolMeta(
  school: Pick<SchoolListItem, 'province' | 'city' | 'status' | 'enabled' | 'message'>,
) {
  return [school.province, school.city, formatSchoolStatus(school)].filter(Boolean).join(' / ')
}

export function getCourseTone(course: CourseItem, index = 0) {
  const tones = ['blue', 'green', 'purple', 'yellow', 'cyan', 'red']
  const key = `${course.name || ''}${course.teacher || ''}${course.classroom || course.location || ''}`
  const hash = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), index)

  return tones[Math.abs(hash) % tones.length]
}
