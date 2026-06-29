import { useEffect, useMemo, useRef, useState } from 'react'
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'
import { Button, Picker, RootPortal, Text, View } from '@tarojs/components'

import {
  acceptBuddyInvite,
  BuddyInvitePreviewResponse,
  BuddyLinkResponse,
  createBuddyInvite,
  getBuddySpace,
  previewBuddyInvite,
  unbindBuddy,
} from '../../shared/api/buddies'
import { CourseItem, TimetableCacheResponse } from '../../shared/api/types'
import { getTimetable } from '../../shared/api/timetable'
import { DEFAULT_SECTION_TIMES, getCourseSections, getSectionTimeMap, getWeekday } from '../../shared/format'
import { PageShell } from '../../shared/layout'
import { rememberPendingBuddyInvite } from '../../shared/buddy-invite'
import {
  clearStoredDataCaches,
  getStoredAccountId,
  getStoredDataCache,
  getStoredTermStarts,
  setStoredDataCache,
} from '../../shared/storage'
import {
  buildTermOptions,
  courseRunsInWeek,
  getCurrentTeachingWeek,
  getTodayTermOption,
} from '../../shared/term'

import './index.scss'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const MAX_WEEK = 20
const LEFT_WIDTH_PERCENT = 8
const DAY_WIDTH_PERCENT = 13.14
const HEADER_HEIGHT = 92
const ROW_HEIGHT = 92
const LESSON_HORIZONTAL_GAP = 3
const LESSON_VERTICAL_GAP = 4
const AFTERNOON_START_SECTION = 5
const DEFAULT_SECTION_COUNT = 13
const MIN_RECOMMENDED_FREE_SPAN = 2

type LessonOwner = 'mine' | 'partner'

interface CourseDisplay {
  id: string
  owner: LessonOwner
  ownerName: string
  course: CourseItem
  weekday: number
  start: number
  end: number
  name: string
  room: string
  teacher: string
  sectionsText: string
  weeksText: string
}

interface CombinedLesson {
  id: string
  weekday: number
  start: number
  end: number
  mine?: CourseDisplay
  partner?: CourseDisplay
}

interface CommonFreeSlot {
  id: string
  weekday: number
  start: number
  end: number
  span: number
  sectionsText: string
  timeText: string
}

type CurrentBuddyStatus = 'both-free' | 'mine-busy' | 'partner-busy' | 'both-busy' | 'unknown'

