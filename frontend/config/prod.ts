import type { UserConfigExport } from "@tarojs/cli";

// 默认生产后端地址，配置云数据库和生产服务后把下面的本地地址替换为它。
// const DEFAULT_PRODUCTION_API_BASE_URL = 'https://your-production-domain.com/api/v1'
const API_BASE_URL =
  process.env.TARO_APP_API_BASE_URL || "http://localhost:3000/api/v1";
const CLOUDBASE_ENV_ID = process.env.TARO_APP_CLOUDBASE_ENV_ID || "";

export default {
  defineConstants: {
    "process.env.TARO_APP_API_BASE_URL": JSON.stringify(API_BASE_URL),
    "process.env.TARO_APP_CLOUDBASE_ENV_ID": JSON.stringify(CLOUDBASE_ENV_ID),
  },
  mini: {},
  h5: {
    /**
     * WebpackChain 插件配置
     * @docs https://github.com/neutrinojs/webpack-chain
     */
    // webpackChain (chain) {
    //   /**
    //    * 如果 h5 端编译后体积过大，可以使用 webpack-bundle-analyzer 插件对打包体积进行分析。
    //    * @docs https://github.com/webpack-contrib/webpack-bundle-analyzer
    //    */
    //   chain.plugin('analyzer')
    //     .use(require('webpack-bundle-analyzer').BundleAnalyzerPlugin, [])
    //   /**
    //    * 如果 h5 端首屏加载时间过长，可以使用 prerender-spa-plugin 插件预加载首页。
    //    * @docs https://github.com/chrisvfritz/prerender-spa-plugin
    //    */
    //   const path = require('path')
    //   const Prerender = require('prerender-spa-plugin')
    //   const staticDir = path.join(__dirname, '..', 'dist')
    //   chain
    //     .plugin('prerender')
    //     .use(new Prerender({
    //       staticDir,
    //       routes: [ '/pages/index/index' ],
    //       postProcess: (context) => ({ ...context, outputPath: path.join(staticDir, 'index.html') })
    //     }))
    // }
  },
} satisfies UserConfigExport<"webpack5">;
