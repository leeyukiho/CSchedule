const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const zlib = require('node:zlib')

const WHHXIT_CONFIG = {
  baseUrl: 'https://jwgl.whhxit.edu.cn',
  loginPath: '/jwglxt/xtgl/login_slogin.html',
  publicKeyPath: '/jwglxt/xtgl/login_getPublicKey.html',
  homePath: '/jwglxt/xtgl/index_initMenu.html',
  profilePath:
    '/jwglxt/xsxxxggl/xsgrxxwh_cxXsgrxx.html?gnmkdm=N100801&layout=default',
  profileDataPath: '/jwglxt/xsxxxggl/xsgrxxwh_cxCkDgxsxx.html?gnmkdm=N100801',
  schedulePath: '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151',
  gradePath: '/jwglxt/cjcx/cjcx_cxDgXscj.html?doType=query&gnmkdm=N305005',
  examPath: '/jwglxt/kwgl/kscx_cxXsksxx.html?doType=query&gnmkdm=N358105',
}
const TERM_CODES = [
  { semester: 1, xqm: '3' },
  { semester: 2, xqm: '12' },
  { semester: 3, xqm: '16' },
]
const GRADE_HISTORY_YEAR_COUNT = 10

function ok(result) {
  return { ok: true, result }
}

function fail(errorCode, errorMessage, extra) {
  return {
    ok: false,
    errorCode,
    errorMessage,
    ...(extra || {}),
  }
}

function isHttpEvent(event) {
  return Boolean(
    event &&
      typeof event === 'object' &&
      (event.httpMethod || event.headers || event.requestContext),
  )
}

function parseHttpBody(event) {
  if (!event.body) {
    return {}
  }

  const body = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body

  return typeof body === 'string'
    ? JSON.parse(body.replace(/^\uFEFF/, '') || '{}')
    : body
}

function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  }
}

function assertAuthorized(event) {
  if (event.source === 'frontend_first_import') {
    return
  }

  const secret = process.env.CSCHEDULE_WORKER_SECRET

  if (!secret) {
    return
  }

  const received =
    event.workerSecret ||
    event.secret ||
    event.headers?.['x-cschedule-worker-secret'] ||
    event.headers?.['X-CSchedule-Worker-Secret']

  if (received !== secret) {
    throw new Error('WORKER_UNAUTHORIZED')
  }
}

function createCookieJar() {
  const cookies = new Map()

  return {
    header() {
      return [...cookies.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ')
    },
    set(setCookie) {
      for (const item of [setCookie].flat()) {
        if (!item) {
          continue
        }

        const pair = String(item).split(';')[0]
        const index = pair.indexOf('=')

        if (index > 0) {
          cookies.set(pair.slice(0, index), pair.slice(index + 1))
        }
      }
    },
  }
}

function decodeText(buffer, contentType) {
  const charset = (
    String(contentType || '').match(/charset=([^;\s]+)/i) || []
  )[1]
  const label = charset ? charset.trim().toLowerCase() : 'utf-8'

  try {
    return new TextDecoder(label).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

function decodeBody(buffer, encoding, contentType) {
  const contentEncoding = String(encoding || '').toLowerCase()
  let body = buffer

  if (contentEncoding.includes('gzip')) {
    body = zlib.gunzipSync(buffer)
  } else if (contentEncoding.includes('deflate')) {
    body = zlib.inflateSync(buffer)
  } else if (contentEncoding.includes('br') && zlib.brotliDecompressSync) {
    body = zlib.brotliDecompressSync(buffer)
  }

  return decodeText(body, contentType)
}

function createHttpClient(baseUrl) {
  const jar = createCookieJar()
  const httpsAgent = new https.Agent({ rejectUnauthorized: false })

  async function request(method, path, body, options = {}) {
    const url = new URL(path || '/', baseUrl)
    const isHttps = url.protocol === 'https:'
    const headers = {
      'User-Agent': 'Mozilla/5.0 MiniProgram Schedule Fetcher',
      Accept: 'application/json,text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'identity',
      ...(options.headers || {}),
    }
    const cookie = jar.header()

    if (cookie) {
      headers.Cookie = cookie
    }

    const payload = body ? Buffer.from(String(body)) : undefined

    if (payload) {
      headers['Content-Length'] = payload.length
    }

    const response = await new Promise((resolve, reject) => {
      const transport = isHttps ? https : http
      const req = transport.request(
        url,
        {
          method,
          headers,
          timeout: options.timeout || 15000,
          agent: isHttps ? httpsAgent : undefined,
        },
        (res) => {
          const chunks = []

          jar.set(res.headers['set-cookie'])
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              data: decodeBody(
                Buffer.concat(chunks),
                res.headers['content-encoding'],
                res.headers['content-type'],
              ),
            })
          })
        },
      )

      req.on('timeout', () => req.destroy(new Error('REQUEST_TIMEOUT')))
      req.on('error', reject)

      if (payload) {
        req.write(payload)
      }

      req.end()
    })

    const location = response.headers.location

    if (
      options.followRedirects !== false &&
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      location
    ) {
      const redirectUrl = new URL(location, baseUrl)

      if (redirectUrl.origin !== new URL(baseUrl).origin) {
        throw new Error('REDIRECT_ORIGIN_BLOCKED')
      }

      return request('GET', `${redirectUrl.pathname}${redirectUrl.search}`, undefined, {
        ...options,
        headers: options.headers,
      })
    }

    return response
  }

  return {
    get(path, options) {
      return request('GET', path, undefined, options)
    },
    post(path, body, options) {
      return request('POST', path, body, options)
    },
  }
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ''))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
}

