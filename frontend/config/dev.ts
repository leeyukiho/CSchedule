import type { UserConfigExport } from "@tarojs/cli";

const API_BASE_URL =
  process.env.TARO_APP_API_BASE_URL || "http://localhost:3000/api/v1";
const CLOUDBASE_ENV_ID = process.env.TARO_APP_CLOUDBASE_ENV_ID || "";
const CLOUD_PARSER_FUNCTION =
  process.env.TARO_APP_CLOUD_PARSER_FUNCTION || "parseRawPayload";
const CLOUD_PARSER_URL = process.env.TARO_APP_CLOUD_PARSER_URL || "";
const CLOUD_SYNC_FUNCTION =
  process.env.TARO_APP_CLOUD_SYNC_FUNCTION || "runProviderSync";
const CLOUD_SYNC_URL = process.env.TARO_APP_CLOUD_SYNC_URL || "";

export default {
  logger: {
    quiet: false,
    stats: true,
  },
  defineConstants: {
    "process.env.TARO_APP_API_BASE_URL": JSON.stringify(API_BASE_URL),
    "process.env.TARO_APP_CLOUDBASE_ENV_ID": JSON.stringify(CLOUDBASE_ENV_ID),
    "process.env.TARO_APP_CLOUD_PARSER_FUNCTION": JSON.stringify(CLOUD_PARSER_FUNCTION),
    "process.env.TARO_APP_CLOUD_PARSER_URL": JSON.stringify(CLOUD_PARSER_URL),
    "process.env.TARO_APP_CLOUD_SYNC_FUNCTION": JSON.stringify(CLOUD_SYNC_FUNCTION),
    "process.env.TARO_APP_CLOUD_SYNC_URL": JSON.stringify(CLOUD_SYNC_URL),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport<"webpack5">;