function decodeRouteParam(value?: string) {
  if (!value) return ''

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getInviteCodeFromRoute(params: Record<string, string | undefined>) {
  return decodeRouteParam(params.invite || params.code)
}

function getDisplayName(account?: { displayName?: string; schoolShortName?: string; schoolName?: string }) {
  return account?.displayName || account?.schoolShortName || account?.schoolName || '课表搭子'
}

function normalizeSection(value: unknown) {
  const section = Number(value)
  return Number.isFinite(section) && section > 0 ? section : 0
}

function getCourseBusySections(course: CourseItem) {
  const sections = getCourseSections(course).map(normalizeSection).filter(Boolean)

  if (sections.length) {
    return sections
  }

  const start = normalizeSection(course.startSection)
  const end = normalizeSection(course.endSection || start)

  if (!start || !end) {
    return []
  }

  return Array.from({ length: Math.max(end - start + 1, 1) }, (_, index) => start + index)
}

function getCourseName(course: CourseItem) {
  return course.name?.trim() || '未命名课程'
}

function getCourseRoom(course: CourseItem) {
  return course.classroom?.trim() || course.location?.trim() || '地点待定'
}

function getCourseTeacher(course: CourseItem) {
  return course.teacher?.trim() || '教师待定'
}

function formatSectionsText(start: number, end: number) {
  return start === end ? `${start}节` : `${start}-${end}节`
}

function formatWeeksText(weeks: number[] | undefined) {
  const sortedWeeks = Array.from(new Set(Array.isArray(weeks) ? weeks.map(Number) : []))
    .filter((week) => Number.isFinite(week) && week > 0)
    .sort((a, b) => a - b)

  if (!sortedWeeks.length) {
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

function getCourseKey(course: CourseDisplay) {
  return `${course.weekday}-${course.start}-${course.end}`
}

function buildCourseDisplays(
  timetable: TimetableCacheResponse | null,
  owner: LessonOwner,
  ownerName: string,
  selectedWeek: number | null,
) {
  return (timetable?.courses || [])
    .filter((course) => selectedWeek === null || courseRunsInWeek(course, selectedWeek))
    .map((course, index): CourseDisplay | null => {
      const weekday = normalizeSection(course.weekday)
      const sections = getCourseBusySections(course)

      if (weekday < 1 || weekday > 7 || !sections.length) {
        return null
      }

      const start = Math.min(...sections)
      const end = Math.max(...sections)

      return {
        id: `${owner}-${course.id || `${weekday}-${start}-${end}-${index}`}`,
        owner,
        ownerName,
        course,
        weekday,
        start,
        end,
        name: getCourseName(course),
        room: getCourseRoom(course),
        teacher: getCourseTeacher(course),
        sectionsText: formatSectionsText(start, end),
        weeksText: formatWeeksText(course.weeks),
      }
    })
    .filter((course): course is CourseDisplay => Boolean(course))
}

function combineLessons(mineCourses: CourseDisplay[], partnerCourses: CourseDisplay[]) {
  const partnerByKey = new Map<string, CourseDisplay[]>()

  partnerCourses.forEach((course) => {
    const key = getCourseKey(course)
    partnerByKey.set(key, [...(partnerByKey.get(key) || []), course])
  })

  const lessons: CombinedLesson[] = mineCourses.map((mine) => {
    const key = getCourseKey(mine)
    const partners = partnerByKey.get(key) || []
    const partner = partners.shift()

    if (partners.length) {
      partnerByKey.set(key, partners)
    } else {
      partnerByKey.delete(key)
    }

    return {
      id: key,
      weekday: mine.weekday,
      start: mine.start,
      end: mine.end,
      mine,
      partner,
    }
  })

  partnerByKey.forEach((courses, key) => {
    courses.forEach((partner, index) => {
      lessons.push({
        id: `${key}-partner-${index}`,
        weekday: partner.weekday,
        start: partner.start,
        end: partner.end,
        partner,
      })
    })
  })

  return lessons.sort((left, right) =>
    left.weekday - right.weekday ||
    left.start - right.start ||
    left.end - right.end,
  )
}

function getVisibleSectionCount(courses: CourseDisplay[]) {
  return Math.max(0, ...courses.map((course) => course.end))
}

function getWeekOptions() {
  return Array.from({ length: MAX_WEEK }, (_, index) => ({
    value: index + 1,
    label: `第${index + 1}周`,
  }))
}

function getLessonOwner(lesson: CombinedLesson, displayOwners: Record<string, LessonOwner>) {
  if (!lesson.mine) return 'partner'
  if (!lesson.partner) return 'mine'
  return displayOwners[lesson.id] || 'mine'
}

function getDisplayedCourse(lesson: CombinedLesson, displayOwners: Record<string, LessonOwner>) {
  const owner = getLessonOwner(lesson, displayOwners)
  return owner === 'partner' ? lesson.partner : lesson.mine
}

function getLessonStyle(lesson: CombinedLesson, sectionCount: number) {
  const leftIndex = lesson.weekday - 1
  const isLastDay = leftIndex === WEEKDAYS.length - 1
  const start = Math.max(lesson.start, 1)
  const end = Math.min(lesson.end, sectionCount)
  const span = Math.max(end - start + 1, 1)
  const top = HEADER_HEIGHT + (start - 1) * ROW_HEIGHT
  const height = span * ROW_HEIGHT

  return [
    `left:calc(${LEFT_WIDTH_PERCENT + leftIndex * DAY_WIDTH_PERCENT}% + ${LESSON_HORIZONTAL_GAP}rpx)`,
    isLastDay ? `right:${LESSON_HORIZONTAL_GAP}rpx` : '',
    `top:${top + LESSON_VERTICAL_GAP}rpx`,
    isLastDay ? '' : `width:calc(${DAY_WIDTH_PERCENT}% - ${LESSON_HORIZONTAL_GAP * 2}rpx)`,
    end === sectionCount
      ? `bottom:${LESSON_VERTICAL_GAP}rpx`
      : `height:${height - LESSON_VERTICAL_GAP * 2}rpx`,
  ].filter(Boolean).join(';')
}

function getTimetableHeight(sectionCount: number) {
  return `height:${HEADER_HEIGHT + sectionCount * ROW_HEIGHT}rpx;`
}

function getScheduleSectionCount(mineCourses: CourseDisplay[], partnerCourses: CourseDisplay[]) {
  return Math.max(DEFAULT_SECTION_COUNT, getVisibleSectionCount([...mineCourses, ...partnerCourses]))
}

function getBuddySectionTimeMap(timetable: TimetableCacheResponse | null) {
  return {
    ...DEFAULT_SECTION_TIMES,
    ...getSectionTimeMap(timetable?.sectionTimes, timetable?.providerId),
  }
}

function parseTimeMinutes(value?: string) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)

  if (!match) {
    return 0
  }

  const hour = Number(match[1])
  const minute = Number(match[2])

  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : 0
}

function formatSectionRangeTime(
  start: number,
  end: number,
  timeMap: ReturnType<typeof getBuddySectionTimeMap>,
) {
  const first = timeMap[start]
  const last = timeMap[end]

  return first && last ? `${first.start}-${last.end}` : formatSectionsText(start, end)
}

function getFreeSlotLabel(slot: Pick<CommonFreeSlot, 'weekday' | 'sectionsText' | 'timeText'>) {
  return `${WEEKDAYS[slot.weekday - 1]} ${slot.timeText || slot.sectionsText}`
}

function markBusySections(courses: CourseDisplay[], weekday: number, sectionCount: number) {
  const busy = new Set<number>()

  courses
    .filter((course) => course.weekday === weekday)
    .forEach((course) => {
      const start = Math.max(course.start, 1)
      const end = Math.min(course.end, sectionCount)

      for (let section = start; section <= end; section += 1) {
        busy.add(section)
      }
    })

  return busy
}

function buildCommonFreeSlots(
  mineCourses: CourseDisplay[],
  partnerCourses: CourseDisplay[],
  sectionCount: number,
  timeMap: ReturnType<typeof getBuddySectionTimeMap>,
) {
  const slots: CommonFreeSlot[] = []

  for (let weekday = 1; weekday <= WEEKDAYS.length; weekday += 1) {
    const mineBusy = markBusySections(mineCourses, weekday, sectionCount)
    const partnerBusy = markBusySections(partnerCourses, weekday, sectionCount)
    let start = 0

    for (let section = 1; section <= sectionCount + 1; section += 1) {
      const isFree = section <= sectionCount && !mineBusy.has(section) && !partnerBusy.has(section)

      if (isFree && !start) {
        start = section
      }

      if ((!isFree || section > sectionCount) && start) {
        const end = section - 1
        slots.push({
          id: `${weekday}-${start}-${end}`,
          weekday,
          start,
          end,
          span: end - start + 1,
          sectionsText: formatSectionsText(start, end),
          timeText: formatSectionRangeTime(start, end, timeMap),
        })
        start = 0
      }
    }
  }

  return slots
}

function getRecommendedFreeSlots(slots: CommonFreeSlot[], today: number) {
  return [...slots]
    .filter((slot) => slot.span >= MIN_RECOMMENDED_FREE_SPAN)
    .sort((left, right) => {
      const leftToday = left.weekday === today ? 0 : 1
      const rightToday = right.weekday === today ? 0 : 1

      return leftToday - rightToday ||
        left.weekday - right.weekday ||
        left.start - right.start ||
        right.span - left.span
    })
    .slice(0, 5)
}

function getCurrentSection(timeMap: ReturnType<typeof getBuddySectionTimeMap>, now = new Date()) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  for (const [sectionText, time] of Object.entries(timeMap)) {
    const start = parseTimeMinutes(time.start)
    const end = parseTimeMinutes(time.end)
    const section = Number(sectionText)

    if (section && start && end && currentMinutes >= start && currentMinutes <= end) {
      return section
    }
  }

  return 0
}