function stripTags(value) {
  return cleanText(
    String(value || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
}

function getTextFromHtml(html) {
  return stripTags(html)
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim()
    }
  }

  return ''
}

function maskStudentId(studentId) {
  const value = String(studentId || '').trim()

  if (value.length <= 6) {
    return value ? `masked:${value}` : ''
  }

  return `${value.slice(0, 2)}****${value.slice(-2)}`
}

function isLoginPage(html) {
  const source = String(html || '')

  return (
    source.includes('login_slogin') ||
    source.includes('id="yhm"') ||
    source.includes('name="mm"')
  )
}

function hasInvalidCredentialMessage(html) {
  const text = getTextFromHtml(html)

  return [
    '密码错误',
    '用户名或密码',
    '账号或密码',
    '登录失败',
    '用户不存在',
    '验证码',
  ].some((keyword) => text.includes(keyword))
}

function getHiddenInput(html, nameOrId) {
  const pattern = new RegExp(
    `<input\\b(?=[^>]*(?:name|id)=["']${nameOrId}["'])[^>]*>`,
    'i',
  )
  const input = (String(html || '').match(pattern) || [])[0] || ''

  return (
    (input.match(/\bvalue=["']([^"']*)["']/i) || [])[1] ||
    (input.match(/\bvalue=([^\s>]+)/i) || [])[1] ||
    ''
  )
}

function toBase64Url(base64) {
  return Buffer.from(String(base64 || ''), 'base64').toString('base64url')
}

function encryptPassword(publicKey, password) {
  const key = {
    kty: 'RSA',
    n: toBase64Url(publicKey.modulus),
    e: toBase64Url(publicKey.exponent),
  }

  return crypto
    .publicEncrypt(
      {
        key,
        format: 'jwk',
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      Buffer.from(String(password || ''), 'utf8'),
    )
    .toString('base64')
}

async function loginToWhhxit(client, config, username, password) {
  const loginPage = await client.get(config.loginPath)
  const loginHtml = String(loginPage.data || '')
  const csrfToken = getHiddenInput(loginHtml, 'csrftoken')
  const publicKey = JSON.parse(
    String(
      (
        await client.get(`${config.publicKeyPath}?time=${Date.now()}`, {
          headers: {
            Referer: `${config.baseUrl}${config.loginPath}`,
          },
        })
      ).data || '{}',
    ),
  )

  if (!publicKey.modulus || !publicKey.exponent) {
    throw new Error('WHHXIT_LOGIN_PUBLIC_KEY_MISSING')
  }

  const loginPayload = new URLSearchParams({
    ...(csrfToken ? { csrftoken: csrfToken } : {}),
    language: 'zh_CN',
    yhm: String(username || '').trim(),
    mm: encryptPassword(publicKey, password),
  })
  const loginResponse = await client.post(
    `${config.loginPath}?time=${Date.now()}`,
    loginPayload.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: config.baseUrl,
        Referer: `${config.baseUrl}${config.loginPath}`,
      },
    },
  )
  const loginBody = String(loginResponse.data || '')

  if (hasInvalidCredentialMessage(loginBody)) {
    throw new Error('WHHXIT_INVALID_CREDENTIALS')
  }

  if (isLoginPage(loginBody)) {
    throw new Error('WHHXIT_SESSION_INVALID')
  }

  return loginBody
}

function parseJsonResponse(response, errorCode) {
  try {
    return JSON.parse(String(response.data || '{}'))
  } catch {
    throw new Error(errorCode)
  }
}

function parseSectionNumbers(value) {
  const text = String(value || '')
  const match = text.match(/(\d{1,2})(?:\s*[-~]\s*(\d{1,2}))?/)

  if (!match) {
    return []
  }

  const start = Number(match[1])
  const end = Number(match[2] || match[1])

  return Array.from({ length: Math.max(end - start + 1, 1) }, (_, index) => start + index)
}

function parseWeeks(value) {
  const text = String(value || '')
  const weeks = new Set()

  for (const part of text.split(/[,\uFF0C]/)) {
    const match = part.match(/(\d{1,2})(?:\s*[-~]\s*(\d{1,2}))?/)

    if (!match) {
      continue
    }

    const start = Number(match[1])
    const end = Number(match[2] || match[1])

    for (let week = start; week <= end; week += 1) {
      weeks.add(week)
    }
  }

  return [...weeks].sort((left, right) => left - right)
}

function normalizeCourse(item, index, term) {
  const sections = parseSectionNumbers(firstValue(item.jcor, item.jcs, item.jc))
  const startSection = sections[0] || 1
  const endSection = sections[sections.length - 1] || startSection

  return {
    id: String(item.jxb_id || item.kch_id || item.kch || `course-${index + 1}`),
    name: firstValue(item.kcmc, item.jxbmc, item.kch),
    teacher: firstValue(item.xm, item.jsxm),
    location: firstValue(item.cdmc, item.lh, item.xqmc),
    classroom: firstValue(item.cdmc, item.lh),
    campus: firstValue(item.xqmc),
    weekday: Number(item.xqj || 0),
    sections: sections.length ? sections : [startSection],
    startSection,
    endSection,
    weeks: parseWeeks(item.zcd || item.oldzc),
    rawWeeks: firstValue(item.zcd),
    termId: term.id,
  }
}

