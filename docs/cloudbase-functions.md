# CloudBase 云函数部署

项目只保留按学校拆分的专用同步函数。前端不会再回退到通用 parser 或通用 provider worker。

当前函数：

- `syncWtbu`：武汉工商学院专用同步函数，按 `target` 分别同步 `course`、`profile`、`score`、`exam`。
- `syncBwu`：北京物资学院专用同步函数，先完成 WebVPN/CAS 登录并通过 SSO 进入 EAMS，再按 `target` 分别同步 `course`、`profile`、`score`、`exam`。
- `syncWhhxit`：武汉华夏理工学院专用同步函数，按 `target` 分别同步 `course`、`profile`、`score`、`exam`。
- `syncWdu`：武汉东湖学院专用同步函数，按 `target` 分别同步 `course`、`profile`、`score`、`exam`。

## 配置环境

`cloudbaserc.json` 中的 `envId` 和 `region` 需要指向当前 CloudBase 环境。

客户端不需要配置 CloudBase 环境 ID，也不直接调用云函数。后端自动同步调用学校专用云函数，后端和云函数都需要配置同一个内部密钥：

```bash
CSCHEDULE_WORKER_SECRET=change-me-to-a-secure-random-worker-secret
```

后端同步通过 `cloudFunctions.<target>.url` 调用 HTTP 触发器，并使用 `x-cschedule-worker-secret` 做服务端鉴权。

首次绑定导入可以由前端直接调用云函数 HTTP URL，用来降低应用服务器带宽压力。这个链路不能携带 worker secret：前端先从后端 `login-context` 获取短期 `clientImportToken`，云函数校验该令牌后登录学校系统并返回 `cloudProof` 签名，前端再把 `cacheResults + cloudProof` 提交给后端完成账号绑定和缓存入库。后端只接受签名匹配的云函数结果。

具体函数名由后端学校配置下发，例如 `connected-schools.json` 中的：

```json
{
  "providerConfig": {
    "cloudFunctions": {
      "course": { "url": "https://your-cloud-function-url.example.com" }
    }
  }
}
```

## 部署

```bash
cloudbase fn deploy syncWtbu --dir cloudfunctions/syncWtbu
cloudbase fn deploy syncBwu --dir cloudfunctions/syncBwu
cloudbase fn deploy syncWhhxit --dir cloudfunctions/syncWhhxit
cloudbase fn deploy syncWdu --dir cloudfunctions/syncWdu
```

本地调试：

```bash
cloudbase login
curl -X POST "https://your-cloud-function-url.example.com" -H "content-type: application/json" -H "x-cschedule-worker-secret: $CSCHEDULE_WORKER_SECRET" -d "{\"source\":\"backend_auto_sync\",\"schoolId\":\"wtbu\",\"providerId\":\"wtbu\",\"targets\":[\"course\",\"profile\",\"score\",\"exam\"],\"username\":\"学号\",\"password\":\"密码\"}"
```

## 数据边界

云函数只返回标准 `cacheResults` 数组，并只返回给后端。客户端不接收、不转发云函数的凭据同步结果。

WebView 导入只接受学校页面返回的结构化 JSON，并直接上传后端 `raw-data` 接口，不再通过通用云 parser 中转。
