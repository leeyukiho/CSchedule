import Taro from "@tarojs/taro";

import {
  getStoredAccountAccessToken,
  getStoredAccountId,
} from '../storage'

interface ApiResponse {
  statusCode: number;
  data: unknown;
}

export interface ApiRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  data?: TBody;
  header?: Record<string, string>;
}

function getRequestErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return normalizeApiErrorMessage(error.message);
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["errMsg", "message", "errorMessage"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return normalizeApiErrorMessage(value.trim());
      }
    }
  }

  return normalizeApiErrorMessage(String(error || "请求失败"));
}

function normalizeApiErrorMessage(message: string) {
  const text = String(message || '').trim()

  if (!text) {
    return '请求失败，请稍后再试'
  }

  const lower = text.toLowerCase()

  if (text.includes('SCHOOL_DISABLED') || text.includes('School not available')) {
    return '学校暂不可用，请稍后再试或联系管理员'
  }

  if (text.includes('School not found')) {
    return '学校不存在或已下线'
  }

  if (text.includes('Student account not found')) {
    return '账号不存在，请重新绑定'
  }

  if (text.includes('CACHE_NOT_READY')) {
    return '数据还在准备中，请稍后刷新'
  }

  if (text.includes('ACCOUNT_TOKEN_REQUIRED') || text.includes('ACCOUNT_TOKEN_INVALID')) {
    return '登录状态已失效，请重新绑定账号'
  }

  if (
    text.includes('INVALID_CREDENTIAL') ||
    text.includes('WTBU_INVALID_CREDENTIALS') ||
    text.includes('WHHXIT_INVALID_CREDENTIALS') ||
    lower.includes('invalid credential')
  ) {
    return '账号或密码错误，请检查后重试'
  }

  if (text.includes('SAVED_CREDENTIAL_REQUIRED') || text.includes('SESSION_EXPIRED')) {
    return '登录信息已失效，请重新登录教务系统'
  }

  if (text.includes('CLOUD_IMPORT_PROOF_REQUIRED') || text.includes('CLOUD_IMPORT_PROOF_INVALID')) {
    return '导入校验失败，请重新尝试'
  }

  if (text.includes('CLOUD_IMPORT_PROOF_EXPIRED')) {
    return '导入校验已过期，请重新尝试'
  }

  if (text.includes('CLOUD_SYNC_FAILED') || text.includes('CLOUD_SYNC_EMPTY_RESULT')) {
    return '教务系统暂时无法访问，请稍后再试'
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('request:fail')) {
    return '网络或教务系统响应超时，请稍后再试'
  }

  if (text.startsWith('API request failed') || /^HTTP\s+\d+$/i.test(text)) {
    return '服务器请求失败，请稍后再试'
  }

  if (text.includes('TARO_APP_API_BASE_URL is not configured')) {
    return '接口地址未配置，请联系管理员'
  }

  return text
}

function getAccountIdFromPath(path: string) {
  const match = path.match(/(?:^|\/)account\/([^/?#]+)/)

  if (!match) {
    return ''
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function getAccountIdFromBody(data: unknown) {
  const record = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { accountId?: unknown })
    : {}

  return typeof record.accountId === 'string' ? record.accountId : ''
}

function isSyncJobPath(path: string) {
  return /(?:^|\/)sync\/[^/?#]+/.test(path)
}

function getAccountAuthHeaders(options: ApiRequestOptions) {
  const accountId =
    getAccountIdFromPath(options.path) ||
    getAccountIdFromBody(options.data) ||
    (isSyncJobPath(options.path) ? getStoredAccountId() : '')
  const token = accountId ? getStoredAccountAccessToken(accountId) : ''

  if (!accountId || !token) {
    return {}
  }

  return {
    authorization: `Bearer ${token}`,
    'x-cschedule-account-id': accountId,
  }
}

export async function requestApi<TResponse, TBody = unknown>(
  options: ApiRequestOptions<TBody>,
): Promise<TResponse> {
  const baseUrl = String(process.env.TARO_APP_API_BASE_URL || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");

  if (!baseUrl) {
    throw new Error("TARO_APP_API_BASE_URL is not configured");
  }

  let response: ApiResponse;

  try {
    response = await Taro.request({
      url: `${baseUrl}${options.path}`,
      method: options.method || "GET",
      data: options.data,
      timeout: 10000,
      header: {
        "content-type": "application/json",
        ...getAccountAuthHeaders(options),
        ...options.header,
      },
    }) as ApiResponse;
  } catch (error) {
    throw new Error(getRequestErrorMessage(error));
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = response.data as
      | { message?: unknown; error?: unknown }
      | null
      | undefined;
    const responseMessage = data && data.message;
    const responseError = data && data.error;
    const message = Array.isArray(responseMessage)
      ? responseMessage.join("; ")
      : typeof responseMessage === "string"
        ? responseMessage
        : typeof responseError === "string"
          ? responseError
          : `API request failed: ${response.statusCode}`;

    throw new Error(normalizeApiErrorMessage(message));
  }

  return response.data as TResponse;
}
