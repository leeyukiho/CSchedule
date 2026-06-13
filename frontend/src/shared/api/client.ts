import Taro from '@tarojs/taro'

export interface ApiRequestOptions<TBody = unknown> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  data?: TBody
  header?: Record<string, string>
}

export async function requestApi<TResponse, TBody = unknown>(
  options: ApiRequestOptions<TBody>,
): Promise<TResponse> {
  const baseUrl = process.env.TARO_APP_API_BASE_URL || 'http://localhost:3000/api/v1'
  const response = await Taro.request<TResponse>({
    url: `${baseUrl}${options.path}`,
    method: options.method || 'GET',
    data: options.data,
    header: {
      'content-type': 'application/json',
      ...options.header,
    },
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = response.data as { message?: unknown; error?: unknown }
    const message = Array.isArray(data?.message)
      ? data.message.join('；')
      : typeof data?.message === 'string'
        ? data.message
        : typeof data?.error === 'string'
          ? data.error
          : `API request failed: ${response.statusCode}`

    throw new Error(message)
  }

  return response.data
}
