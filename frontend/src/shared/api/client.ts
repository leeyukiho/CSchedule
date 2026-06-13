import Taro from "@tarojs/taro";

export interface ApiRequestOptions<TBody = unknown> {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  data?: TBody;
  header?: Record<string, string>;
}

export async function requestApi<TResponse, TBody = unknown>(
  options: ApiRequestOptions<TBody>,
): Promise<TResponse> {
  const baseUrl = process.env.TARO_APP_API_BASE_URL;
  const response = await Taro.request<TResponse>({
    url: `${baseUrl}${options.path}`,
    method: options.method || "GET",
    data: options.data,
    header: {
      "content-type": "application/json",
      ...options.header,
    },
  });

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

  return response.data;
}
