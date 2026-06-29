// Home card style cache snippets.
// Usage in the Mini Program console:
// 1. Copy and run "Snippet 0: writer" first.
// 2. Copy and run exactly one scenario snippet.
// 3. All course/exam durations are 60 minutes.
// 4. Each scenario keeps at most one ended course and one ended exam.
// 5. Scenario times are relative to the moment you run the snippet.
//
// Time windows tuned for 2026-06-29 21:18 +08:00:
// - ended: now -80/-75 to now -20/-15
// - current: overlaps now
// - next: starts 15 minutes from now
// - pending: starts 90 minutes from now

// ====================
// Snippet 0: writer
// ====================
(() => {
  const accountId = 'cmqryeymg0001de2w1yoityie'
  const schoolId = 'moe_4142011798'
  const providerId = 'wdu'
  const termId = '2025-12'
  const timetableLatestKey = `cschedule.dataCache.${accountId}.timetable.latest`
  const timetableTermKey = `cschedule.dataCache.${accountId}.timetable.${termId}`
  const examLatestKey = `cschedule.dataCache.${accountId}.exam.latest`
  const examTermKey = `cschedule.dataCache.${accountId}.exam.${termId}`
  const previousTestPrefixes = ['local-friday-', 'local-saturday-', 'local-today-', 'local-fixed-']
  const weeks = Array.from({ length: 60 }, (_, index) => index + 1)
  const root = typeof globalThis !== 'undefined' ? globalThis : window

  const pad = (value) => String(value).padStart(2, '0')
  const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000)
  const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const clock = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const isoLocal = (date) => `${dateKey(date)}T${clock(date)}:00+08:00`
  const weekday = (date) => date.getDay() === 0 ? 7 : date.getDay()

  function makeCourse(baseNow, item, index) {
    const start = addMinutes(baseNow, item.start)
    const end = addMinutes(baseNow, item.end)
    const sections = item.sections || [index * 2 + 1, index * 2 + 2]

    return {
      id: item.id,
      name: item.name,
      weeks,
      campus: 'Main',
      teacher: item.teacher || 'Test Teacher',
      weekday: weekday(baseNow),
      location: item.room,
      rawWeeks: '1-60 weeks',
      sections,
      classroom: item.room,
      startSection: sections[0],
      endSection: sections[sections.length - 1],
      startTime: clock(start),
      endTime: clock(end),
    }
  }

  function makeExam(baseNow, item) {
    const start = addMinutes(baseNow, item.start)
    const end = addMinutes(baseNow, item.end)

    return {
      id: item.id,
      courseName: item.name,
      examType: 'Test Exam',
      date: dateKey(start),
      time: `${clock(start)}-${clock(end)}`,
      startAt: isoLocal(start),
      endAt: isoLocal(end),
      location: item.location,
      seatNo: item.seatNo || 'A01',
      status: item.status || 'upcoming',
      remark: item.remark || '',
    }
  }

  root.__CSCHEDULE_WRITE_HOME_CARD_SCENARIO__ = (scenario) => {
    const baseNow = new Date()
    const now = new Date().toISOString()
    const sourceHash = `local-fixed-card-style-${scenario.id}-${Date.now()}`
    const baseTimetableCache = wx.getStorageSync(timetableLatestKey) || wx.getStorageSync(timetableTermKey)

    if (!baseTimetableCache || !baseTimetableCache.data || !Array.isArray(baseTimetableCache.data.courses)) {
      console.error('Timetable cache not found. Open/import timetable once, then run this script.', {
        timetableLatestKey,
        timetableTermKey,
        baseTimetableCache,
      })
      return
    }

    const addedCourses = (scenario.courses || []).map((item, index) => makeCourse(baseNow, item, index))
    const nextCourses = [
      ...baseTimetableCache.data.courses.filter((course) => {
        const id = course && String(course.id || '')
        return !previousTestPrefixes.some((prefix) => id.startsWith(prefix))
      }),
      ...addedCourses,
    ]

    const nextTimetableData = {
      ...baseTimetableCache.data,
      accountId,
      schoolId,
      providerId,
      termId,
      courses: nextCourses,
      sourceHash,
      syncedAt: now,
    }
    const nextTimetableCache = {
      data: nextTimetableData,
      sourceHash,
      syncedAt: now,
      cachedAt: now,
    }

    const baseExamCache = wx.getStorageSync(examLatestKey) || wx.getStorageSync(examTermKey)
    const baseExamData =
      baseExamCache && baseExamCache.data && baseExamCache.data.data && typeof baseExamCache.data.data === 'object'
        ? baseExamCache.data.data
        : {}
    const existingExamItems = Array.isArray(baseExamData.items)
      ? baseExamData.items
      : Array.isArray(baseExamData.upcoming)
        ? baseExamData.upcoming
        : Array.isArray(baseExamData)
          ? baseExamData
          : []
    const addedExams = (scenario.exams || []).map((item) => makeExam(baseNow, item))
    const nextExamItems = [
      ...existingExamItems.filter((exam) => {
        const id = exam && String(exam.id || '')
        return !previousTestPrefixes.some((prefix) => id.startsWith(prefix))
      }),
      ...addedExams,
    ]
    const nextExamData = {
      ...(baseExamCache && baseExamCache.data ? baseExamCache.data : {}),
      accountId,
      schoolId,
      providerId,
      target: 'exam',
      termId,
      data: {
        ...baseExamData,
        items: nextExamItems,
        upcoming: nextExamItems.filter((exam) => exam.status !== 'finished'),
        finished: nextExamItems.filter((exam) => exam.status === 'finished'),
      },
      meta: (baseExamCache && baseExamCache.data && baseExamCache.data.meta) || {},
      sourceHash,
      syncedAt: now,
      session: baseTimetableCache.data.session || (baseExamCache && baseExamCache.data && baseExamCache.data.session) || {
        sessionReusable: false,
        sessionRefreshable: false,
        accountStatus: 'cached_only',
      },
    }
    const nextExamCache = {
      data: nextExamData,
      sourceHash,
      syncedAt: now,
      cachedAt: now,
    }

    wx.setStorageSync(timetableLatestKey, nextTimetableCache)
    wx.setStorageSync(timetableTermKey, nextTimetableCache)
    wx.setStorageSync(examLatestKey, nextExamCache)
    wx.setStorageSync(examTermKey, nextExamCache)

    console.log(`Home card scenario written: ${scenario.id} - ${scenario.name}`, {
      baseNow: baseNow.toString(),
      sourceHash,
      courses: addedCourses.map((course) => ({
        id: course.id,
        name: course.name,
        time: `${course.startTime}-${course.endTime}`,
        room: course.classroom,
      })),
      exams: addedExams.map((exam) => ({
        id: exam.id,
        name: exam.courseName,
        time: exam.time,
        status: exam.status,
        location: exam.location,
      })),
    })

    if (typeof wx.reLaunch === 'function') {
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 50)
    }
  }

  console.log('Home card style scenario writer installed. Now paste one scenario snippet.')
})()

