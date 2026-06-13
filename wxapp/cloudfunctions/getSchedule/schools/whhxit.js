const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { CookieJar } = require('tough-cookie');
const { HttpCookieAgent, HttpsCookieAgent } = require('http-cookie-agent/http');
const { getErrorMessage, maskStudentId } = require('../common');

const EDU_CONFIG = {
  baseUrl: 'https://jwgl.whhxit.edu.cn',
  loginPath: '/jwglxt/xtgl/login_slogin.html',
  publicKeyPath: '/jwglxt/xtgl/login_getPublicKey.html',
  logoutPath: '/jwglxt/xtgl/login_logoutAccount.html',
  homePath: '/jwglxt/xtgl/index_initMenu.html?jsdm=xs',
  scheduleIndexPath: '/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151',
  scheduleDataPath: '/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151'
};

const XQM_LABELS = {
  3: '第1学期',
  12: '第2学期',
  16: '第3学期'
};

function createEduClient() {
  const jar = new CookieJar();

  return axios.create({
    baseURL: EDU_CONFIG.baseUrl,
    httpAgent: new HttpCookieAgent({ cookies: { jar } }),
    httpsAgent: new HttpsCookieAgent({ cookies: { jar } }),
    withCredentials: true,
    timeout: 15000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 MiniProgram Schedule Fetcher',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getTextFromHtml(html) {
  return cleanText(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' '));
}

function extractInputValue(html, nameOrId) {
  const $ = cheerio.load(String(html || ''));
  const byName = $(`input[name="${nameOrId}"]`).first().attr('value');
  const byId = $(`input#${nameOrId}`).first().attr('value');

  return String(byName || byId || '').trim();
}

function base64ToBuffer(value) {
  let text = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/');

  while (text.length % 4 !== 0) {
    text += '=';
  }

  return Buffer.from(text, 'base64');
}

function unsignedBase64UrlToBase64(value) {
  const buffer = base64ToBuffer(value);
  let start = 0;

  while (start < buffer.length - 1 && buffer[start] === 0) {
    start += 1;
  }

  return buffer.slice(start)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createPublicKeyFromJwk(modulus, exponent) {
  return crypto.createPublicKey({
    key: {
      kty: 'RSA',
      n: unsignedBase64UrlToBase64(modulus),
      e: unsignedBase64UrlToBase64(exponent)
    },
    format: 'jwk'
  });
}

function encryptPassword(password, publicKeyData) {
  if (!publicKeyData || !publicKeyData.modulus || !publicKeyData.exponent) {
    throw new Error('无法获取正方登录公钥');
  }

  const publicKey = createPublicKeyFromJwk(publicKeyData.modulus, publicKeyData.exponent);
  const encrypted = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING
    },
    Buffer.from(String(password || ''), 'utf8')
  );

  return encrypted.toString('base64');
}

