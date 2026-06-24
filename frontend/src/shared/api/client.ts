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
    return error.message;
  }

  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    for (const key of ["errMsg", "message", "errorMessage"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }

  return String(error || "API request failed");
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

    throw new Error(message);
  }

  return response.data as TResponse;
}