function getChinaDateParts(date = new Date()) {
  const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)

  return {
    year: chinaTime.getUTCFullYear(),
    month: chinaTime.getUTCMonth() + 1,
  }
}

function getCurrentAcademicYear(date = new Date()) {
  const { year, month } = getChinaDateParts(date)

  return month >= 9 ? year : year - 1
}

function getCurrentTermCode(date = new Date()) {
  const { month } = getChinaDateParts(date)

  if (month >= 9) {
    return '3'
  }

  if (month >= 7) {
    return '16'
  }

  if (month >= 2) {
    return '12'
  }

  return '3'
}

function getSemesterByXqm(xqm) {
  return TERM_CODES.find((term) => term.xqm === String(xqm))?.semester || 1
}

function normalizeXqm(value) {
  const text = cleanText(value)

  if (['3', '12', '16'].includes(text)) {
    return text
  }

  if (text === '2' || text.includes('二') || text.includes('第二')) {
    return '12'
  }

  if (text === '3' || text.includes('三') || text.includes('第三')) {
    return '16'
  }

  return '3'
}

function createTerm(xnm, xqm) {
  const startYear = Number(xnm)
  const normalizedXqm = normalizeXqm(xqm)
  const semester = getSemesterByXqm(normalizedXqm)

  return {
    id: `${startYear}-${normalizedXqm}`,
    xnm: String(startYear),
    xqm: String(normalizedXqm),
    semester,
    title: `${startYear}-${startYear + 1} 第${semester}学期`,
  }
}

function createCurrentTerm() {
  return createTerm(getCurrentAcademicYear(), getCurrentTermCode())
}

function createAllGradeTerms() {
  const currentAcademicYear = getCurrentAcademicYear()
  const terms = []

  for (
    let year = currentAcademicYear;
    year > currentAcademicYear - GRADE_HISTORY_YEAR_COUNT;
    year -= 1
  ) {
    for (const term of TERM_CODES) {
      terms.push(createTerm(year, term.xqm))
    }
  }

  return terms
}

function resolveRequestedTerms(semesterId, fallbackTerms) {
  const requested = String(semesterId || '').trim()
  const terms = Array.isArray(fallbackTerms) && fallbackTerms.length
    ? fallbackTerms
    : [createCurrentTerm()]

  if (!requested) {
    return terms
  }

  const compact = requested.replace(/\s+/g, '')
  const academicMatch = compact.match(/(20\d{2})\s*[-~至]\s*(20\d{2}).*?([123一二三])/)
  const codeMatch = compact.match(/^(20\d{2})[-_](3|12|16)$/)
  const yearOnlyMatch = compact.match(/^(20\d{2})$/)

  if (codeMatch) {
    return [createTerm(codeMatch[1], codeMatch[2])]
  }

  if (academicMatch) {
    const semesterMap = {
      '1': '3',
      '一': '3',
      '2': '12',
      '二': '12',
      '3': '16',
      '三': '16',
    }

    return [createTerm(academicMatch[1], semesterMap[academicMatch[3]] || '3')]
  }

  if (yearOnlyMatch) {
    return TERM_CODES.map((term) => createTerm(yearOnlyMatch[1], term.xqm))
  }

  const direct = terms.find((term) => {
    return (
      term.id === requested ||
      `${term.xnm}-${term.xqm}` === requested ||
      term.xqm === requested ||
      term.title.replace(/\s+/g, '') === compact ||
      compact.includes(`${term.semester}学期`)
    )
  })

  return direct ? [direct] : terms
}

function getSelectedTerm(terms, courses) {
  const withCourses = terms.find((term) =>
    courses.some((course) => course.termId === term.id),
  )

  return withCourses || terms[0] || createCurrentTerm()
}

