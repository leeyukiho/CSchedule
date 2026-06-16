# CloudBase 云函数部署

本项目的云函数只用于高价值任务：

- `parseRawPayload`：前端 WebView 抓到 raw payload 后，优先在云函数解析为标准缓存 JSON。
- `runProviderSync`：预留的云端 provider worker，占位实现不会执行真实账号同步。

## 配置环境

`cloudbaserc.json` 里的 `envId` 默认是占位值。首次部署前用你的环境 ID 替换：

```json
{
  "envId": "你的 CloudBase 环境 ID"
}
```

也可以部署时用命令参数指定环境。

## 部署函数

你已经安装了 `@cloudbase/cli`，在项目根目录运行：

```bash
cloudbase fn deploy parseRawPayload --dir cloudfunctions/parseRawPayload
cloudbase fn deploy runProviderSync --dir cloudfunctions/runProviderSync
```

如果 CLI 要求选择环境，按提示选择对应 CloudBase 环境。

本地调试需要先登录：

```bash
cloudbase login
cloudbase fn run --path cloudfunctions/parseRawPayload --params "{\"schoolId\":\"demo\",\"providerId\":\"demo\",\"target\":\"course\",\"contentType\":\"json\",\"payload\":{\"courses\":[]}}"
```

## 前端变量

前端默认不启用云函数。启用微信云函数直连：

```bash
TARO_APP_CLOUDBASE_ENV_ID=你的环境ID
TARO_APP_CLOUD_PARSER_FUNCTION=parseRawPayload
```

如果使用 HTTP 触发器或云托管网关，则配置：

```bash
TARO_APP_CLOUD_PARSER_URL=https://你的函数HTTP地址
```

配置 `TARO_APP_CLOUD_PARSER_URL` 时，前端会优先走 HTTP 地址；否则在微信小程序环境中使用 `Taro.cloud.callFunction`。

## 当前边界

`parseRawPayload` starter 版本只接受已经结构化的 JSON payload，并把它标准化为 `TimetableCacheResponse` 或 `FeatureCacheResponse`。复杂 HTML parser 需要按学校逐步补在该函数内，不能让自有后端代理大 HTML。

`runProviderSync` 目前是受控占位。只有当某个 provider 明确支持稳定账号密码登录、凭据传递和回调验签都完成后，才把该 provider 的同步执行迁到云函数。
