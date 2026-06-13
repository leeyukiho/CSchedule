import type { UserConfigExport } from "@tarojs/cli";

const API_BASE_URL =
  process.env.TARO_APP_API_BASE_URL || "http://localhost:3000/api/v1";

export default {
  logger: {
    quiet: false,
    stats: true,
  },
  defineConstants: {
    "process.env.TARO_APP_API_BASE_URL": JSON.stringify(API_BASE_URL),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport<"webpack5">;