// ====================
// Snippet 1: collapsed overlap stack
// Covers ended/current/next/pending, exam main card, overlap stack, and fold hint.
// ====================
__CSCHEDULE_WRITE_HOME_CARD_SCENARIO__({
  id: 'overlap-stack',
  name: 'collapsed overlap stack',
  courses: [
    { id: 'local-fixed-course-ended', name: 'Finished Course Card', room: 'A-Past', start: -75, end: -15 },
    { id: 'local-fixed-course-current', name: 'Current Course With Long Title For Layout', room: 'B-Current Room', start: -20, end: 40 },
    { id: 'local-fixed-course-next', name: 'Next Course Overlapping Exam', room: 'Lab-Next', start: 15, end: 75 },
    { id: 'local-fixed-course-pending', name: 'Pending Course Later In The Day', room: 'C-Pending', start: 90, end: 150 },
  ],
  exams: [
    { id: 'local-fixed-exam-ended', name: 'Finished Exam Card', location: 'Exam Past Hall', start: -80, end: -20, status: 'finished', seatNo: 'A01' },
    { id: 'local-fixed-exam-current', name: 'Current Exam Overlay Card', location: 'Exam Current Hall', start: -10, end: 50, status: 'upcoming', seatNo: 'B12' },
    { id: 'local-fixed-exam-next', name: 'Next Exam Long Title For Card Layout', location: 'Exam Next Hall With Long Location', start: 15, end: 75, status: 'upcoming', seatNo: 'C08' },
    { id: 'local-fixed-exam-pending', name: 'Pending Exam Later In The Day', location: 'Exam Pending Hall', start: 90, end: 150, status: 'upcoming', seatNo: 'D20' },
  ],
})

