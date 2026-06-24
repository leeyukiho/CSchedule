import type { UserConfigExport } from "@tarojs/cli";

const API_BASE_URL =
  process.env.TARO_APP_API_BASE_URL || "http://localhost:3000/api/v1";
const WECHAT_DAILY_COURSE_TEMPLATE_ID =
  process.env.TARO_APP_WECHAT_DAILY_COURSE_TEMPLATE_ID || "";
const WECHAT_EXAM_TEMPLATE_ID =
  process.env.TARO_APP_WECHAT_EXAM_TEMPLATE_ID || "";

export default {
  logger: {
    quiet: true,
    stats: false,
  },
  defineConstants: {
    "process.env.TARO_APP_API_BASE_URL": JSON.stringify(API_BASE_URL),
    "process.env.TARO_APP_WECHAT_DAILY_COURSE_TEMPLATE_ID": JSON.stringify(WECHAT_DAILY_COURSE_TEMPLATE_ID),
    "process.env.TARO_APP_WECHAT_EXAM_TEMPLATE_ID": JSON.stringify(WECHAT_EXAM_TEMPLATE_ID),
  },
  mini: {},
  h5: {},
} satisfies UserConfigExport<"webpack5">;