async function fetchSchedule(client, config, semesterId) {
  const terms = resolveRequestedTerms(semesterId, [createCurrentTerm()])
  const courses = []

  for (const term of terms) {
    const payload = new URLSearchParams({
      xnm: term.xnm,
      xqm: term.xqm,
    })
    const response = await client.post(config.schedulePath, payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${config.baseUrl}/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default`,
      },
    })
    const data = parseJsonResponse(response, 'WHHXIT_SCHEDULE_PARSE_FAILED')
    const items = Array.isArray(data.kbList) ? data.kbList : []

    courses.push(...items.map((item, index) => normalizeCourse(item, courses.length + index, term)))

    if (semesterId && items.length > 0) {
      break
    }
  }

  const selectedTerm = getSelectedTerm(terms, courses)

  return {
    termId: selectedTerm.id,
    courses,
    terms: terms.map((term) => ({
      id: term.id,
      title: term.title,
      label: term.title,
      xnm: term.xnm,
      xqm: term.xqm,
      selected: term.id === selectedTerm.id,
    })),
  }
}

function toNumber(value) {
  const number = Number.parseFloat(String(value || '').replace(/[^\d.-]/g, ''))

  return Number.isFinite(number) ? number : 0
}

function formatNumber(value, digits) {
  return Number.isFinite(value) && value > 0 ? value.toFixed(digits) : '--'
}

function buildGradesResult(records) {
  const semesters = new Map()
  let totalCredit = 0
  let weightedScore = 0
  let weightedGpa = 0
  let scoreCredit = 0
  let gpaCredit = 0

  for (const record of records) {
    const termId = record.termId
    const credit = toNumber(record.credit)
    const score = toNumber(record.score)
    const gpa = toNumber(record.gpa)

    if (!semesters.has(termId)) {
      semesters.set(termId, {
        id: termId,
        title: record.termTitle,
        creditValue: 0,
        scoreValue: 0,
        scoreCredit: 0,
        gpaValue: 0,
        gpaCredit: 0,
        grades: [],
      })
    }

    const semester = semesters.get(termId)
    semester.grades.push({
      name: record.name,
      credit: record.credit || '--',
      score: record.score || '--',
      scoreLow: score > 0 && score < 60,
      gpa: record.gpa || '--',
      teacher: record.teacher,
      courseType: record.courseType,
      examType: record.examType,
    })
    semester.creditValue += credit
    totalCredit += credit

    if (credit > 0 && score > 0) {
      semester.scoreValue += score * credit
      semester.scoreCredit += credit
      weightedScore += score * credit
      scoreCredit += credit
    }

    if (credit > 0 && gpa > 0) {
      semester.gpaValue += gpa * credit
      semester.gpaCredit += credit
      weightedGpa += gpa * credit
      gpaCredit += credit
    }
  }

  return {
    summary: [
      { label: '总学分', value: formatNumber(totalCredit, 1) },
      { label: '平均分', value: formatNumber(weightedScore / scoreCredit, 2) },
      { label: '绩点', value: formatNumber(weightedGpa / gpaCredit, 2) },
    ],
    semesters: [...semesters.values()].map((semester, index) => ({
      id: semester.id,
      title: semester.title,
      credit: formatNumber(semester.creditValue, 1),
      average: formatNumber(semester.scoreValue / semester.scoreCredit, 2),
      gpa: formatNumber(semester.gpaValue / semester.gpaCredit, 2),
      expanded: index === 0,
      grades: semester.grades,
    })),
  }
}

function inferTermFromText(value) {
  const text = cleanText(value)
  const compact = text.replace(/\s+/g, '')
  const codeMatch = compact.match(/(20\d{2})[-_](3|12|16)/)

  if (codeMatch) {
    return createTerm(codeMatch[1], codeMatch[2])
  }

  const academicMatch = compact.match(/(20\d{2})[-~—至](20\d{2}).*?([123一二三])/)

  if (academicMatch) {
    const semesterMap = {
      '1': '3',
      '一': '3',
      '2': '12',
      '二': '12',
      '3': '16',
      '三': '16',
    }

    return createTerm(academicMatch[1], semesterMap[academicMatch[3]] || '3')
  }

  return null
}

function mapGradeRecord(item, term) {
  return {
    termId: term.id,
    termTitle: term.title,
    name: firstValue(item.kcmc, item.jxbmc, item.courseName, item.name),
    credit: firstValue(item.xf, item.credit),
    score: firstValue(item.cj, item.bfzcj, item.score),
    gpa: firstValue(item.jd, item.xfjd, item.gpa),
    teacher: firstValue(item.jsxm, item.tjrxm, item.teacher),
    courseType: firstValue(item.kcxzmc, item.kclbmc, item.courseType),
    examType: firstValue(item.ksxz, item.khfsmc, item.examType),
  }
}

function parseGradeJsonFromProfile(html) {
  const records = []
  const source = String(html || '')
  const arrayPattern = /(?:items|rows|cjList|scoreList|gradeList|data)\s*[:=]\s*(\[[\s\S]*?\])/gi

  for (const match of source.matchAll(arrayPattern)) {
    try {
      const items = JSON.parse(match[1])

      if (!Array.isArray(items)) {
        continue
      }

      for (const item of items) {
        if (!item || typeof item !== 'object' || !firstValue(item.kcmc, item.jxbmc, item.courseName, item.name)) {
          continue
        }

        const term =
          inferTermFromText(firstValue(item.xnmmc, item.xqm, item.xn, item.xnm, item.termTitle, item.termId)) ||
          createTerm(firstValue(item.xnm, item.xn) || getCurrentAcademicYear(), firstValue(item.xqm) || getCurrentTermCode())

        records.push(mapGradeRecord(item, term))
      }
    } catch {
      // Ignore unrelated JavaScript arrays on the page.
    }
  }

  return records
}

function parseHtmlTableRows(html) {
  const rows = []
  const source = String(html || '')

  for (const row of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    rows.push(
      [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((cell) => stripTags(cell[1]))
        .filter(Boolean),
    )
  }

  return rows
}

function parseGradeTablesFromProfile(html) {
  const records = []
  const rows = parseHtmlTableRows(html)
  let headers = []
  let currentTerm = null

  for (const cells of rows) {
    const rowText = cells.join(' ')
    const rowTerm = inferTermFromText(rowText)

    if (rowTerm) {
      currentTerm = rowTerm
    }

    if (cells.some((cell) => ['课程名称', '成绩'].includes(cell))) {
      headers = cells
      continue
    }

    if (!headers.length || cells.length < 2) {
      continue
    }

    const row = {}
    headers.forEach((header, index) => {
      row[normalizeLabel(header)] = cells[index] || ''
    })

    const name = getFirstPairValue(row, ['课程名称', '课程', '教学班名称'])
    const score = getFirstPairValue(row, ['成绩', '百分制成绩'])

    if (!name || !score) {
      continue
    }

    const term = inferTermFromText(rowText) || currentTerm || createCurrentTerm()

    records.push({
      termId: term.id,
      termTitle: term.title,
      name,
      credit: getFirstPairValue(row, ['学分']),
      score,
      gpa: getFirstPairValue(row, ['绩点', '学分绩点']),
      teacher: getFirstPairValue(row, ['教师', '任课教师']),
      courseType: getFirstPairValue(row, ['课程性质', '课程类别']),
      examType: getFirstPairValue(row, ['考试性质', '考核方式']),
    })
  }

  return records
}

function parseGradesFromProfile(profileHtml) {
  const records = [
    ...parseGradeJsonFromProfile(profileHtml),
    ...parseGradeTablesFromProfile(profileHtml),
  ]
  const unique = new Map()

  for (const record of records) {
    const key = [
      record.termId,
      record.name,
      record.credit,
      record.score,
      record.gpa,
    ].join('|')

    if (!unique.has(key)) {
      unique.set(key, record)
    }
  }

  return buildGradesResult([...unique.values()])
}

async function fetchGrades(client, config, semesterId, profileParams = {}) {
  const terms = semesterId ? resolveRequestedTerms(semesterId, createAllGradeTerms()) : []
  const records = []

  if (!semesterId) {
    const payload = new URLSearchParams({
      ...(profileParams.xh_id ? { xh_id: profileParams.xh_id } : {}),
      ...(profileParams.xh_id_code ? { xh_id_code: profileParams.xh_id_code } : {}),
      fromXh_id: profileParams.fromXh_id || '',
      xnm: '',
      xqm: '',
      'queryModel.showCount': '500',
      'queryModel.currentPage': '1',
      'queryModel.sortName': '',
      'queryModel.sortOrder': 'asc',
    })
    const response = await client.post(config.gradePath, payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${config.baseUrl}/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default`,
      },
    })
    const data = parseJsonResponse(response, 'WHHXIT_GRADES_PARSE_FAILED')
    const items = Array.isArray(data.items) ? data.items : []

    records.push(
      ...items
        .filter((item) => firstValue(item.kcmc, item.jxbmc))
        .map((item) => {
          const term = createTerm(
            firstValue(item.xnm, String(item.xnmmc || '').match(/20\d{2}/)?.[0]),
            firstValue(item.xqm, inferTermFromText(firstValue(item.xnmmc, item.xqmmc))?.xqm, getCurrentTermCode()),
          )

          return mapGradeRecord(item, term)
        }),
    )

    return buildGradesResult(records)
  }

  for (const term of terms) {
    const payload = new URLSearchParams({
      ...(profileParams.xh_id ? { xh_id: profileParams.xh_id } : {}),
      ...(profileParams.xh_id_code ? { xh_id_code: profileParams.xh_id_code } : {}),
      fromXh_id: profileParams.fromXh_id || '',
      xnm: term.xnm,
      xqm: term.xqm,
      'queryModel.showCount': '100',
      'queryModel.currentPage': '1',
      'queryModel.sortName': '',
      'queryModel.sortOrder': 'asc',
    })
    const response = await client.post(config.gradePath, payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${config.baseUrl}/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default`,
      },
    })
    const data = parseJsonResponse(response, 'WHHXIT_GRADES_PARSE_FAILED')
    const items = Array.isArray(data.items) ? data.items : []

    records.push(
      ...items
        .filter((item) => firstValue(item.kcmc, item.jxbmc))
        .map((item) => mapGradeRecord(item, term)),
    )
  }

  return buildGradesResult(records)
}

function parseExamTime(value) {
  const text = cleanText(value)
  const match = text.match(/(\d{1,2})\s*:\s*(\d{2})\s*[-~]\s*(\d{1,2})\s*:\s*(\d{2})/)

  if (!match) {
    return { time: text, startHour: '', startMinute: '', endHour: '', endMinute: '' }
  }

  return {
    time: `${match[1].padStart(2, '0')}:${match[2]}~${match[3].padStart(2, '0')}:${match[4]}`,
    startHour: match[1].padStart(2, '0'),
    startMinute: match[2],
    endHour: match[3].padStart(2, '0'),
    endMinute: match[4],
  }
}

function toChinaIso(date, hour, minute) {
  return date && hour && minute ? `${date}T${hour}:${minute}:00+08:00` : ''
}

function parseChinaTimestamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+08:00$/)

  if (!match) {
    return 0
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]) - 8,
    Number(match[5]),
    Number(match[6]),
  )
}

async function fetchExams(client, config, semesterId) {
  const terms = resolveRequestedTerms(semesterId, [createCurrentTerm()])
  const records = []
  const nowTime = Date.now()

  for (const term of terms) {
    const payload = new URLSearchParams({
      xnm: term.xnm,
      xqm: term.xqm,
      'queryModel.showCount': '100',
      'queryModel.currentPage': '1',
      'queryModel.sortName': '',
      'queryModel.sortOrder': 'asc',
    })
    const response = await client.post(config.examPath, payload.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${config.baseUrl}/jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default`,
      },
    })
    const data = parseJsonResponse(response, 'WHHXIT_EXAMS_PARSE_FAILED')
    const items = Array.isArray(data.items) ? data.items : []

    records.push(
      ...items.map((item, index) => {
        const date = firstValue(item.kssj, item.ksrq, item.rq).match(/20\d{2}-\d{2}-\d{2}/)?.[0] || ''
        const timeRange = parseExamTime(firstValue(item.kssj, item.kssjms, item.sj))
        const startAt = toChinaIso(date, timeRange.startHour, timeRange.startMinute)
        const endAt = toChinaIso(date, timeRange.endHour, timeRange.endMinute)
        const finished = endAt && parseChinaTimestamp(endAt) < nowTime

        return {
          id: String(item.kch || item.kcmc || `exam-${index + 1}`),
          courseCode: firstValue(item.kch, item.kch_id),
          courseName: firstValue(item.kcmc, item.jxbmc),
          examType: firstValue(item.ksxz, item.kslx, item.khfsmc),
          date,
          time: timeRange.time,
          startAt,
          endAt,
          location: firstValue(item.cdmc, item.jsmc, item.ksdd),
          seatNo: firstValue(item.zwh, item.zwhm, item.xh),
          status: !date || !timeRange.startHour ? 'unscheduled' : finished ? 'finished' : 'upcoming',
          rawStatus: firstValue(item.kszt, item.ksfsmc),
          remark: firstValue(item.bz),
          termId: term.id,
          termTitle: term.title,
        }
      }),
    )
  }

  return {
    term: terms[0] || createCurrentTerm(),
    upcoming: records
      .filter((record) => record.status !== 'finished')
      .sort((left, right) => (parseChinaTimestamp(left.startAt) || Number.MAX_SAFE_INTEGER) - (parseChinaTimestamp(right.startAt) || Number.MAX_SAFE_INTEGER)),
    finished: records
      .filter((record) => record.status === 'finished')
      .sort((left, right) => (parseChinaTimestamp(right.startAt) || 0) - (parseChinaTimestamp(left.startAt) || 0)),
  }
}

