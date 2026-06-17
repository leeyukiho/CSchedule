const crypto = require('node:crypto')
const http = require('node:http')
const https = require('node:https')
const zlib = require('node:zlib')

const WTBU_CONFIG = {
  baseUrl: 'https://jxgl.wtbu.edu.cn',
  loginPath: '/eams/login.action',
  homePath: '/eams/home.action',
  scheduleIndexPath: '/eams/courseTableForStd.action',
  scheduleTablePath: '/eams/courseTableForStd!courseTable.action',
}
const WTBU_LOGIN_MAX_ATTEMPTS = 2
const WTBU_SCHEDULE_FETCH_MAX_ATTEMPTS = 3

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

        if (index <= 0) {
          continue
        }

        cookies.set(pair.slice(0, index), pair.slice(index + 1))
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
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

      return request('GET', location, undefined, {
        ...options,
        followRedirects: true,
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
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function getTextFromHtml(html) {
  return cleanText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  )
}

function isLoginPage(html) {
  const text = String(html || '')

  return text.includes('loginForm') || text.includes('password') || text.includes('username')
}

function hasInvalidCredentialMessage(html) {
  const text = getTextFromHtml(html)

  return [
    '\u5bc6\u7801\u9519\u8bef',
    '\u7528\u6237\u540d\u6216\u5bc6\u7801',
    '\u8d26\u53f7\u6216\u5bc6\u7801',
    '\u767b\u5f55\u5931\u8d25',
    '\u7528\u6237\u4e0d\u5b58\u5728',
  ].some((keyword) => text.includes(keyword))
}

function normalizeEduHref(href, baseUrl) {
  const value = String(href || '').trim()

  if (!value || /^javascript:/i.test(value) || value === '#') {
    return ''
  }

  try {
    const url = new URL(value, baseUrl)

    if (url.origin !== baseUrl) {
      return ''
    }

    return `${url.pathname}${url.search}`
  } catch {
    return ''
  }
}

async function followLoginRedirect(client, config, location) {
  const path = normalizeEduHref(location, config.baseUrl)

  if (path) {
    await client.get(path)
  }
}

async function fetchLoggedInHome(client, config) {
  const [homePage, schedulePage] = await Promise.all([
    client.get(config.homePath).catch(() => null),
    client.get(config.scheduleIndexPath).catch(() => null),
  ])
  const homeHtml = String(homePage?.data || '')
  const scheduleHtml = String(schedulePage?.data || '')

  if (
    scheduleHtml.includes('courseTableForStd') ||
    scheduleHtml.includes('semester.id') ||
    scheduleHtml.includes('bg.form.addInput')
  ) {
    return homeHtml || scheduleHtml
  }

  if (homeHtml && !isLoginPage(homeHtml)) {
    return homeHtml
  }

  return ''
}

async function loginToWtbu(client, config, username, password) {
  for (let attempt = 1; attempt <= WTBU_LOGIN_MAX_ATTEMPTS; attempt += 1) {
    const loginPage = await client.get(config.homePath)
    const loginHtml = String(loginPage.data || '')
    const saltMatch = loginHtml.match(
      /CryptoJS\.SHA1\(['"]([^'"]*)['"]\s*\+\s*form\[['"]password['"]\]\.value\)/,
    )

    if (!saltMatch && !isLoginPage(loginHtml)) {
      return loginHtml
    }

    if (!saltMatch) {
      throw new Error('WTBU_LOGIN_PARAMS_MISSING')
    }

    const hashedPassword = crypto
      .createHash('sha1')
      .update(`${saltMatch[1]}${password}`, 'utf8')
      .digest('hex')
    const loginPayload = new URLSearchParams({
      username: String(username || '').trim(),
      password: hashedPassword,
      encodedPassword: '',
      session_locale: 'zh_CN',
    })
    const loginResponse = await client.post(
      config.loginPath,
      loginPayload.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${config.baseUrl}${config.homePath}`,
          Origin: config.baseUrl,
        },
        followRedirects: false,
      },
    )
    const loginBody = String(loginResponse.data || '')

    if (hasInvalidCredentialMessage(loginBody)) {
      throw new Error('WTBU_INVALID_CREDENTIALS')
    }

    await followLoginRedirect(client, config, loginResponse.headers.location)

    const homeHtml = await fetchLoggedInHome(client, config)

    if (homeHtml) {
      return homeHtml
    }
  }

  throw new Error('WTBU_SESSION_INVALID')
}

function parseJsStringLiteral(value) {
  const text = String(value || '').trim()

  if (!text || text === 'null') {
    return ''
  }

  if (text.startsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }

  if (text.startsWith("'")) {
    return text.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  }

  return ''
}

function splitJsArguments(argsText) {
  const args = []
  let current = ''
  let quote = ''
  let depth = 0
  let escaped = false

  for (const char of argsText) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      current += char
      escaped = true
      continue
    }

    if (quote) {
      current += char
      if (char === quote) {
        quote = ''
      }
      continue
    }

    if (char === '"' || char === "'") {
      current += char
      quote = char
      continue
    }

    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      current += char
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      current += char
      continue
    }

    if (char === ',' && depth === 0) {
      args.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  if (current.trim()) {
    args.push(current.trim())
  }

  return args
}

function parseWeekRange(weekText) {
  const weeks = []
  const matches = String(weekText || '').match(/\d+\s*(?:-\s*\d+)?/g) || []

  for (const match of matches) {
    const [startText, endText] = match.split('-').map((item) => item.trim())
    const start = Number(startText)
    const end = Number(endText || startText)

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue
    }

    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      weeks.push(week)
    }
  }

  return [...new Set(weeks)].sort((a, b) => a - b)
}

function getCourseName(rawName) {
  return String(rawName || '')
    .replace(/\([0-9A-Za-z.]+\)$/, '')
    .trim()
}

function takeTrailingParenthesized(text) {
  const source = String(text || '').trim()
  const match = source.match(/\s*\(([^()]*)\)\s*$/)

  if (!match) {
    return { rest: source, value: '' }
  }

  return {
    rest: source.slice(0, match.index).trim(),
    value: match[1].trim(),
  }
}

function parseCourseInfoText(rawText) {
  let rest = String(rawText || '')
    .trim()
    .replace(/^\{|\}$/g, '')
  const info = {
    name: getCourseName(rest),
    teacher: '',
    location: '',
    weeks: [],
  }
  const weekLocation = takeTrailingParenthesized(rest)

  if (weekLocation.value && /\d/.test(weekLocation.value)) {
    const parts = weekLocation.value.split(/[,\uFF0C]/)
    info.weeks = parseWeekRange(parts.shift())
    info.location = parts.join(' ').trim()
    rest = weekLocation.rest
  }

  const teacher = takeTrailingParenthesized(rest)

  if (teacher.value && !/^[0-9A-Za-z.]+$/.test(teacher.value)) {
    info.teacher = teacher.value
    rest = teacher.rest
  }

  info.name = getCourseName(rest)

  return info
}

function extractTeacherNames(html, activityPosition) {
  const prefix = html.slice(Math.max(0, activityPosition - 1800), activityPosition)
  const matches = [...prefix.matchAll(/var\s+actTeachers\s*=\s*\[([\s\S]*?)\];/g)]
  const latest = matches[matches.length - 1]

  if (!latest) {
    return ''
  }

  return [...latest[1].matchAll(/name\s*:\s*"((?:\\.|[^"\\])*)"/g)]
    .map((match) => parseJsStringLiteral(`"${match[1]}"`))
    .filter(Boolean)
    .join(',')
}

function getWeekNumbers(validWeeks, from, startWeek, endWeek) {
  if (!validWeeks) {
    return []
  }

  let rotatedWeeks = validWeeks

  if (from > 1) {
    const before = validWeeks.substring(0, from - 1)
    rotatedWeeks = validWeeks.substring(from - 1)

    if (before.includes('1')) {
      rotatedWeeks += before
    }

    while (rotatedWeeks.length < validWeeks.length) {
      rotatedWeeks += '0'
    }
  }

  const weeks = []

  for (let week = startWeek; week <= endWeek; week += 1) {
    if (rotatedWeeks.charAt(week - 1) === '1') {
      weeks.push(week)
    }
  }

  return weeks
}

function splitContinuousSections(sections) {
  const sorted = [...new Set(sections)].sort((a, b) => a - b)
  const groups = []

  for (const section of sorted) {
    const latest = groups[groups.length - 1]

    if (!latest || latest[latest.length - 1] + 1 !== section) {
      groups.push([section])
    } else {
      latest.push(section)
    }
  }

  return groups
}

function stripTags(value) {
  return cleanText(String(value || '').replace(/<[^>]+>/g, ' '))
}

function parseSemesters(indexHtml) {
  const html = String(indexHtml || '')
  const semesters = []
  const selectMatch = html.match(
    /<select\b[^>]*(?:name|id)=["']semester\.id["'][^>]*>([\s\S]*?)<\/select>/i,
  )
  const source = selectMatch ? selectMatch[1] : html
  const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi
  let option

  while ((option = optionRegex.exec(source)) !== null) {
    const attr = option[1] || ''
    const id = (attr.match(/\bvalue=["']?([^"'\s>]*)/i) || [])[1] || ''
    const label = stripTags(option[2])

    if (!id && !label) {
      continue
    }

    semesters.push({
      id,
      title: label || `term ${id}`,
      label: label || `term ${id}`,
      selected: /\bselected\b/i.test(attr),
    })
  }

  return semesters
}

function getCurrentSemesterId(indexHtml) {
  const html = String(indexHtml || '')
  const selectedOption =
    (html.match(/<option\b[^>]*selected[^>]*\bvalue=["']?([^"'\s>]*)/i) || [])[1] ||
    (html.match(/<option\b[^>]*\bvalue=["']?([^"'\s>]*)[^>]*selected/i) || [])[1]
  const inputValue =
    (html.match(/name=["']semester\.id["'][^>]*value=["']([^"']*)["']/i) || [])[1] ||
    (html.match(/value=["']([^"']*)["'][^>]*name=["']semester\.id["']/i) || [])[1]
  const calendarValue =
    (html.match(/semesterCalendar\(\{[^}]*value:"([^"]+)"/i) || [])[1]

  return selectedOption || inputValue || calendarValue || ''
}

function createFallbackSemesterId(term) {
  const text = cleanText(term)
  const yearMatch = text.match(/(20\d{2})\s*[-~\u2014\u81f3]\s*(20\d{2})/)
  const secondSemester =
    text.includes('\u7b2c\u4e8c\u5b66\u671f') ||
    text.includes('\u4e0b\u5b66\u671f') ||
    /[. -]?2$/.test(text)

  if (yearMatch) {
    return `${yearMatch[1]}-${yearMatch[2]}-${secondSemester ? '2' : '1'}`
  }

  return text
    ? `term-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 10)}`
    : ''
}

function parseSchedule(scheduleHtml) {
  const html = String(scheduleHtml || '')
  const titleMatch =
    html.match(/<h3[^>]*align=["']center["'][^>]*>([\s\S]*?)<\/h3>/i) ||
    html.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)
  const term = titleMatch ? stripTags(titleMatch[1]) : ''
  const marshalMatch = html.match(
    /\.marshalTable\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)\)/,
  )
  const from = marshalMatch ? Number(marshalMatch[1]) : 1
  const startWeek = marshalMatch ? Number(marshalMatch[2]) : 1
  const endWeek = marshalMatch ? Number(marshalMatch[3]) : 25
  const unitCountMatch = html.match(/var\s+unitCount\s*=\s*(\d+)/)
  const unitCount = unitCountMatch ? Number(unitCountMatch[1]) : 13
  const courses = []
  const activityRegex =
    /activity\s*=\s*new\s+TaskActivity\(([\s\S]*?)\);\s*((?:\s*index\s*=\s*\d+\s*\*\s*unitCount\s*\+\s*\d+\s*;\s*table\d+\.activities\[index\]\[table\d+\.activities\[index\]\.length\]\s*=\s*activity\s*;\s*)+)/g
  let match

  while ((match = activityRegex.exec(html)) !== null) {
    const args = splitJsArguments(match[1])
    const rawCourseName = parseJsStringLiteral(args[3])
    const parsedCourseInfo = parseCourseInfoText(rawCourseName)
    const name = parsedCourseInfo.name || getCourseName(rawCourseName)
    const roomName = parseJsStringLiteral(args[5]) || parsedCourseInfo.location
    const validWeeks = parseJsStringLiteral(args[6])
    const teacherName =
      extractTeacherNames(html, match.index) ||
      parseJsStringLiteral(args[1]) ||
      parsedCourseInfo.teacher
    const weeks = getWeekNumbers(validWeeks, from, startWeek, endWeek)
    const activeWeeks = weeks.length > 0 ? weeks : parsedCourseInfo.weeks
    const slotsByDay = new Map()

    for (const slot of match[2].matchAll(
      /index\s*=\s*(\d+)\s*\*\s*unitCount\s*\+\s*(\d+)/g,
    )) {
      const weekday = Number(slot[1]) + 1
      const section = Number(slot[2]) + 1
      const sections = slotsByDay.get(weekday) || []
      sections.push(section)
      slotsByDay.set(weekday, sections)
    }

    for (const [weekday, sections] of slotsByDay.entries()) {
      for (const sectionGroup of splitContinuousSections(sections)) {
        courses.push({
          id: `${courses.length + 1}`,
          name,
          teacher: teacherName,
          location: roomName,
          classroom: roomName,
          weekday,
          sections: sectionGroup,
          startSection: sectionGroup[0],
          endSection: sectionGroup[sectionGroup.length - 1],
          weeks: activeWeeks,
        })
      }
    }
  }

  return {
    term,
    courses: courses.sort((a, b) => {
      if (a.weekday !== b.weekday) {
        return a.weekday - b.weekday
      }

      return (a.sections?.[0] || 0) - (b.sections?.[0] || 0)
    }),
  }
}

async function fetchWtbuSchedule(client, config, semesterId) {
  let indexHtml = ''

  for (let attempt = 1; attempt <= WTBU_SCHEDULE_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const indexResponse = await client.get(config.scheduleIndexPath)
    indexHtml = String(indexResponse.data || '')

    if (
      indexHtml.includes('bg.form.addInput') ||
      indexHtml.includes('semester.id') ||
      indexHtml.includes('courseTableForStd')
    ) {
      break
    }
  }

  const idsMatch = indexHtml.match(
    /bg\.form\.addInput\(form,\s*["']ids["'],\s*["']([^"']+)["']\)/,
  )

  if (!idsMatch) {
    throw new Error('WTBU_SCHEDULE_PARAMS_MISSING')
  }

  let semesters = parseSemesters(indexHtml)
  const currentSemesterId = getCurrentSemesterId(indexHtml)
  const selectedSemesterId = String(semesterId || '').trim() || currentSemesterId
  const tablePayload = new URLSearchParams({
    ids: idsMatch[1],
    'semester.id': selectedSemesterId,
    'setting.kind': 'std',
    startWeek: '',
  })
  const response = await client.post(
    config.scheduleTablePath,
    tablePayload.toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  )
  const parsedSchedule = parseSchedule(response.data)
  const fallbackSemesterId = createFallbackSemesterId(parsedSchedule.term)
  const normalizedSemesterId = selectedSemesterId || fallbackSemesterId

  if (
    (normalizedSemesterId || parsedSchedule.term) &&
    !semesters.some((semester) => semester.id === normalizedSemesterId)
  ) {
    semesters = [
      {
        id: normalizedSemesterId || '',
        title: parsedSchedule.term || 'current term',
        label: parsedSchedule.term || 'current term',
        selected: true,
      },
      ...semesters,
    ]
  }

  return {
    ...parsedSchedule,
    semesters: semesters.map((semester) => ({
      ...semester,
      selected: semester.id === normalizedSemesterId,
    })),
    selectedSemesterId: normalizedSemesterId,
  }
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

function normalizeLabel(value) {
  return cleanText(value).replace(/[：:]/g, '').replace(/\s+/g, '').trim()
}

function getPairValue(pairs, labels) {
  const entries = Object.entries(pairs || {})

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && exact[1]) {
      return exact[1]
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)
      return (
        normalizedKey.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedKey)
      )
    })

    if (fuzzy && fuzzy[1]) {
      return fuzzy[1]
    }
  }

  return ''
}

function parseProfile(homeHtml, fallbackStudentId) {
  const text = getTextFromHtml(homeHtml)
  const accountMatch = text.match(
    /([\u4e00-\u9fa5A-Za-z·]{2,30})\(([^)]+)\)\s+([^\s]+)/,
  )
  const name = accountMatch ? accountMatch[1] : ''
  const studentId = accountMatch ? accountMatch[2] : fallbackStudentId
  const role = accountMatch ? accountMatch[3] : '学生'

  return {
    name,
    studentId,
    role,
    maskedStudentId: maskStudentId(studentId),
    major: '',
    grade: '',
    level: '',
    className: '',
    gender: '',
    birthDate: '',
    politicalStatus: '',
    phone: '',
    email: '',
    nativePlace: '',
    enrollmentDate: '',
    studentStatus: '',
    dormitory: '',
    counselor: '',
    updatedAt: new Date().toISOString(),
  }
}

function parseKeyValuePairs(html) {
  const pairs = {}
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let rowMatch

  function addPair(label, value) {
    const key = normalizeLabel(label)
    const text = cleanText(value)

    if (!key || !text || key.length > 24) {
      return
    }

    pairs[key] = text
  }

  while ((rowMatch = rowRegex.exec(String(html || ''))) !== null) {
    const cells = [...rowMatch[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
      .map((match) => stripTags(match[1]))
      .filter(Boolean)

    if (cells.length < 2) {
      continue
    }

    for (let index = 0; index < cells.length - 1; index += 2) {
      addPair(cells[index], cells[index + 1])
    }
  }

  const text = getTextFromHtml(html)
  const labels = [
    '姓名',
    '学号',
    '性别',
    '出生年月',
    '出生日期',
    '政治面貌',
    '手机号',
    '联系电话',
    '邮箱',
    '电子邮箱',
    '籍贯',
    '生源地',
    '入学时间',
    '入学日期',
    '学籍状态',
    '学生状态',
    '宿舍信息',
    '宿舍',
    '辅导员',
    '班级',
    '行政班',
    '专业',
    '专业名称',
    '年级',
    '培养层次',
    '层次',
  ]

  for (const label of labels) {
    const pattern = new RegExp(
      `${label}\\s*[：:]\\s*([^：:]{1,80}?)(?=\\s+(?:${labels.join('|')})\\s*[：:]|$)`,
    )
    const match = text.match(pattern)

    if (match) {
      addPair(label, match[1])
    }
  }

  return pairs
}

function mergeProfile(baseProfile, detailHtml, fallbackStudentId) {
  const pairs = parseKeyValuePairs(detailHtml)
  const studentId =
    firstValue(
      getPairValue(pairs, ['学号', '学籍号']),
      baseProfile.studentId,
      fallbackStudentId,
    ) || fallbackStudentId

  return {
    ...baseProfile,
    name: firstValue(getPairValue(pairs, ['姓名']), baseProfile.name),
    studentId: String(studentId),
    role: firstValue(baseProfile.role, '学生'),
    maskedStudentId: maskStudentId(studentId),
    major: firstValue(getPairValue(pairs, ['专业名称', '专业']), baseProfile.major),
    grade: firstValue(getPairValue(pairs, ['年级']), baseProfile.grade),
    level: firstValue(getPairValue(pairs, ['培养层次', '层次']), baseProfile.level),
    className: firstValue(getPairValue(pairs, ['行政班', '班级']), baseProfile.className),
    gender: firstValue(getPairValue(pairs, ['性别']), baseProfile.gender),
    birthDate: firstValue(getPairValue(pairs, ['出生日期', '出生年月']), baseProfile.birthDate),
    politicalStatus: firstValue(getPairValue(pairs, ['政治面貌']), baseProfile.politicalStatus),
    phone: firstValue(getPairValue(pairs, ['手机号', '联系电话', '电话']), baseProfile.phone),
    email: firstValue(getPairValue(pairs, ['电子邮箱', '邮箱']), baseProfile.email),
    nativePlace: firstValue(getPairValue(pairs, ['籍贯', '生源地']), baseProfile.nativePlace),
    enrollmentDate: firstValue(getPairValue(pairs, ['入学日期', '入学时间']), baseProfile.enrollmentDate),
    studentStatus: firstValue(getPairValue(pairs, ['学籍状态', '学生状态']), baseProfile.studentStatus),
    dormitory: firstValue(getPairValue(pairs, ['宿舍信息', '宿舍']), baseProfile.dormitory),
    counselor: firstValue(getPairValue(pairs, ['辅导员']), baseProfile.counselor),
    updatedAt: new Date().toISOString(),
  }
}

function extractHrefFromOnclick(onclick) {
  const text = String(onclick || '')
  const match =
    text.match(/(?:location\.href|open|href|url)\s*\(?\s*['"]([^'"]+)['"]/i) ||
    text.match(/['"](\/eams\/[^'"]+)['"]/i)

  return match ? match[1] : ''
}

function findEduLinksByKeywords(html, keywords, baseUrl) {
  const source = String(html || '')
  const candidates = []
  const anchorRegex = /<(?:a|area)\b([^>]*)>([\s\S]*?)<\/(?:a|area)>/gi
  let anchor

  while ((anchor = anchorRegex.exec(source)) !== null) {
    const attrs = anchor[1] || ''
    const text = cleanText(`${stripTags(anchor[2])} ${attrs}`)
    const hrefAttr = (attrs.match(/\bhref=["']([^"']+)["']/i) || [])[1]
    const onclick = (attrs.match(/\bonclick=["']([^"']+)["']/i) || [])[1] || ''
    const href =
      normalizeEduHref(hrefAttr, baseUrl) ||
      normalizeEduHref(extractHrefFromOnclick(onclick), baseUrl)

    if (keywords.some((keyword) => text.includes(keyword)) && href) {
      candidates.push(href)
    }
  }

  for (const keyword of keywords) {
    const pattern = new RegExp(`.{0,160}${keyword}.{0,160}`, 'g')
    const snippets = source.match(pattern) || []

    for (const snippet of snippets) {
      const matches = snippet.match(/\/eams\/[^'"<>\s)]+/g) || []
      candidates.push(
        ...matches.map((href) => normalizeEduHref(href, baseUrl)).filter(Boolean),
      )
    }
  }

  return [...new Set(candidates)]
}

async function fetchEduPath(client, path, baseUrl) {
  const normalizedPath = normalizeEduHref(path, baseUrl)

  if (!normalizedPath) {
    return ''
  }

  const response = await client.get(normalizedPath)
  const html = String(response.data || '')

  if (!html || isLoginPage(html)) {
    return ''
  }

  return html
}

async function fetchEduPageByKeywords(client, homeHtml, keywords, fallbackPaths, baseUrl) {
  const paths = [
    ...findEduLinksByKeywords(homeHtml, keywords, baseUrl),
    ...fallbackPaths,
  ]
    .map((path) => normalizeEduHref(path, baseUrl))
    .filter(Boolean)
  const uniquePaths = [...new Set(paths)]

  for (const path of uniquePaths) {
    try {
      const html = await fetchEduPath(client, path, baseUrl)

      if (html) {
        return html
      }
    } catch (error) {
      console.warn('fetch WTBU page failed', path, error.message || '')
    }
  }

  return ''
}

async function fetchProfile(client, config, homeHtml, studentId) {
  const fallbackProfile = parseProfile(homeHtml, studentId)
  const profileHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['学籍信息', '个人信息', '基本信息'],
    ['/eams/stdDetail.action', '/eams/stdDetail!info.action', '/eams/home.action'],
    config.baseUrl,
  )

  return profileHtml
    ? mergeProfile(fallbackProfile, profileHtml, studentId)
    : fallbackProfile
}

function getStrictCellByLabels(row, labels) {
  const entries = Object.entries(row || {})

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && exact[1]) {
      return cleanText(exact[1])
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)

      if (normalizedLabel === '课程' && normalizedKey !== '课程') {
        return false
      }

      return (
        normalizedKey.includes(normalizedLabel) ||
        normalizedLabel.includes(normalizedKey)
      )
    })

    if (fuzzy && fuzzy[1]) {
      return cleanText(fuzzy[1])
    }
  }

  return ''
}

function getGradeCellByLabels(row, labels, options = {}) {
  const entries = Object.entries(row || {})
  const negativePattern = options.exclude ? new RegExp(options.exclude) : null

  function canUseKey(key) {
    const normalizedKey = normalizeLabel(key)
    return !negativePattern || !negativePattern.test(normalizedKey)
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && exact[1] && canUseKey(exact[0])) {
      return cleanText(exact[1])
    }
  }

  for (const label of labels) {
    const normalizedLabel = normalizeLabel(label)
    const fuzzy = entries.find(([key]) => {
      const normalizedKey = normalizeLabel(key)
      return (
        canUseKey(key) &&
        normalizedKey.includes(normalizedLabel) &&
        !normalizedLabel.includes(normalizedKey)
      )
    })

    if (fuzzy && fuzzy[1]) {
      return cleanText(fuzzy[1])
    }
  }

  return ''
}

function isCourseCategoryText(value) {
  return /^(必修课?|选修课?|限选课?|任选课?|公选课?|通识课?|实践课?|专业必修|专业选修|公共必修)$/u.test(
    cleanText(value),
  )
}

function isBadCourseName(value) {
  const text = cleanText(value)

  return (
    !text ||
    isCourseCategoryText(text) ||
    /^(课程名称|课程类别|课程性质|课程属性|成绩|学分|绩点)$/u.test(text) ||
    /^\d+(?:\.\d+)?$/.test(text)
  )
}

function getGradeCourseName(row) {
  const entries = Object.entries(row || {})
  const exactLabels = ['课程名称', '课程名', '科目名称', '考试课程', '教学班名称']

  for (const label of exactLabels) {
    const normalizedLabel = normalizeLabel(label)
    const exact = entries.find(([key]) => normalizeLabel(key) === normalizedLabel)

    if (exact && !isBadCourseName(exact[1])) {
      return cleanText(exact[1])
    }
  }

  const nameLike = entries.find(([key, value]) => {
    const normalizedKey = normalizeLabel(key)

    return (
      /名称|课程名|科目/.test(normalizedKey) &&
      !/类别|性质|属性|序号|代码|编号|学分|成绩|绩点/.test(normalizedKey) &&
      !isBadCourseName(value)
    )
  })

  if (nameLike) {
    return cleanText(nameLike[1])
  }

  const cells = Array.isArray(row.__cells) ? row.__cells : []
  const fallback = cells
    .filter((cell) => !isBadCourseName(cell))
    .filter((cell) => !/20\d{2}\s*-\s*20\d{2}|第?[一二12]学期|已修|通过/.test(cell))
    .sort((a, b) => b.length - a.length)[0]

  return fallback || ''
}

function extractTableRows(html) {
  const rows = []
  const tableMatches = [...String(html || '').matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
  const sources = tableMatches.length ? tableMatches.map((match) => match[1]) : [String(html || '')]

  for (const source of sources) {
    let headers = []
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
    let row

    while ((row = rowRegex.exec(source)) !== null) {
      const cells = [...row[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((match) => ({
          tag: match[1].toLowerCase(),
          text: stripTags(match[2]),
        }))
      const cellTexts = cells.map((cell) => cell.text)
      const nonEmptyCells = cellTexts.filter(Boolean)

      if (nonEmptyCells.length === 0) {
        continue
      }

      const hasHeaderCell = cells.some((cell) => cell.tag === 'th')
      const looksLikeHeader = nonEmptyCells.some((cell) =>
        /课程|成绩|学分|绩点|考试|时间|地点|座位|学期/.test(cell),
      )

      if ((hasHeaderCell || headers.length === 0) && looksLikeHeader) {
        headers = cellTexts.map((cell, index) => cell || `列${index + 1}`)
        continue
      }

      if (headers.length === 0 || nonEmptyCells.length < 2) {
        continue
      }

      const data = {}

      cellTexts.forEach((cell, index) => {
        data[headers[index] || `列${index + 1}`] = cell
      })
      Object.defineProperty(data, '__cells', {
        value: cellTexts,
        enumerable: false,
      })
      rows.push(data)
    }
  }

  return rows
}

function toNumber(value) {
  const match = String(value || '').match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function getNumericScore(value) {
  const text = String(value || '').trim()

  if (/^(优秀|优)$/u.test(text)) {
    return 95
  }

  if (/^良好?$/u.test(text)) {
    return 85
  }

  if (/^中等?$/u.test(text)) {
    return 75
  }

  if (/^及格$/u.test(text)) {
    return 60
  }

  if (/^(不及格|缺考|缓考|作弊)$/u.test(text)) {
    return 0
  }

  return toNumber(text)
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value) || value <= 0) {
    return '--'
  }

  return Number(value.toFixed(digits)).toString()
}

function calculateGpa(score, sourceGpa) {
  const numericScore = getNumericScore(score)

  if (numericScore < 60) {
    return { value: 0, text: '--' }
  }

  const existingGpa = toNumber(sourceGpa)
  const gpa = existingGpa > 0 ? existingGpa : (numericScore - 50) / 10

  return { value: gpa, text: formatNumber(gpa, 1) }
}

function extractGradeRecords(gradesHtml, defaultTerm = '') {
  const rows = extractTableRows(gradesHtml)
  const records = []

  for (const row of rows) {
    const name = getGradeCourseName(row)
    const score = getGradeCellByLabels(
      row,
      ['最终成绩', '总评成绩', '总评', '成绩'],
      { exclude: '绩点|学分' },
    )

    if (!name || !score || isBadCourseName(name)) {
      continue
    }

    records.push({
      term:
        getStrictCellByLabels(row, ['学年学期', '开课学期', '学期', '学年']) ||
        defaultTerm ||
        '未分组学期',
      name,
      credit: getGradeCellByLabels(row, ['学分', '课程学分'], {
        exclude: '成绩|绩点',
      }),
      score,
      gpa: getGradeCellByLabels(row, ['绩点', '课程绩点'], {
        exclude: '成绩|学分',
      }),
    })
  }

  return records
}

function buildGradesResult(records) {
  const semesters = new Map()
  const seen = new Set()
  const groupedRecordKeys = new Set(
    records
      .filter((record) => record.term && record.term !== '未分组学期')
      .map((record) => [record.name, record.credit, record.score, record.gpa].join('|')),
  )
  let totalCredit = 0
  let weightedScore = 0
  let weightedGpa = 0
  let scoreCredit = 0
  let gpaCredit = 0

  for (const record of records) {
    const basicKey = [record.name, record.credit, record.score, record.gpa].join('|')

    if (
      (!record.term || record.term === '未分组学期') &&
      groupedRecordKeys.has(basicKey)
    ) {
      continue
    }

    const uniqueKey = [record.term, record.name, record.credit, record.score, record.gpa].join('|')

    if (seen.has(uniqueKey)) {
      continue
    }

    seen.add(uniqueKey)

    const term = record.term || '未分组学期'
    const credit = toNumber(record.credit)
    const numericScore = getNumericScore(record.score)
    const scoreLow = numericScore > 0 && numericScore < 60
    const gpa = calculateGpa(record.score, record.gpa)
    const grade = {
      name: record.name,
      credit: record.credit || '--',
      score: record.score,
      scoreLow,
      gpa: gpa.text,
    }

    if (!semesters.has(term)) {
      semesters.set(term, {
        id: `semester-${semesters.size + 1}`,
        title: term,
        creditValue: 0,
        scoreValue: 0,
        scoreCredit: 0,
        gpaValue: 0,
        gpaCredit: 0,
        grades: [],
      })
    }

    const semester = semesters.get(term)
    semester.grades.push(grade)
    semester.creditValue += credit

    if (credit > 0) {
      totalCredit += credit

      if (numericScore > 0) {
        semester.scoreValue += numericScore * credit
        semester.scoreCredit += credit
        weightedScore += numericScore * credit
        scoreCredit += credit
      }

      if (gpa.value > 0) {
        semester.gpaValue += gpa.value * credit
        semester.gpaCredit += credit
        weightedGpa += gpa.value * credit
        gpaCredit += credit
      }
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

function mergeGradePages(pages) {
  return buildGradesResult(
    pages.flatMap((page) => extractGradeRecords(page.html, page.term)),
  )
}

function parseGradeSemesters(gradesHtml) {
  const html = String(gradesHtml || '')
  const semesters = []

  function addSemester(id, label) {
    const semesterId = String(id || '').trim()

    if (!semesterId || semesters.some((semester) => semester.id === semesterId)) {
      return
    }

    semesters.push({
      id: semesterId,
      label: cleanText(label) || `学期 ${semesterId}`,
    })
  }

  for (const select of html.matchAll(/<select\b[^>]*(?:name=["']semester(?:\.id|Id)["'])[^>]*>([\s\S]*?)<\/select>/gi)) {
    for (const option of select[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      addSemester((option[1].match(/\bvalue=["']?([^"'\s>]*)/i) || [])[1], stripTags(option[2]))
    }
  }

  for (const match of html.matchAll(/[?&]semesterId=([^&#"']+)/g)) {
    addSemester(decodeURIComponent(match[1]), '')
  }

  for (const match of html.matchAll(/semesterId\s*[=:]\s*['"]?(\d+)/g)) {
    const start = Math.max(0, (match.index || 0) - 120)
    const end = Math.min(html.length, (match.index || 0) + 160)
    const label = getTextFromHtml(html.slice(start, end)).match(
      /20\d{2}\s*-\s*20\d{2}\s*(?:学年)?\s*(?:第?[一二12]学期|学期[一二12])?/,
    )

    addSemester(match[1], label ? label[0] : '')
  }

  return semesters
}

function emptyGrades() {
  return {
    summary: [
      { label: '总学分', value: '--' },
      { label: '平均分', value: '--' },
      { label: '绩点', value: '--' },
    ],
    semesters: [],
  }
}

async function fetchGrades(client, config, homeHtml) {
  const gradesHtml = await fetchEduPageByKeywords(
    client,
    homeHtml,
    ['我的成绩', '成绩查询', '成绩'],
    [
      '/eams/teach/grade/course/person.action',
      '/eams/teach/grade/course/person!search.action?semesterId=&projectType=',
      '/eams/teach/grade/course/person!historyCourseGrade.action?projectType=MAJOR',
    ],
    config.baseUrl,
  )

  if (!gradesHtml) {
    return emptyGrades()
  }

  const pages = [{ html: gradesHtml, term: '' }]
  const semesters = parseGradeSemesters(gradesHtml)
  const paths = [
    '/eams/teach/grade/course/person!search.action?semesterId=&projectType=',
    '/eams/teach/grade/course/person!historyCourseGrade.action?projectType=MAJOR',
    ...semesters.flatMap((semester) => [
      `/eams/teach/grade/course/person!search.action?semesterId=${encodeURIComponent(semester.id)}&projectType=`,
      `/eams/teach/grade/course/person!search.action?semesterId=${encodeURIComponent(semester.id)}&projectType=MAJOR`,
    ]),
  ]
  const seenPaths = new Set()

  for (const path of paths) {
    if (seenPaths.has(path)) {
      continue
    }

    seenPaths.add(path)

    try {
      const html = await fetchEduPath(client, path, config.baseUrl)

      if (!html) {
        continue
      }

      const semesterId = (path.match(/[?&]semesterId=([^&#]*)/) || [])[1] || ''
      const semester = semesters.find((item) => item.id === decodeURIComponent(semesterId))
      pages.push({
        html,
        term: semester ? semester.label : '',
      })
    } catch (error) {
      console.warn('fetch WTBU grades page failed', path, error.message || '')
    }
  }

  const result = mergeGradePages(pages)
  return result.semesters.length > 0 ? result : emptyGrades()
}

function countScoreItems(data) {
  return (data.semesters || []).reduce((count, semester) => {
    return count + (Array.isArray(semester.grades) ? semester.grades.length : 0)
  }, 0)
}

function createSession() {
  return {
    sessionReusable: false,
    sessionRefreshable: false,
    accountStatus: 'cached_only',
  }
}

function isBackendAutoSync(event) {
  return event.source === 'backend_auto_sync'
}

function withClientCacheFields(event, cacheData, extra = {}) {
  if (isBackendAutoSync(event)) {
    return cacheData
  }

  return {
    ...cacheData,
    ...extra,
    accountId: '',
    schoolId: event.schoolId,
    providerId: event.providerId,
    session: createSession(),
  }
}

function createFeatureCacheData(event, target, data, syncedAt, options = {}) {
  const sourceHash = createSourceHash({
    providerId: event.providerId,
    target,
    termId: options.termId,
    data,
  })

  return withClientCacheFields(event, {
    target,
    termId: options.termId,
    data,
    meta: {
      source: 'cloud_worker',
      ...(options.meta || {}),
    },
    sourceHash,
    syncedAt,
  })
}

function createSourceHash(input) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex')
}

async function runWtbuProviderSync(event) {
  if (!['course', 'score', 'exam', 'profile'].includes(event.target)) {
    return fail(
      'TARGET_UNSUPPORTED',
      'WTBU cloud sync supports course, score, exam and profile targets only.',
      { unsupported: true },
    )
  }

  const config = WTBU_CONFIG
  const client = createHttpClient(config.baseUrl)

  const homeHtml = await loginToWtbu(client, config, event.username, event.password)
  const syncedAt = new Date().toISOString()

  if (event.target === 'course') {
    const schedule = await fetchWtbuSchedule(client, config, event.semesterId)

    if (!schedule.courses.length) {
      throw new Error('WTBU_SCHEDULE_EMPTY')
    }

    const termId = schedule.selectedSemesterId
    const sourceHash = createSourceHash({
      providerId: event.providerId,
      target: event.target,
      termId,
      courses: schedule.courses,
    })
    const cacheData = withClientCacheFields(event, {
      termId,
      courses: schedule.courses,
      terms: schedule.semesters || [],
      sectionTimes: schedule.sectionTimes || [],
      sourceHash,
      syncedAt,
    })
    const cacheResults = [
      {
        target: 'course',
        termId,
        cacheData,
        parsedCount: schedule.courses.length,
        sourceHash,
        warnings: [],
      },
    ]

    return ok({
      target: event.target,
      termId,
      cacheResults,
      parsedCount: schedule.courses.length,
      sourceHash,
      warnings: [],
    })
  }

  if (event.target === 'profile') {
    const profile = await fetchProfile(client, config, homeHtml, event.username).catch((error) => {
      console.warn('fetch WTBU profile failed', error.message || '')
      return parseProfile(homeHtml, event.username)
    })
    const cacheData = createFeatureCacheData(event, 'profile', profile, syncedAt)
    const cacheResults = [
      {
        target: 'profile',
        cacheData,
        parsedCount: Object.keys(profile).filter((key) => profile[key]).length,
        sourceHash: cacheData.sourceHash,
        warnings: [],
      },
    ]

    return ok({
      target: event.target,
      cacheResults,
      parsedCount: cacheResults[0].parsedCount,
      sourceHash: cacheData.sourceHash,
      warnings: [],
    })
  }

  if (event.target === 'score') {
    const score = await fetchGrades(client, config, homeHtml).catch((error) => {
      console.warn('fetch WTBU grades failed', error.message || '')
      return emptyGrades()
    })
    const cacheData = createFeatureCacheData(event, 'score', score, syncedAt)
    const cacheResults = [
      {
        target: 'score',
        cacheData,
        parsedCount: countScoreItems(score),
        sourceHash: cacheData.sourceHash,
        warnings: [],
      },
    ]

    return ok({
      target: event.target,
      cacheResults,
      parsedCount: cacheResults[0].parsedCount,
      sourceHash: cacheData.sourceHash,
      warnings: [],
    })
  }

  const cacheData = createFeatureCacheData(event, 'exam', [], syncedAt, {
    meta: {
      unsupported: true,
      warning: 'WTBU exam parser is not implemented yet.',
    },
  })
  const cacheResults = [
    {
      target: 'exam',
      cacheData,
      parsedCount: 0,
      sourceHash: cacheData.sourceHash,
      warnings: ['WTBU_EXAM_SYNC_NOT_IMPLEMENTED'],
    },
  ]

  return ok({
    target: event.target,
    cacheResults,
    parsedCount: 0,
    sourceHash: cacheData.sourceHash,
    warnings: ['WTBU_EXAM_SYNC_NOT_IMPLEMENTED'],
  })
}

async function handleEvent(event) {
  try {
    assertAuthorized(event || {})

    if (!event || !event.providerId || !event.target || !event.username || !event.password) {
      return fail(
        'SYNC_INPUT_INVALID',
        'providerId, target, username and password are required',
      )
    }

    if (event.providerId !== 'wtbu') {
      return fail(
        'PROVIDER_NOT_FOUND',
        `syncWtbu only supports providerId wtbu, got ${event.providerId}.`,
        { unsupported: true },
      )
    }

    return await runWtbuProviderSync(event)
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

    return httpResponse(200, await handleEvent(parseHttpBody(event)))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CLOUD_SYNC_FAILED'

    return httpResponse(400, fail('CLOUD_SYNC_FAILED', message))
  }
}