// ====================
// Snippet 2: current course card
// Covers a standalone course current card.
// ====================
__CSCHEDULE_WRITE_HOME_CARD_SCENARIO__({
  id: 'current-course',
  name: 'current course card',
  courses: [
    { id: 'local-fixed-course-ended', name: 'Finished Course Card', room: 'A-Past', start: -75, end: -15 },
    { id: 'local-fixed-course-current', name: 'Current Course Standalone Long Title', room: 'B-Current Standalone Room', start: -20, end: 40 },
  ],
  exams: [
    { id: 'local-fixed-exam-ended', name: 'Finished Exam Card', location: 'Exam Past Hall', start: -80, end: -20, status: 'finished', seatNo: 'A01' },
  ],
})

// ====================
// Snippet 3: current exam card
// Covers a standalone exam current card.
// ====================
__CSCHEDULE_WRITE_HOME_CARD_SCENARIO__({
  id: 'current-exam',
  name: 'current exam card',
  courses: [
    { id: 'local-fixed-course-ended', name: 'Finished Course Card', room: 'A-Past', start: -75, end: -15 },
  ],
  exams: [
    { id: 'local-fixed-exam-ended', name: 'Finished Exam Card', location: 'Exam Past Hall', start: -80, end: -20, status: 'finished', seatNo: 'A01' },
    { id: 'local-fixed-exam-current', name: 'Current Exam Standalone Long Title', location: 'Exam Current Standalone Hall', start: -20, end: 40, status: 'upcoming', seatNo: 'B12' },
  ],
})

// ====================
// Snippet 4: next and pending
// Covers next and pending. Course/exam with the same earliest future start both remain next.
// ====================
__CSCHEDULE_WRITE_HOME_CARD_SCENARIO__({
  id: 'next-pending',
  name: 'next and pending cards',
  courses: [
    { id: 'local-fixed-course-ended', name: 'Finished Course Card', room: 'A-Past', start: -75, end: -15 },
    { id: 'local-fixed-course-next', name: 'Next Course Same Start As Exam', room: 'B-Next', start: 15, end: 75 },
    { id: 'local-fixed-course-pending', name: 'Pending Course Long Title For Fold Hint', room: 'C-Pending Long Room', start: 90, end: 150 },
  ],
  exams: [
    { id: 'local-fixed-exam-ended', name: 'Finished Exam Card', location: 'Exam Past Hall', start: -80, end: -20, status: 'finished', seatNo: 'A01' },
    { id: 'local-fixed-exam-next', name: 'Next Exam Same Start As Course', location: 'Exam Next Hall', start: 15, end: 75, status: 'upcoming', seatNo: 'B12' },
    { id: 'local-fixed-exam-pending', name: 'Pending Exam Long Title For Badge Layout', location: 'Exam Pending Hall', start: 90, end: 150, status: 'upcoming', seatNo: 'C08' },
  ],
})

// ====================
// Snippet 5: complete day
// Covers today-complete-card. Keeps only one ended course and one ended exam.
// ====================
__CSCHEDULE_WRITE_HOME_CARD_SCENARIO__({
  id: 'complete',
  name: 'complete day card',
  courses: [
    { id: 'local-fixed-course-ended', name: 'Finished Course Only', room: 'A-Complete', start: -75, end: -15 },
  ],
  exams: [
    { id: 'local-fixed-exam-ended', name: 'Finished Exam Only', location: 'Exam Complete Hall', start: -80, end: -20, status: 'finished', seatNo: 'A01' },
  ],
})