function normalizeLabel(value) {
  return cleanText(value).replace(/[：:]/g, '').replace(/\s+/g, '')
}

function parseKeyValuePairs(html) {
  const pairs = {}
  const source = String(html || '')

  function addPair(label, value) {
    const key = normalizeLabel(label)
    const text = cleanText(value)

    if (key && text && key.length <= 32) {
      pairs[key] = text
    }
  }

  for (const row of source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean)

    for (let index = 0; index < cells.length - 1; index += 2) {
      addPair(cells[index], cells[index + 1])
    }
  }

  for (const label of source.matchAll(/<label\b[^>]*\bfor=["']([^"']+)["'][^>]*>([\s\S]*?)<\/label>/gi)) {
    const fieldId = label[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const fieldPattern = new RegExp(
      `<(?:input|select|textarea)\\b(?=[^>]*\\bid=["']${fieldId}["'])[^>]*>(?:([\\s\\S]*?)<\\/(?:select|textarea)>)?`,
      'i',
    )
    const field = source.match(fieldPattern)?.[0] || ''
    const value =
      getInputValue(field) ||
      getSelectedOptionText(field) ||
      stripTags((field.match(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/i) || [])[1] || '')

    if (value) {
      addPair(stripTags(label[2]), value)
    }
  }

  for (const group of source.matchAll(/<div\b[^>]*class=["'][^"']*(?:form-group|col-sm-\d+)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const label = (group[1].match(/<label\b[^>]*>([\s\S]*?)<\/label>/i) || [])[1]
    const input =
      getInputValue(group[1]) ||
      getSelectedOptionText(group[1])

    if (label && input) {
      addPair(stripTags(label), stripTags(input))
    }
  }

  return pairs
}

function getInputValue(html) {
  const input = String(html || '').match(/<(?:input|select|textarea)\b[^>]*>/i)?.[0] || ''

  return decodeHtmlEntities(
    (input.match(/\bvalue=["']([^"']*)["']/i) || [])[1] ||
      (input.match(/\bvalue=([^\s>]+)/i) || [])[1] ||
      '',
  )
}

function getSelectedOptionText(html) {
  return stripTags(
    (String(html || '').match(/<option\b[^>]*selected[^>]*>([\s\S]*?)<\/option>/i) || [])[1] ||
      '',
  )
}

function getPairValue(pairs, labels) {
  const entries = Object.entries(pairs)

  for (const label of labels) {
    const normalized = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalized)

    if (exact?.[1]) {
      return exact[1]
    }
  }

  for (const label of labels) {
    const normalized = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)
      return normalizedKey.includes(normalized) || normalized.includes(normalizedKey)
    })

    if (fuzzy?.[1]) {
      return fuzzy[1]
    }
  }

  return ''
}

