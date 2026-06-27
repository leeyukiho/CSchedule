(() => {
  const accountId = 'cmqrvh3ae0001v49ozz2hwyq4'
  const schoolId = 'moe_4142011798'
  const providerId = 'wdu'
  const termId = '2025-12'
  const timetableLatestKey = `cschedule.dataCache.${accountId}.timetable.latest`
  const timetableTermKey = `cschedule.dataCache.${accountId}.timetable.${termId}`
  const examLatestKey = `cschedule.dataCache.${accountId}.exam.latest`
  const examTermKey = `cschedule.dataCache.${accountId}.exam.${termId}`
  const now = new Date().toISOString()
  const sourceHash = 'local-fixed-20260628-0100-1000'
  const weeks = Array.from({ length: 60 }, (_, index) => index + 1)

  const testDate = '2026-06-28'
  const testWeekday = 7

  const makeCourse = ({ id, name, weekday, sections, room, startTime, endTime }) => ({
    id,
    name,
    weeks,
    campus: 'Main',
    teacher: 'Test Teacher',
    weekday,
    location: room,
    rawWeeks: '1-60 weeks',
    sections,
    classroom: room,
    startSection: sections[0],
    endSection: sections[sections.length - 1],
    startTime,
    endTime,
  })

  const makeExam = ({ id, courseName, date, startAt, endAt, location, seatNo, status, remark }) => ({
    id,
    courseName,
    examType: 'Test Exam',
    date,
    time: `${startAt.slice(11, 16)}-${endAt.slice(11, 16)}`,
    startAt,
    endAt,
    location,
    seatNo,
    status,
    remark,
  })

  const baseTimetableCache = wx.getStorageSync(timetableLatestKey) || wx.getStorageSync(timetableTermKey)

  if (!baseTimetableCache || !baseTimetableCache.data || !Array.isArray(baseTimetableCache.data.courses)) {
    console.error('Timetable cache not found. Open/import timetable once, then run this script.', {
      timetableLatestKey,
      timetableTermKey,
      baseTimetableCache,
    })
    return
  }

  const addedCourses = [
    makeCourse({
      id: 'local-fixed-night-ended-1-2',
      name: '楂樻暟A1锛堝鑸増锛?01 Alpha-尾',
      weekday: testWeekday,
      sections: [1, 2],
      room: '3-101',
      startTime: '01:00',
      endTime: '02:00',
    }),
    makeCourse({
      id: 'local-fixed-night-ended-3-4',
      name: '鏁版嵁缁撴瀯銆愭爤/闃熷垪銆慍++ 2.0',
      weekday: testWeekday,
      sections: [3, 4],
      room: '3-203',
      startTime: '02:00',
      endTime: '02:45',
    }),
    makeCourse({
      id: 'local-fixed-night-current-5-6',
      name: 'AI瀵艰路LLM(瀹為獙) @Room-508',
      weekday: testWeekday,
      sections: [5, 6],
      room: 'B-508',
      startTime: '02:45',
      endTime: '03:30',
    }),
    makeCourse({
      id: 'local-fixed-night-short-7-8',
      name: '鐗╃悊瀹為獙鈪細鍏夌數#D-408',
      weekday: testWeekday,
      sections: [7, 8],
      room: 'D-408',
      startTime: '03:30',
      endTime: '04:15',
    }),
    makeCourse({
      id: 'local-fixed-night-next-9-10',
      name: '璺ㄧ寮€鍙?Taro+React) 2026-final_瓒呴暱鍚嶇О',
      weekday: testWeekday,
      sections: [9, 10],
      room: '2-506',
      startTime: '04:15',
      endTime: '05:00',
    }),
    makeCourse({
      id: 'local-fixed-night-pending-11-12',
      name: '鑻辫鍚B2锛堝彛璇曪級No.12',
      weekday: testWeekday,
      sections: [11, 12],
      room: '1-609',
      startTime: '05:00',
      endTime: '05:30',
    }),
    makeCourse({
      id: 'local-fixed-morning-1-2',
      name: '绂绘暎鏁板{鍥捐} AM-00',
      weekday: testWeekday,
      sections: [1, 2],
      room: 'M-101',
      startTime: '05:30',
      endTime: '06:15',
    }),
    makeCourse({
      id: 'local-fixed-morning-3-4',
      name: '鏁版嵁搴撳師鐞?SQL/NoSQL) v3',
      weekday: testWeekday,
      sections: [3, 4],
      room: 'M-203',
      startTime: '06:15',
      endTime: '07:00',
    }),
    makeCourse({
      id: 'local-fixed-morning-5-6',
      name: '鎿嶄綔绯荤粺[杩涚▼&绾跨▼] Lab-5',
      weekday: testWeekday,
      sections: [5, 6],
      room: 'M-305',
      startTime: '07:00',
      endTime: '07:45',
    }),
    makeCourse({
      id: 'local-fixed-morning-7-8',
      name: '缃戠粶瀹夊叏鏀婚槻锛圕TF锛塒wn#404',
      weekday: testWeekday,
      sections: [7, 8],
      room: 'M-407',
      startTime: '07:45',
      endTime: '08:30',
    }),
    makeCourse({
      id: 'local-fixed-morning-9-10',
      name: '杞欢宸ョ▼鈪★細UML+CI/CD 06:00',
      weekday: testWeekday,
      sections: [9, 10],
      room: 'M-509',
      startTime: '08:30',
      endTime: '10:00',
    }),
  ]

  const previousTestCoursePrefixes = ['local-friday-', 'local-saturday-', 'local-today-', 'local-fixed-']
  const addedCourseIds = new Set(addedCourses.map((course) => course.id))
  const nextCourses = [
    ...baseTimetableCache.data.courses.filter((course) => {
      const id = course && String(course.id || '')
      return !addedCourseIds.has(id) && !previousTestCoursePrefixes.some((prefix) => id.startsWith(prefix))
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

  const addedExams = [
    makeExam({
      id: 'local-fixed-exam-ended-a',
      courseName: '楂樻暟A1锛堝鑰冿級Exam#01',
      date: testDate,
      startAt: `${testDate}T01:00:00+08:00`,
      endAt: `${testDate}T02:00:00+08:00`,
      location: '3-101',
      seatNo: 'A01',
      status: 'finished',
      remark: 'Ended in the fixed test window.',
    }),
    makeExam({
      id: 'local-fixed-exam-ended-b',
      courseName: '鏁版嵁缁撴瀯銆愰棴鍗枫€慍++/Java-2',
      date: testDate,
      startAt: `${testDate}T02:00:00+08:00`,
      endAt: `${testDate}T02:45:00+08:00`,
      location: '3-203',
      seatNo: 'B12',
      status: 'finished',
      remark: 'Second ended exam for folded-state testing.',
    }),
    makeExam({
      id: 'local-fixed-exam-current-cross-midnight',
      courseName: 'AI瀵艰路璺ㄥ崍澶?LLM) Mid-Test',
      date: testDate,
      startAt: `${testDate}T02:45:00+08:00`,
      endAt: `${testDate}T03:30:00+08:00`,
      location: 'B-508',
      seatNo: 'C08',
      status: 'upcoming',
      remark: 'Current around 2026-06-28 03:10 without overlapping other exams.',
    }),
    makeExam({
      id: 'local-fixed-exam-next-cross-midnight',
      courseName: '璺ㄧ寮€鍙?Taro+React) 缁堟祴#2026_瓒呴暱鏍囬',
      date: testDate,
      startAt: `${testDate}T03:30:00+08:00`,
      endAt: `${testDate}T04:30:00+08:00`,
      location: '2-506',
      seatNo: 'D20',
      status: 'upcoming',
      remark: 'Next exam in the 2026-06-28 01:00-10:00 window.',
    }),
    makeExam({
      id: 'local-fixed-exam-morning-a',
      courseName: '鏁版嵁搴撳師鐞?SQL) 鍑屾櫒鍦?5',
      date: testDate,
      startAt: `${testDate}T04:30:00+08:00`,
      endAt: `${testDate}T06:00:00+08:00`,
      location: 'M-101',
      seatNo: 'E01',
      status: 'upcoming',
      remark: 'Visible in the 2026-06-28 01:00-10:00 window.',
    }),
    makeExam({
      id: 'local-fixed-exam-morning-b',
      courseName: '杞欢宸ョ▼鈪★紙UML+CI/CD锛?6缁堝満',
      date: testDate,
      startAt: `${testDate}T09:00:00+08:00`,
      endAt: `${testDate}T10:00:00+08:00`,
      location: 'M-509',
      seatNo: 'F06',
      status: 'upcoming',
      remark: 'End of the 01:00-10:00 fixed test window.',
    }),
  ]

  const previousTestExamPrefixes = ['local-friday-', 'local-saturday-', 'local-today-', 'local-fixed-']
  const addedExamIds = new Set(addedExams.map((exam) => exam.id))
  const nextExamItems = [
    ...existingExamItems.filter((exam) => {
      const id = exam && String(exam.id || '')
      return !addedExamIds.has(id) && !previousTestExamPrefixes.some((prefix) => id.startsWith(prefix))
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

  console.log('Fixed 2026-06-28 01:00 to 10:00 cache written.', {
    timetableLatestKey,
    timetableTermKey,
    examLatestKey,
    examTermKey,
    window: `${testDate} 01:00 - ${testDate} 10:00`,
    courseCount: addedCourses.length,
    examCount: addedExams.length,
    earlyCourses: addedCourses.slice(0, 6).map((course) => ({
      id: course.id,
      name: course.name,
      sections: course.sections,
      time: `${course.startTime}-${course.endTime}`,
      classroom: course.classroom,
    })),
    lateCourses: addedCourses.slice(6).map((course) => ({
      id: course.id,
      name: course.name,
      sections: course.sections,
      time: `${course.startTime}-${course.endTime}`,
      classroom: course.classroom,
    })),
    exams: addedExams.map((exam) => ({
      id: exam.id,
      courseName: exam.courseName,
      date: exam.date,
      time: exam.time,
      status: exam.status,
      startAt: exam.startAt,
      endAt: exam.endAt,
      location: exam.location,
    })),
  })
})()