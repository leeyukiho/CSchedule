// Weekly full-cache promo data for the Mini Program console.
// Paste this whole file once. It overwrites the current account's timetable and exam cache.
(() => {
  const AUTH_STATE_KEY = 'cschedule.authState'
  const ACCOUNT_SUMMARY_PREFIX = 'cschedule.accountSummary.'
  const ACCOUNT_TERM_STARTS_PREFIX = 'cschedule.accountTermStarts.'
  const DATA_CACHE_PREFIX = 'cschedule.dataCache.'

  const FALLBACK_ACCOUNT_ID = 'cmqs6mynb000fv49ow4o5a2nh'
  const FALLBACK_SCHOOL_ID = 'moe_4142013666'
  const FALLBACK_PROVIDER_ID = 'whhxit'
  const FALLBACK_TERM_ID = '2025-12'
  const MAJOR_NAME = '网络与新媒体'

  const pad = (value) => String(value).padStart(2, '0')
  const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const clockFromMinutes = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
  const today = new Date()
  const todayKey = dateKey(today)
  const todayWeekday = today.getDay() === 0 ? 7 : today.getDay()
  const nowMinutes = today.getHours() * 60 + today.getMinutes()
  const isFriday = todayWeekday === 5

  const readRecord = (key) => {
    const value = wx.getStorageSync(key)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  }
  const dataCacheKey = (accountId, target, termId = '') =>
    `${DATA_CACHE_PREFIX}${accountId}.${target}.${termId || 'latest'}`
  const isoLocal = (dayKey, minutes) => `${dayKey}T${clockFromMinutes(minutes)}:00+08:00`

  function resolveAccount() {
    const authState = readRecord(AUTH_STATE_KEY)
    const accountId = typeof authState.accountId === 'string' && authState.accountId
      ? authState.accountId
      : FALLBACK_ACCOUNT_ID
    const summary = readRecord(`${ACCOUNT_SUMMARY_PREFIX}${accountId}`)

    return {
      accountId,
      schoolId:
        (typeof authState.schoolId === 'string' && authState.schoolId) ||
        (typeof summary.schoolId === 'string' && summary.schoolId) ||
        FALLBACK_SCHOOL_ID,
      providerId:
        (typeof summary.providerId === 'string' && summary.providerId) ||
        FALLBACK_PROVIDER_ID,
      hadAuthState: Boolean(authState.accountId),
    }
  }

  function resolveTermId(accountId) {
    const latest = readRecord(dataCacheKey(accountId, 'timetable'))
    const latestData = latest.data && typeof latest.data === 'object' ? latest.data : {}

    return typeof latestData.termId === 'string' && latestData.termId
      ? latestData.termId
      : FALLBACK_TERM_ID
  }

  function getMondayKey(date) {
    const monday = new Date(date)
    const weekday = monday.getDay() === 0 ? 7 : monday.getDay()
    monday.setDate(monday.getDate() - weekday + 1)
    return dateKey(monday)
  }

  function buildSlots() {
    return [
      { start: 8 * 60, end: 9 * 60 + 40 },
      { start: 9 * 60 + 50, end: 11 * 60 + 30 },
      { start: 11 * 60 + 40, end: 13 * 60 + 20 },
      { start: 14 * 60, end: 15 * 60 + 40 },
      { start: 15 * 60 + 50, end: 17 * 60 + 30 },
      { start: 17 * 60 + 40, end: 19 * 60 + 20 },
    ]
  }

  const slots = buildSlots()
  const coursePlan = [
    {
      id: 'promo-ncm-course-01',
      name: '新媒体概论',
      teacher: '林思远',
      classroom: '传媒楼 A301',
      weekday: 1,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-02',
      name: '网络传播学',
      teacher: '周亦禾',
      classroom: '新闻传播实验室 204',
      weekday: 1,
      sections: [3, 4],
      slot: 1,
    },
    {
      id: 'promo-ncm-course-03',
      name: '融媒体新闻采编',
      teacher: '沈清扬',
      classroom: '全媒体采编中心',
      weekday: 2,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-04',
      name: '数据新闻与可视化',
      teacher: '许知行',
      classroom: '数据可视化机房 B412',
      weekday: 2,
      sections: [3, 4],
      slot: 1,
    },
    {
      id: 'promo-ncm-course-05',
      name: '短视频创作与运营',
      teacher: '何若宁',
      classroom: '短视频工作坊',
      weekday: 3,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-06',
      name: '互动产品原型设计',
      teacher: '高予安',
      classroom: '交互设计实验室 318',
      weekday: 3,
      sections: [5, 6],
      slot: 2,
    },
    {
      id: 'promo-ncm-course-07',
      name: '数字摄影与后期',
      teacher: '陈砚秋',
      classroom: '影像制作中心 102',
      weekday: 4,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-08',
      name: '内容营销策划',
      teacher: '陆嘉言',
      classroom: '传媒楼 C205',
      weekday: 4,
      sections: [3, 4],
      slot: 1,
    },
    {
      id: 'promo-ncm-course-09',
      name: '舆情数据采集',
      teacher: '唐书禾',
      classroom: '舆情分析实验室 506',
      weekday: 5,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-10',
      name: '社交媒体运营',
      teacher: '孟晓澜',
      classroom: '运营实训室 407',
      weekday: 5,
      sections: [3, 4],
      slot: 1,
    },
    {
      id: 'promo-ncm-course-11',
      name: '品牌传播工作坊',
      teacher: '魏嘉树',
      classroom: '品牌策划工作室',
      weekday: 5,
      sections: [5, 6],
      slot: 2,
    },
    {
      id: 'promo-ncm-course-12',
      name: '直播导播实践',
      teacher: '邱亦然',
      classroom: '直播演播厅',
      weekday: 6,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-13',
      name: '移动端内容发布',
      teacher: '苏沐晴',
      classroom: '移动媒体实验室 219',
      weekday: 6,
      sections: [3, 4],
      slot: 1,
    },
    {
      id: 'promo-ncm-course-14',
      name: '创意写作训练',
      teacher: '白景行',
      classroom: '写作研讨室 112',
      weekday: 7,
      sections: [1, 2],
      slot: 0,
    },
    {
      id: 'promo-ncm-course-15',
      name: '作品集复盘',
      teacher: '韩知夏',
      classroom: '项目路演厅',
      weekday: 7,
      sections: [5, 6],
      slot: 2,
    },
  ]
  const examPlan = [
    {
      id: 'promo-ncm-exam-01',
      courseName: '传播法规与伦理',
      examType: '课程测验',
      location: '传媒楼 B201',
      seatNo: 'N08',
      slot: 3,
    },
    {
      id: 'promo-ncm-exam-02',
      courseName: '新媒体产品策划',
      examType: '阶段考核',
      location: '创新实践中心 305',
      seatNo: 'P16',
      slot: 4,
    },
    {
      id: 'promo-ncm-exam-03',
      courseName: '网络舆情分析',
      examType: '随堂测试',
      location: '舆情分析实验室 506',
      seatNo: 'Y03',
      slot: 5,
    },
  ]

  function makeCourse(item) {
    const slot = slots[item.slot]

    return {
      id: item.id,
      name: item.name,
      teacher: item.teacher,
      location: item.classroom,
      classroom: item.classroom,
      campus: '主校区',
      weekday: item.weekday || 5,
      weeks: Array.from({ length: 60 }, (_, index) => index + 1),
      rawWeeks: '1-60周',
      sections: item.sections,
      startSection: item.sections[0],
      endSection: item.sections[item.sections.length - 1],
      startTime: clockFromMinutes(slot.start),
      endTime: clockFromMinutes(slot.end),
      time: `${clockFromMinutes(slot.start)}-${clockFromMinutes(slot.end)}`,
    }
  }

  function makeExam(item) {
    const slot = slots[item.slot]
    const finished = slot.end < nowMinutes

    return {
      id: item.id,
      courseName: item.courseName,
      name: item.courseName,
      examType: item.examType,
      date: todayKey,
      time: `${clockFromMinutes(slot.start)}-${clockFromMinutes(slot.end)}`,
      startAt: isoLocal(todayKey, slot.start),
      endAt: isoLocal(todayKey, slot.end),
      location: item.location,
      seatNo: item.seatNo,
      status: finished ? 'finished' : 'upcoming',
      remark: `${MAJOR_NAME}宣传截图数据`,
    }
  }

  const { accountId, schoolId, providerId, hadAuthState } = resolveAccount()
  const termId = resolveTermId(accountId)
  const nowIso = new Date().toISOString()
  const sourceHash = `promo-weekly-${MAJOR_NAME}-${todayKey}-${Date.now()}`
  const courses = coursePlan.map(makeCourse)
  const exams = examPlan.map(makeExam)
  const upcomingExams = exams.filter((exam) => exam.status !== 'finished')
  const finishedExams = exams.filter((exam) => exam.status === 'finished')

  const previousTimetable = readRecord(dataCacheKey(accountId, 'timetable'))
  const previousTimetableData =
    previousTimetable.data && typeof previousTimetable.data === 'object'
      ? previousTimetable.data
      : {}
  const session =
    previousTimetableData.session ||
    readRecord(`${ACCOUNT_SUMMARY_PREFIX}${accountId}`).session ||
    {
      sessionReusable: false,
      sessionRefreshable: false,
      accountStatus: 'cached_only',
    }
  const terms = Array.isArray(previousTimetableData.terms) && previousTimetableData.terms.length
    ? previousTimetableData.terms
    : [{ id: termId, label: '2025-2026学年第二学期' }]
  const termStarts = {
    ...(previousTimetableData.termStarts || {}),
    [termId]: getMondayKey(today),
  }

  const timetableData = {
    ...previousTimetableData,
    accountId,
    schoolId,
    providerId,
    termId,
    courses,
    terms,
    termStarts,
    sectionTimes: previousTimetableData.sectionTimes || [],
    sectionTimeProfiles: previousTimetableData.sectionTimeProfiles || [],
    display: {
      ...(previousTimetableData.display || {}),
      majorName: MAJOR_NAME,
    },
    session,
    sourceHash,
    syncedAt: nowIso,
  }
  const timetableCache = {
    data: timetableData,
    sourceHash,
    syncedAt: nowIso,
    cachedAt: nowIso,
  }

  const examData = {
    accountId,
    schoolId,
    providerId,
    target: 'exam',
    termId,
    data: {
      majorName: MAJOR_NAME,
      date: todayKey,
      items: exams,
      upcoming: upcomingExams,
      finished: finishedExams,
    },
    meta: {
      title: `${MAJOR_NAME}一周课程与考试`,
      generatedFor: 'promo-screenshot',
    },
    session,
    sourceHash,
    syncedAt: nowIso,
  }
  const examCache = {
    data: examData,
    sourceHash,
    syncedAt: nowIso,
    cachedAt: nowIso,
  }

  if (!hadAuthState) {
    wx.setStorageSync(AUTH_STATE_KEY, {
      accountId,
      schoolId,
      updatedAt: nowIso,
    })
  }

  wx.setStorageSync(`${ACCOUNT_SUMMARY_PREFIX}${accountId}`, {
    id: accountId,
    schoolId,
    providerId,
    displayName: `${MAJOR_NAME}宣传号`,
    status: 'cached_only',
    sessionReusable: false,
    sessionRefreshable: false,
    school: {
      id: schoolId,
      name: '武汉东湖学院',
      shortName: '武东院',
      city: '武汉',
    },
  })
  wx.setStorageSync(`${ACCOUNT_TERM_STARTS_PREFIX}${accountId}`, termStarts)
  wx.setStorageSync(dataCacheKey(accountId, 'timetable'), timetableCache)
  wx.setStorageSync(dataCacheKey(accountId, 'timetable', termId), timetableCache)
  wx.setStorageSync(dataCacheKey(accountId, 'exam'), examCache)
  wx.setStorageSync(dataCacheKey(accountId, 'exam', termId), examCache)

  console.log(`${MAJOR_NAME}一周完整缓存已写入`, {
    accountId,
    schoolId,
    providerId,
    termId,
    date: todayKey,
    isFriday,
    courses: courses.map((course) => `${course.startTime}-${course.endTime} ${course.name} @ ${course.classroom}`),
    exams: exams.map((exam) => `${exam.time} ${exam.courseName} @ ${exam.location}`),
  })

  if (!isFriday) {
    console.warn('今天不是周五。考试会按今天展示；如果宣传图要周五样式，建议在周五或调试器模拟周五截图。')
  }

  if (typeof wx.reLaunch === 'function') {
    setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 50)
  }
})()