function getFirstPairValue(pairs, labels) {
  return firstValue(...labels.map((label) => getPairValue(pairs, [label])))
}

function normalizeProfileValue(value) {
  const text = cleanText(value)

  return text === '--' || text === '无' || text === '暂无' ? '' : text
}

function getHiddenInputs(html) {
  return Object.fromEntries(
    [...String(html || '').matchAll(/<input[^>]+id=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi)]
      .map((match) => [match[1], decodeHtmlEntities(match[2])]),
  )
}

function normalizeWhhxitMajor(value) {
  const text = cleanText(value)

  if (!text) {
    return ''
  }

  return /\(\d+\)$/.test(text) ? text : `${text}(0277)`
}

function parseProfileData(profileData, homeHtml, fallbackStudentId) {
  const record = profileData && typeof profileData === 'object' && !Array.isArray(profileData)
    ? profileData
    : {}
  const homeText = getTextFromHtml(homeHtml)
  const accountMatch = homeText.match(/([\u4e00-\u9fa5A-Za-z·]{2,30})\((\d{6,})\)\s+([^\s]+)/)
  const studentId = firstValue(record.xh, record.xh_id, accountMatch?.[2], fallbackStudentId)

  return {
    name: firstValue(record.xm, accountMatch?.[1]),
    studentId,
    role: firstValue(accountMatch?.[3], '学生'),
    maskedStudentId: maskStudentId(studentId),
    major: normalizeWhhxitMajor(firstValue(record.zymc, record.zyh_id, record.zyfxmc)),
    grade: firstValue(record.njdm_id, record.njmc),
    level: firstValue(record.pyccdm, record.pyccmc, record.ccmc),
    className: firstValue(record.bjmc, record.bh_id, record.xzb),
    gender: firstValue(record.xb, record.xbm),
    birthDate: firstValue(record.csrq, record.csny),
    politicalStatus: firstValue(record.zzmmm, record.zzmm),
    phone: normalizeProfileValue(firstValue(record.lxdh, record.sjhm, record.mobile, record.phone)),
    email: normalizeProfileValue(firstValue(record.dzyx, record.email, record.yx)),
    nativePlace: firstValue(record.jg, record.jg_id, record.syd),
    enrollmentDate: firstValue(record.rxrq, record.rxny),
    studentStatus: firstValue(record.xjzt, record.xjztmc, record.xszt),
    dormitory: firstValue(record.ssh, record.ssmc, record.sushe),
    counselor: firstValue(record.fdy, record.bzr),
    updatedAt: new Date().toISOString(),
  }
}