function getCurrentBuddyStatus(
  mineCourses: CourseDisplay[],
  partnerCourses: CourseDisplay[],
  sectionCount: number,
  timeMap: ReturnType<typeof getBuddySectionTimeMap>,
) {
  const today = getWeekday()
  const currentSection = getCurrentSection(timeMap)

  if (!currentSection || currentSection > sectionCount) {
    return 'unknown' as CurrentBuddyStatus
  }

  const mineBusy = markBusySections(mineCourses, today, sectionCount).has(currentSection)
  const partnerBusy = markBusySections(partnerCourses, today, sectionCount).has(currentSection)

  if (mineBusy && partnerBusy) return 'both-busy'
  if (mineBusy) return 'mine-busy'
  if (partnerBusy) return 'partner-busy'
  return 'both-free'
}

function getCurrentBuddyStatusText(status: CurrentBuddyStatus, partnerName: string) {
  if (status === 'both-free') return '现在你们都空'
  if (status === 'mine-busy') return '现在你有课'
  if (status === 'partner-busy') return `现在 ${partnerName} 有课`
  if (status === 'both-busy') return '现在你们都在上课'
  return '当前不在上课时段'
}

export default function BuddySpacePage() {
  const router = useRouter()
  const inviteCode = getInviteCodeFromRoute(router.params || {})
  const [accountId, setAccountId] = useState('')
  const [ownTimetable, setOwnTimetable] = useState<TimetableCacheResponse | null>(null)
  const [links, setLinks] = useState<BuddyLinkResponse[]>([])
  const [activePartnerId, setActivePartnerId] = useState('')
  const [invitePreview, setInvitePreview] = useState<BuddyInvitePreviewResponse | null>(null)
  const [shareInvite, setShareInvite] = useState<{ path: string; expiresAt: string } | null>(null)
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null)
  const [displayOwners, setDisplayOwners] = useState<Record<string, LessonOwner>>({})
  const [selectedLesson, setSelectedLesson] = useState<CombinedLesson | null>(null)
  const shareSlotRef = useRef<CommonFreeSlot | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState('')

  useDidShow(() => {
    Taro.showShareMenu({
      withShareTicket: true,
      showShareItems: ['shareAppMessage'],
    })

    const nextAccountId = getStoredAccountId()
    setAccountId(nextAccountId)

    if (inviteCode) {
      void loadInvite(inviteCode)
    }

    if (nextAccountId) {
      void loadSpace(nextAccountId)
      void ensureShareInvite(nextAccountId)
    }
  })

  useEffect(() => {
    if (!message && !errorText) {
      return undefined
    }

    const timer = setTimeout(() => {
      setMessage('')
      setErrorText('')
    }, 3000)

    return () => clearTimeout(timer)
  }, [message, errorText])

  useShareAppMessage(() => ({
    title: shareSlotRef.current
      ? `${getFreeSlotLabel(shareSlotRef.current)} 有空，一起吗？`
      : '来和我对一下共同空档',
    path: shareInvite?.path || '/pages/buddy-space/index',
  }))

  const activeLink = useMemo(
    () => links.find((link) => link.partner.accountId === activePartnerId) || links[0] || null,
    [activePartnerId, links],
  )
  const partnerName = getDisplayName(activeLink?.partner)
  const partnerTimetable = activeLink?.timetable || null
  const mineCourses = useMemo(
    () => buildCourseDisplays(ownTimetable, 'mine', '我', selectedWeek),
    [ownTimetable, selectedWeek],
  )
  const partnerCourses = useMemo(
    () => buildCourseDisplays(partnerTimetable, 'partner', partnerName, selectedWeek),
    [partnerName, partnerTimetable, selectedWeek],
  )
  const combinedLessons = useMemo(
    () => combineLessons(mineCourses, partnerCourses),
    [mineCourses, partnerCourses],
  )
  const sectionCount = useMemo(
    () => getScheduleSectionCount(mineCourses, partnerCourses),
    [mineCourses, partnerCourses],
  )
  const sectionTimeMap = useMemo(
    () => getBuddySectionTimeMap(ownTimetable || partnerTimetable),
    [ownTimetable, partnerTimetable],
  )
  const commonFreeSlots = useMemo(
    () => buildCommonFreeSlots(mineCourses, partnerCourses, sectionCount, sectionTimeMap),
    [mineCourses, partnerCourses, sectionCount, sectionTimeMap],
  )
  const todayWeekday = getWeekday()
  const todayFreeSlots = useMemo(
    () => commonFreeSlots.filter((slot) => slot.weekday === todayWeekday),
    [commonFreeSlots, todayWeekday],
  )
  const recommendedFreeSlots = useMemo(
    () => getRecommendedFreeSlots(commonFreeSlots, todayWeekday),
    [commonFreeSlots, todayWeekday],
  )
  const longestFreeSlot = useMemo(
    () => [...commonFreeSlots].sort((left, right) => right.span - left.span || left.weekday - right.weekday || left.start - right.start)[0] || null,
    [commonFreeSlots],
  )
  const currentBuddyStatus = useMemo(
    () => getCurrentBuddyStatus(mineCourses, partnerCourses, sectionCount, sectionTimeMap),
    [mineCourses, partnerCourses, sectionCount, sectionTimeMap],
  )
  const weekOptions = useMemo(() => getWeekOptions(), [])
  const selectedWeekIndex = Math.max(
    weekOptions.findIndex((week) => week.value === selectedWeek),
    0,
  )

  async function loadInvite(code: string) {
    try {
      setInvitePreview(await previewBuddyInvite(code))
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '邀请已失效')
    }
  }

  async function loadSpace(id = accountId) {
    if (!id) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      const [own, space] = await Promise.all([
        getTimetable(id).catch(() => getStoredDataCache<TimetableCacheResponse>(id, 'timetable')?.data || null),
        getBuddySpace(),
      ])

      if (own) {
        setOwnTimetable(own)
        const terms = buildTermOptions(own)
        const todayTerm = getTodayTermOption(terms) || terms[0] || null
        const week = getCurrentTeachingWeek(todayTerm, todayTerm?.id || own.termId, getStoredTermStarts())

        setSelectedWeek((current) => current || week)
      }

      for (const link of space.links) {
        if (link.timetable) {
          setStoredDataCache(link.partner.accountId, 'timetable', link.timetable, {
            sourceHash: link.timetable.sourceHash,
            syncedAt: link.timetable.syncedAt,
          })
        }
      }

      setLinks(space.links)
      setActivePartnerId((current) =>
        current && space.links.some((link) => link.partner.accountId === current)
          ? current
          : (space.links[0]?.partner.accountId || ''),
      )
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '搭子空间读取失败')
    } finally {
      setLoading(false)
    }
  }

  async function ensureShareInvite(ownerAccountId = accountId) {
    if (shareInvite || inviteLoading) {
      return shareInvite
    }

    if (!ownerAccountId) {
      return null
    }

    setInviteLoading(true)
    setErrorText('')

    try {
      const invite = await createBuddyInvite()
      setShareInvite(invite)
      return invite
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '邀请生成失败')
      return null
    } finally {
      setInviteLoading(false)
    }
  }

  function openBindForInviteOwner() {
    Taro.showModal({
      title: '先导入你的课表',
      content: '导入完成后再回到搭子空间，就可以把邀请链接转发给好友。',
      confirmText: '去导入',
      success: (result) => {
        if (result.confirm) {
          Taro.navigateTo({ url: '/pages/bind/index?redirectAfterBind=buddy-space' })
        }
      },
    })
  }

  async function acceptInvite() {
    if (!inviteCode || !invitePreview) {
      return
    }

    if (!accountId) {
      const inviterName = getDisplayName(invitePreview.inviter)
      rememberPendingBuddyInvite(inviteCode, inviterName)
      Taro.showModal({
        title: '导入后自动绑定',
        content: `导入你的课表后，会自动和 ${inviterName} 完成绑定，双方都能在搭子空间查看课表。`,
        confirmText: '去导入',
        success: (result) => {
          if (result.confirm) {
            Taro.navigateTo({ url: '/pages/bind/index?redirectAfterBind=buddy-space' })
          }
        },
      })
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      await acceptBuddyInvite(inviteCode)
      await Taro.showModal({
        title: '已绑定搭子',
        content: `你和 ${getDisplayName(invitePreview.inviter)} 已互相开放课表查看。`,
        showCancel: false,
      })
      await loadSpace(accountId)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '绑定失败')
    } finally {
      setLoading(false)
    }
  }

  async function confirmUnbind() {
    if (!activeLink) {
      return
    }

    const result = await Taro.showModal({
      title: '解除绑定',
      content: '解除后双方都会从搭子空间移除彼此课表，不需要对方确认。是否继续？',
      confirmText: '解除',
      confirmColor: '#e11d48',
    })

    if (!result.confirm) {
      return
    }

    setLoading(true)
    setErrorText('')

    try {
      await unbindBuddy(activeLink.partner.accountId)
      clearStoredDataCaches(activeLink.partner.accountId)
      setMessage('已解除绑定')
      setSelectedLesson(null)
      await loadSpace(accountId)
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : '解绑失败')
    } finally {
      setLoading(false)
    }
  }

  function toggleLessonOwner(lesson: CombinedLesson) {
    if (!lesson.mine || !lesson.partner) {
      return
    }

    setDisplayOwners((current) => ({
      ...current,
      [lesson.id]: (current[lesson.id] || 'mine') === 'mine' ? 'partner' : 'mine',
    }))
  }

  function renderInvitePanel() {
    if (!invitePreview || invitePreview.status !== 'pending') {
      return null
    }

    return (
      <View className='soft-card buddy-invite-card'>
        <View className='buddy-card-title'>{getDisplayName(invitePreview.inviter)} 邀请你绑定课表</View>
        <View className='buddy-card-desc'>
          {accountId
            ? '同意后你们可以在搭子空间互相查看课表，并自动计算公共空闲时间。'
            : '你还没有导入课表。导入完成后会自动绑定这位搭子。'}
        </View>
        <Button className='button buddy-primary-button' loading={loading} onClick={acceptInvite}>
          {accountId ? '同意绑定' : '去导入课表'}
        </Button>
      </View>
    )
  }

  function renderTopTools() {
    return (
      <View className='buddy-toolbar'>
        {links.length > 0 && (
          <Picker
            mode='selector'
            range={links.map((link) => getDisplayName(link.partner))}
            value={Math.max(links.findIndex((link) => link.partner.accountId === activeLink?.partner.accountId), 0)}
            onChange={(event) => {
              const link = links[Number(event.detail.value)]
              setSelectedLesson(null)
              setActivePartnerId(link?.partner.accountId || '')
            }}
          >
            <View className='buddy-tool buddy-name-tool'>
              <Text>{getDisplayName(activeLink?.partner)}</Text>
              <View className='buddy-picker-arrow' />
            </View>
          </Picker>
        )}
        {links.length > 0 && (
          <Picker
            mode='selector'
            range={weekOptions.map((week) => week.label)}
            value={selectedWeekIndex}
            onChange={(event) => {
              setSelectedLesson(null)
              setSelectedWeek(weekOptions[Number(event.detail.value)]?.value || 1)
            }}
          >
            <View className='buddy-tool buddy-week-tool'>
              <Text>{weekOptions[selectedWeekIndex]?.label || '第1周'}</Text>
              <View className='buddy-picker-arrow' />
            </View>
          </Picker>
        )}
        {accountId && !inviteCode && (
          <Button
            className='buddy-tool buddy-action-tool'
            loading={inviteLoading}
            disabled={!shareInvite}
            openType='share'
            onClick={() => {
              shareSlotRef.current = null
            }}
          >
            分享
          </Button>
        )}
        {activeLink && (
          <Button className='buddy-tool buddy-action-tool buddy-danger-tool' loading={loading} onClick={confirmUnbind}>
            解绑
          </Button>
        )}
        {!accountId && !inviteCode && (
          <Button className='buddy-tool buddy-bind-tool' onClick={openBindForInviteOwner}>
            先导入我的课表
          </Button>
        )}
      </View>
    )
  }

  function renderFreeSlot(slot: CommonFreeSlot, featured = false) {
    return (
      <View className={`buddy-free-slot${featured ? ' buddy-free-slot-featured' : ''}`} key={slot.id}>
        <View className='buddy-free-slot-main'>
          <View className='buddy-free-slot-day'>{WEEKDAYS[slot.weekday - 1]}</View>
          <View className='buddy-free-slot-time'>{slot.timeText}</View>
          <View className='buddy-free-slot-sections'>{slot.sectionsText}，连续 {slot.span} 节</View>
        </View>
        <Button
          className='buddy-free-slot-share'
          disabled={!shareInvite}
          openType='share'
          onClick={() => {
            shareSlotRef.current = slot
          }}
        >
          发起
        </Button>
      </View>
    )
  }

  function renderFreeSummary() {
    if (!activeLink || !ownTimetable || !partnerTimetable) {
      return null
    }

    const primarySlot = recommendedFreeSlots[0] || todayFreeSlots[0] || longestFreeSlot
    const statusText = getCurrentBuddyStatusText(currentBuddyStatus, partnerName)
    const secondarySlots = recommendedFreeSlots
      .filter((slot) => slot.id !== primarySlot?.id)
      .slice(0, 3)

    return (
      <View className='buddy-free-section'>
        <View className='soft-card buddy-free-hero'>
          <View className='buddy-free-kicker'>共同空档</View>
          <View className='buddy-free-title'>
            {primarySlot ? getFreeSlotLabel(primarySlot) : '本周暂时没有共同空档'}
          </View>
          <View className='buddy-free-desc'>
            {primarySlot
              ? statusText
              : '双方课程排得比较满，可以切换周次再看看。'}
          </View>
          {primarySlot && (
            <View className='buddy-free-stats'>
              <View className='buddy-free-stat'>今日 {todayFreeSlots.length} 段</View>
              <View className='buddy-free-stat'>本周 {commonFreeSlots.length} 段</View>
            </View>
          )}
          {primarySlot && (
            <Button
              className='button buddy-free-primary'
              disabled={!shareInvite}
              openType='share'
              onClick={() => {
                shareSlotRef.current = primarySlot
              }}
            >
              发给搭子确认
            </Button>
          )}
        </View>

        {secondarySlots.length > 0 && (
          <View className='buddy-free-list'>
            {secondarySlots.map((slot) => renderFreeSlot(slot))}
          </View>
        )}
      </View>
    )
  }

  function renderScheduleGrid() {
    if (!activeLink || !ownTimetable || !partnerTimetable) {
      return null
    }

    if (mineCourses.length === 0 && partnerCourses.length === 0) {
      return <View className='soft-card buddy-empty-card buddy-small-empty'>本周双方暂无课程</View>
    }

    return (
      <View className='soft-card buddy-timetable-card'>
        <View className='buddy-timetable-head'>
          <View className='buddy-section-title'>课表对照</View>
          <View className='buddy-legend'>
            <View className='buddy-legend-item buddy-legend-mine'>我</View>
            <View className='buddy-legend-item buddy-legend-partner'>{partnerName}</View>
          </View>
        </View>
        <View className='buddy-timetable' style={getTimetableHeight(sectionCount)}>
          <View className='buddy-time-head'>节</View>
          {WEEKDAYS.map((weekday, index) => (
            <View
              className='buddy-weekday'
              key={weekday}
              style={[
                `left:${LEFT_WIDTH_PERCENT + DAY_WIDTH_PERCENT * index}%;`,
                index === WEEKDAYS.length - 1 ? 'right:0;' : `width:${DAY_WIDTH_PERCENT}%;`,
              ].join('')}
            >
              {weekday}
            </View>
          ))}

          {Array.from({ length: sectionCount }, (_, index) => {
            const section = index + 1
            const top = HEADER_HEIGHT + index * ROW_HEIGHT
            return (
              <View
                className={`buddy-section-row ${section === AFTERNOON_START_SECTION ? 'buddy-section-row-afternoon' : ''}`}
                key={section}
                style={`top:${top}rpx;height:${ROW_HEIGHT}rpx;`}
              >
                <View className='buddy-section-index'>{section}</View>
                {section === AFTERNOON_START_SECTION && <View className='buddy-afternoon-label'>下午</View>}
              </View>
            )
          })}

          {combinedLessons.map((lesson) => {
            const displayed = getDisplayedCourse(lesson, displayOwners)
            const owner = getLessonOwner(lesson, displayOwners)
            const hasBoth = Boolean(lesson.mine && lesson.partner)

            if (!displayed) {
              return null
            }

            return (
              <View
                className={`buddy-lesson buddy-lesson-${owner} ${hasBoth ? 'buddy-lesson-both' : ''}`}
                key={lesson.id}
                style={getLessonStyle(lesson, sectionCount)}
                onClick={() => setSelectedLesson(lesson)}
              >
                <View className='buddy-lesson-owner'>{displayed.ownerName}</View>
                <View className='buddy-lesson-name'>{displayed.name}</View>
                <View className='buddy-lesson-room'>{displayed.room}</View>
                {hasBoth && (
                  <View
                    className='buddy-lesson-switch'
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleLessonOwner(lesson)
                    }}
                  >
                    换
                  </View>
                )}
              </View>
            )
          })}
        </View>
      </View>
    )
  }

  function renderDetailCourse(course: CourseDisplay | undefined, label: string) {
    return (
      <View className='buddy-detail-course'>
        <View className='buddy-detail-owner'>{label}</View>
        {course ? (
          <>
            <View className='buddy-detail-name'>{course.name}</View>
            <View className='buddy-detail-row'>
              <Text>时间</Text>
              <Text>{WEEKDAYS[course.weekday - 1]} {course.sectionsText}</Text>
            </View>
            <View className='buddy-detail-row'>
              <Text>地点</Text>
              <Text>{course.room}</Text>
            </View>
            <View className='buddy-detail-row'>
              <Text>教师</Text>
              <Text>{course.teacher}</Text>
            </View>
            <View className='buddy-detail-row'>
              <Text>周次</Text>
              <Text>{course.weeksText}</Text>
            </View>
          </>
        ) : (
          <View className='buddy-detail-empty'>这段时间无课程</View>
        )}
      </View>
    )
  }

  return (
    <PageShell title='搭子空间' back subPage contentClassName='buddy-content'>
      {message && <View className='status'>{message}</View>}
      {errorText && <View className='status status-error'>{errorText}</View>}

      {renderInvitePanel()}
      {renderTopTools()}

      {loading && <View className='soft-card state-card'>正在读取搭子空间</View>}

      {!loading && links.length === 0 && !invitePreview && (
        <View className='soft-card buddy-empty-card'>
          <View className='buddy-card-title'>还没有课表搭子</View>
          <View className='buddy-card-desc'>把邀请链接转发给好友，对方导入或同意后会自动出现在这里。</View>
        </View>
      )}

      {renderFreeSummary()}

      {renderScheduleGrid()}

      {selectedLesson && (
        <RootPortal>
          <View className='buddy-detail-mask' onClick={() => setSelectedLesson(null)}>
            <View className='buddy-detail-card' onClick={(event) => event.stopPropagation()}>
              <View className='buddy-detail-head'>
                <View>
                  <View className='buddy-detail-kicker'>
                    {WEEKDAYS[selectedLesson.weekday - 1]} {formatSectionsText(selectedLesson.start, selectedLesson.end)}
                  </View>
                  <View className='buddy-detail-title'>课程详情</View>
                </View>
                <View className='buddy-detail-close' onClick={() => setSelectedLesson(null)} />
              </View>
              {renderDetailCourse(selectedLesson.mine, '我')}
              {renderDetailCourse(selectedLesson.partner, partnerName)}
            </View>
          </View>
        </RootPortal>
      )}
    </PageShell>
  )
}