function isLoginPage(html) {
  const text = String(html || '');

  return /login_slogin\.html|id=["']yhm["']|id=["']dl["']/.test(text);
}

function assertLoggedIn(html) {
  if (!html || isLoginPage(html)) {
    const text = getTextFromHtml(html);
    const message = text.match(/用户名|密码|验证码|登录失败|用户不存在|账号|锁定/)
      ? text.slice(0, 120)
      : '教务系统登录失败，请检查学号和密码';

    throw new Error(message);
  }
}

async function fetchJson(client, path, options = {}) {
  const response = await client.get(path, {
    ...options,
    headers: {
      'Accept': 'application/json,text/javascript,*/*;q=0.8',
      ...(options.headers || {})
    },
    validateStatus(status) {
      return status >= 200 && status < 300;
    }
  });

  return response.data;
}

async function loginToEduSystem(client, studentId, password) {
  const loginResponse = await client.get(EDU_CONFIG.loginPath, {
    validateStatus(status) {
      return status >= 200 && status < 300;
    }
  });
  const loginHtml = String(loginResponse.data || '');
  const csrfToken = extractInputValue(loginHtml, 'csrftoken');
  const language = extractInputValue(loginHtml, 'language') || 'zh_CN';
  const ydType = extractInputValue(loginHtml, 'ydType');
  const publicKey = await fetchJson(client, `${EDU_CONFIG.publicKeyPath}?time=${Date.now()}`);
  const encryptedPassword = encryptPassword(password, publicKey);

  try {
    await client.post(
      EDU_CONFIG.logoutPath,
      new URLSearchParams({ csrfTokenLogout: '' }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': `${EDU_CONFIG.baseUrl}${EDU_CONFIG.loginPath}`
        },
        validateStatus(status) {
          return status >= 200 && status < 400;
        }
      }
    );
  } catch (error) {
    console.warn('whhxit pre-login logout failed:', getErrorMessage(error, ''));
  }

  const payload = new URLSearchParams({
    csrftoken: csrfToken,
    language,
    ydType,
    yhm: String(studentId || '').trim(),
    mm: encryptedPassword
  });

  const response = await client.post(
    `${EDU_CONFIG.loginPath}?time=${Date.now()}`,
    payload.toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${EDU_CONFIG.baseUrl}${EDU_CONFIG.loginPath}`
      },
      validateStatus(status) {
        return status >= 200 && status < 400;
      }
    }
  );
  const homeHtml = String(response.data || '');

  assertLoggedIn(homeHtml);

  return homeHtml;
}

function parseOptionList(html, selector) {
  const $ = cheerio.load(String(html || ''));
  const options = [];

  $(selector).each((index, option) => {
    const $option = $(option);
    const id = cleanText($option.attr('value'));
    const label = cleanText($option.text());

    if (!id && !label) {
      return;
    }

    options.push({
      id,
      label,
      selected: Boolean($option.attr('selected'))
    });
  });

  return options;
}

function parseSelectedTerm(indexHtml) {
  const years = parseOptionList(indexHtml, 'select[name="xnm"] option, select#xnm option');
  const terms = parseOptionList(indexHtml, 'select[name="xqm"] option, select#xqm option');
  const selectedYear = years.find((item) => item.selected) || years[0] || {};
  const selectedTerm = terms.find((item) => item.selected) || terms[0] || {};

  return {
    xnm: selectedYear.id || String(new Date().getFullYear()),
    xqm: selectedTerm.id || '3',
    years,
    terms
  };
}

function buildSemesterId(xnm, xqm) {
  return `${xnm}-${xqm}`;
}

function parseSemesterId(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(3|12|16)$/);

  if (!match) {
    return null;
  }

  return {
    xnm: match[1],
    xqm: match[2]
  };
}

function buildSemesters(selectedTerm) {
  const years = selectedTerm.years.length > 0
    ? selectedTerm.years
    : [{ id: selectedTerm.xnm, label: `${selectedTerm.xnm}-${Number(selectedTerm.xnm) + 1}` }];
  const terms = selectedTerm.terms.length > 0
    ? selectedTerm.terms
    : [{ id: '3', label: '第1学期' }, { id: '12', label: '第2学期' }, { id: '16', label: '第3学期' }];

  return years.flatMap((year) => terms.map((term) => ({
    id: buildSemesterId(year.id, term.id),
    title: `${year.label || year.id} ${term.label || XQM_LABELS[term.id] || term.id}`,
    label: `${year.label || year.id} ${term.label || XQM_LABELS[term.id] || term.id}`,
    selected: year.id === selectedTerm.xnm && term.id === selectedTerm.xqm
  })));
}

function parseWeekRange(weekText) {
  const weeks = [];
  const matches = String(weekText || '').match(/\d+\s*(?:-\s*\d+)?/g) || [];

  for (const match of matches) {
    const [startText, endText] = match.split('-').map((item) => item.trim());
    const start = Number(startText);
    const end = Number(endText || startText);

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    for (let week = Math.min(start, end); week <= Math.max(start, end); week += 1) {
      weeks.push(week);
    }
  }

  return [...new Set(weeks)].sort((a, b) => a - b);
}

function parseSections(sectionText) {
  const match = String(sectionText || '').match(/(\d+)\s*-\s*(\d+)|(\d+)/);

  if (!match) {
    return [];
  }

  const start = Number(match[1] || match[3]);
  const end = Number(match[2] || match[1] || match[3]);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return [];
  }

  return Array.from(
    { length: Math.max(Math.abs(end - start) + 1, 1) },
    (_, index) => Math.min(start, end) + index
  );
}

function firstValue(...values) {
  return values.find((value) => cleanText(value)) || '';
}

function normalizeJwglxtCourse(row, index) {
  const sections = parseSections(firstValue(row.jcor, row.jcs, row.jc));
  const classroom = firstValue(
    row.cdmc && row.lh ? `${row.lh}${row.cdmc}` : '',
    row.cdmc,
    row.jxcdmcs
  );
  const weekday = Number(row.xqj);

  return {
    id: `whhxit-kb-${index + 1}`,
    name: cleanText(row.kcmc) || '未命名课程',
    teacher: cleanText(row.xm),
    location: classroom || '地点待定',
    classroom,
    weekday: Number.isFinite(weekday) ? weekday : 0,
    sections,
    startSection: sections[0],
    endSection: sections[sections.length - 1],
    weeks: parseWeekRange(firstValue(row.zcd, row.zcdstr)),
    rawWeeks: cleanText(firstValue(row.zcd, row.zcdstr)),
    campus: cleanText(row.xqmc),
    remark: cleanText(firstValue(row.kclb, row.kcxz)),
    source: row
  };
}

function normalizePracticeCourse(row, index) {
  return {
    id: `whhxit-sjk-${index + 1}`,
    name: cleanText(row.kcmc) || '未命名课程',
    teacher: cleanText(row.jsxm),
    location: cleanText(row.xqmc) || '地点待定',
    classroom: '',
    weekday: 0,
    sections: [],
    weeks: parseWeekRange(firstValue(row.qsjsz, row.sjkcgs, row.qtkcgs)),
    rawWeeks: cleanText(firstValue(row.qsjsz, row.sjkcgs)),
    campus: cleanText(row.xqmc),
    remark: cleanText(firstValue(row.qtkcgs, row.sjkcgs, row.kclb)),
    source: row
  };
}

function normalizeProfile(xsxx, fallbackStudentId) {
  const studentId = cleanText(xsxx && (xsxx.XH || xsxx.xh)) || fallbackStudentId;

  return {
    name: cleanText(xsxx && (xsxx.XM || xsxx.xm)),
    studentId,
    role: '学生',
    maskedStudentId: maskStudentId(studentId),
    major: cleanText(xsxx && (xsxx.ZYMC || xsxx.zymc)),
    grade: '',
    level: '',
    className: cleanText(xsxx && (xsxx.BJMC || xsxx.bjmc)),
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
    updatedAt: new Date().toISOString()
  };
}

function parseScheduleData(data, selectedTerm, studentId) {
  const payload = data && typeof data === 'object' ? data : {};
  const kbList = Array.isArray(payload.kbList) ? payload.kbList : [];
  const sjkList = Array.isArray(payload.sjkList) ? payload.sjkList : [];
  const xsxx = payload.xsxx || {};
  const xnm = cleanText(xsxx.XNM || selectedTerm.xnm);
  const xqm = cleanText(xsxx.XQM || selectedTerm.xqm);
  const termName = cleanText(
    xsxx.XNMC && xsxx.XQMMC
      ? `${xsxx.XNMC} ${xsxx.XQMMC}`
      : `${xnm}-${Number(xnm) + 1} ${XQM_LABELS[xqm] || xqm}`
  );
  const courses = [
    ...kbList.map(normalizeJwglxtCourse),
    ...sjkList.map(normalizePracticeCourse)
  ];

  return {
    schedule: {
      term: termName,
      selectedSemesterId: buildSemesterId(xnm, xqm),
      semesters: buildSemesters({ ...selectedTerm, xnm, xqm }),
      courses: courses.sort((a, b) => {
        if (a.weekday !== b.weekday) {
          return a.weekday - b.weekday;
        }

        return (a.sections[0] || 0) - (b.sections[0] || 0);
      })
    },
    profile: normalizeProfile(xsxx, studentId)
  };
}

async function fetchScheduleWithClient(client, studentId, options = {}) {
  const indexResponse = await client.get(EDU_CONFIG.scheduleIndexPath, {
    headers: {
      'Referer': `${EDU_CONFIG.baseUrl}${EDU_CONFIG.homePath}`
    },
    validateStatus(status) {
      return status >= 200 && status < 300;
    }
  });
  const selectedTerm = parseSelectedTerm(String(indexResponse.data || ''));
  const requestedTerm = parseSemesterId(options.semesterId) || {};
  const xnm = requestedTerm.xnm || selectedTerm.xnm;
  const xqm = requestedTerm.xqm || selectedTerm.xqm;
  const response = await client.post(
    EDU_CONFIG.scheduleDataPath,
    new URLSearchParams({ xnm, xqm }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': `${EDU_CONFIG.baseUrl}${EDU_CONFIG.scheduleIndexPath}`
      },
      validateStatus(status) {
        return status >= 200 && status < 300;
      }
    }
  );

  return parseScheduleData(response.data, {
    ...selectedTerm,
    xnm,
    xqm
  }, studentId);
}

async function fetchScheduleByCredentials(studentId, password, options = {}) {
  const client = createEduClient();

  await loginToEduSystem(client, studentId, password);

  const { schedule, profile } = await fetchScheduleWithClient(client, studentId, options);

  return {
    schedule,
    profile: options.includeProfile ? profile : null,
    exams: []
  };
}

async function fetchGradesByCredentials() {
  return {
    summary: [],
    semesters: []
  };
}

async function fetchAllByCredentials(studentId, password, options = {}) {
  const result = await fetchScheduleByCredentials(studentId, password, {
    ...options,
    includeProfile: true
  });

  return {
    ...result,
    grades: {
      summary: [],
      semesters: []
    }
  };
}

function createDefaultProfile(studentId) {
  return normalizeProfile({}, studentId);
}

module.exports = {
  id: 'whhxit',
  name: '武汉华夏理工学院',
  aliases: ['武汉华夏理工学院', '华夏理工学院', '华夏理工', 'WHHXIT', 'whhxit'],
  eduSystemUrl: `${EDU_CONFIG.baseUrl}${EDU_CONFIG.loginPath}`,
  fetchScheduleByCredentials,
  fetchGradesByCredentials,
  fetchAllByCredentials,
  createDefaultProfile,
  __test__: {
    buildSemesterId,
    encryptPassword,
    normalizeJwglxtCourse,
    normalizePracticeCourse,
    parseScheduleData,
    parseSections,
    parseWeekRange
  }
};