function parseProfile(profileHtml, homeHtml, fallbackStudentId) {
  const pairs = parseKeyValuePairs(profileHtml)
  const homeText = getTextFromHtml(homeHtml)
  const accountMatch = homeText.match(/([\u4e00-\u9fa5A-Za-z·]{2,30})\(([^)]+)\)\s+([^\s]+)/)
  const studentId = firstValue(
    getFirstPairValue(pairs, ['学号', '学生学号', 'xh', 'XH']),
    accountMatch?.[2],
    fallbackStudentId,
  )

  return {
    name: firstValue(getFirstPairValue(pairs, ['姓名', '学生姓名', 'xm', 'XM']), accountMatch?.[1]),
    studentId,
    role: firstValue(accountMatch?.[3], '学生'),
    maskedStudentId: maskStudentId(studentId),
    major: getFirstPairValue(pairs, ['专业名称', '专业', '专业方向', 'zymc']),
    grade: getFirstPairValue(pairs, ['年级', '所在年级', 'nj']),
    level: getFirstPairValue(pairs, ['培养层次', '层次', 'pycc']),
    className: getFirstPairValue(pairs, ['班级名称', '班级', '行政班', 'bjmc', 'xzb']),
    gender: getFirstPairValue(pairs, ['性别', 'xb']),
    birthDate: getFirstPairValue(pairs, ['出生日期', '出生年月']),
    politicalStatus: getFirstPairValue(pairs, ['政治面貌']),
    phone: normalizeProfileValue(getFirstPairValue(pairs, ['联系方式', '手机号', '手机号码', '联系电话', '电话', '移动电话', 'lxdh'])),
    email: normalizeProfileValue(getFirstPairValue(pairs, ['电子邮箱', '邮箱', 'email'])),
    nativePlace: getFirstPairValue(pairs, ['籍贯', '生源地']),
    enrollmentDate: getFirstPairValue(pairs, ['入学日期', '入学时间']),
    studentStatus: getFirstPairValue(pairs, ['学籍状态', '学生状态']),
    dormitory: getFirstPairValue(pairs, ['宿舍信息', '宿舍']),
    counselor: getFirstPairValue(pairs, ['辅导员']),
    updatedAt: new Date().toISOString(),
  }
}

async function fetchProfile(client, config, homeHtml, username) {
  const context = { client, config, homeHtml, profileHtml: '', profileData: null }

  return parseProfileData(await getProfileData(context), homeHtml, username)
}

async function fetchProfileHtml(client, config) {
  const response = await client.get(config.profilePath, {
    headers: {
      Referer: `${config.baseUrl}${config.homePath}`,
    },
  })
  const html = String(response.data || '')

  if (isLoginPage(html)) {
    throw new Error('WHHXIT_SESSION_INVALID')
  }

  return html
}

async function getProfileHtml(context) {
  if (!context.profileHtml) {
    context.profileHtml = await fetchProfileHtml(context.client, context.config)
  }

  return context.profileHtml
}

function getProfileRequestParams(profileHtml, fallbackStudentId) {
  const hidden = getHiddenInputs(profileHtml)

  return {
    xh_id: hidden.curXh_id || hidden.xh_id || fallbackStudentId || '',
    xh_id_code: hidden.curXh_id_code || '',
    fromXh_id: '',
    xnm: hidden.xnm || String(getCurrentAcademicYear()),
    xqm: hidden.xqm || getCurrentTermCode(),
  }
}

async function getProfileData(context) {
  if (context.profileData) {
    return context.profileData
  }

  const profileHtml = await getProfileHtml(context)
  const params = getProfileRequestParams(profileHtml, context.event?.username)
  const payload = new URLSearchParams(params)
  const response = await context.client.post(
    context.config.profileDataPath,
    payload.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `${context.config.baseUrl}${context.config.profilePath}`,
      },
    },
  )

  context.profileParams = params
  context.profileData = parseJsonResponse(response, 'WHHXIT_PROFILE_PARSE_FAILED')

  return context.profileData
}

function createSourceHash(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')
}

function createFeatureCacheResult(event, target, data, syncedAt, options = {}) {
  const sourceHash = createSourceHash({
    providerId: event.providerId,
    target,
    termId: options.termId,
    data,
  })

  return {
    target,
    termId: options.termId,
    cacheData: {
      data,
      meta: {
        source: 'cloud_worker',
        school: 'whhxit',
        ...(options.meta || {}),
      },
    },
    parsedCount: options.parsedCount,
    sourceHash,
    syncedAt,
  }
}

function normalizeTargets(event) {
  const source = Array.isArray(event.targets)
    ? event.targets
    : event.target
      ? [event.target]
      : []

  return [...new Set(
    source
      .map((item) => String(item || '').trim())
      .filter((item) => ['course', 'profile', 'score', 'exam'].includes(item)),
  )]
}

function countScoreItems(score) {
  return (score.semesters || []).reduce((count, semester) => {
    return count + (Array.isArray(semester.grades) ? semester.grades.length : 0)
  }, 0)
}

function countExamItems(exam) {
  return (
    (Array.isArray(exam.upcoming) ? exam.upcoming.length : 0) +
    (Array.isArray(exam.finished) ? exam.finished.length : 0)
  )
}

async function fetchTargetCacheResult(target, event, context, syncedAt) {
  const { client, config, homeHtml } = context

  if (target === 'course') {
    const schedule = await fetchSchedule(client, config, event.semesterId)

    const sourceHash = createSourceHash({
      providerId: event.providerId,
      target,
      termId: schedule.termId,
      courses: schedule.courses,
    })

    return {
      target: 'course',
      termId: schedule.termId,
      cacheData: {
        termId: schedule.termId,
        courses: schedule.courses,
        terms: schedule.terms,
      },
      parsedCount: schedule.courses.length,
      sourceHash,
      syncedAt,
    }
  }

  if (target === 'profile') {
    const profile = parseProfileData(await getProfileData(context), homeHtml, event.username)

    return createFeatureCacheResult(event, 'profile', profile, syncedAt, {
      parsedCount: Object.keys(profile).filter((key) => profile[key]).length,
    })
  }

  if (target === 'score') {
    await getProfileData(context)
    const score = await fetchGrades(client, config, event.semesterId, context.profileParams)

    return createFeatureCacheResult(event, 'score', score, syncedAt, {
      parsedCount: countScoreItems(score),
      meta: {
        scope: event.semesterId ? 'requested_term' : 'all_terms',
        source: event.semesterId ? 'grade_api_requested_term' : 'grade_api_all_terms',
      },
    })
  }

  const exam = await fetchExams(client, config, event.semesterId)

  return createFeatureCacheResult(event, 'exam', exam, syncedAt, {
    parsedCount: countExamItems(exam),
    meta: { scope: 'current_term' },
  })
}

async function runWhhxitProviderSync(event) {
  const targets = normalizeTargets(event)

  if (!targets.length) {
    return fail(
      'TARGET_UNSUPPORTED',
      'WHHXIT cloud sync supports targets course, profile, score and exam only.',
      { unsupported: true },
    )
  }

  const config = WHHXIT_CONFIG
  const client = createHttpClient(config.baseUrl)
  const homeHtml = await loginToWhhxit(client, config, event.username, event.password)
  const context = { event, client, config, homeHtml, profileHtml: '' }
  const syncedAt = new Date().toISOString()
  const cacheResults = []

  for (const target of targets) {
    cacheResults.push(
      await fetchTargetCacheResult(target, event, context, syncedAt),
    )
  }

  return ok({ cacheResults })
}

async function handleEvent(event) {
  try {
    assertAuthorized(event || {})

    if (!event || !event.providerId || !event.username || !event.password) {
      return fail(
        'SYNC_INPUT_INVALID',
        'providerId, targets, username and password are required',
      )
    }

    if (event.providerId !== 'whhxit') {
      return fail(
        'PROVIDER_NOT_FOUND',
        `syncWhhxit only supports providerId whhxit, got ${event.providerId}.`,
        { unsupported: true },
      )
    }

    return await runWhhxitProviderSync(event)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLOUD_SYNC_FAILED'
    const code = message.includes(':') ? message.split(':')[0] : message

    return fail(code || 'CLOUD_SYNC_FAILED', message)
  }
}

exports.main = async function main(event) {
  if (!isHttpEvent(event)) {
    return handleEvent(event)
  }

  try {
    const method = String(event.httpMethod || event.requestContext?.httpMethod || 'POST')
      .toUpperCase()

    if (method !== 'POST') {
      return httpResponse(405, fail('METHOD_NOT_ALLOWED', 'Only POST is supported'))
    }

    const body = parseHttpBody(event)
    const result = await handleEvent({
      ...body,
      headers: event.headers || {},
    })

    return httpResponse(result.ok ? 200 : 400, result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLOUD_SYNC_FAILED'

    return httpResponse(500, fail('CLOUD_SYNC_FAILED', message))
  }
}
