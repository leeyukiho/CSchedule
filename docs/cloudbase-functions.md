# CloudBase 云函数部署

项目只保留按学校拆分的专用同步函数。前端不会再回退到通用 parser 或通用 provider worker。

当前函数：

- `syncWtbu`：武汉工商学院专用同步函数，按 `target` 分别同步 `course`、`profile`、`score`、`exam`。
- `syncBwu`：北京物资学院专用同步函数，先完成 WebVPN/CAS 登录并通过 SSO 进入 EAMS，再按 `target` 分别同步 `course`、`profile`、`score`、`exam`。
- `syncWhhxit`：武汉华夏理工学院专用同步函数，按 `target` 分别同步 `course`、`profile`、`score`、`exam`。
- `syncWdu`：武汉东湖学院专用同步函数，按 `target` 分别同步 `course`、`profile`、`score`、`exam`。

## 配置环境

`cloudbaserc.json` 中的 `envId` 和 `region` 需要指向当前 CloudBase 环境。

前端只需要配置：

```bash
TARO_APP_CLOUDBASE_ENV_ID=你的环境ID
```

后端自动同步也调用同一组学校专用云函数，不再直接请求学校教务外网。后端需要配置：

```bash
CSCHEDULE_WORKER_SECRET=可选的后端到云函数共享密钥
```

后端同步只通过 `cloudFunctions.<target>.url` 调用 HTTP 触发器；`functionName` 仍可用于小程序首次导入直接调用云函数。

具体函数名由后端学校配置下发，例如 `connected-schools.json` 中的：

```json
{
  "providerConfig": {
    "cloudFunctions": {
      "course": { "functionName": "syncWtbu" }
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
cloudbase fn run --path cloudfunctions/syncWtbu --params "{\"source\":\"frontend_first_import\",\"schoolId\":\"wtbu\",\"providerId\":\"wtbu\",\"target\":\"course\",\"username\":\"学号\",\"password\":\"密码\"}"
cloudbase fn run --path cloudfunctions/syncBwu --params "{\"source\":\"frontend_first_import\",\"schoolId\":\"bwu\",\"providerId\":\"bwu\",\"targets\":[\"course\",\"profile\",\"score\",\"exam\"],\"username\":\"学号\",\"password\":\"密码\"}"
cloudbase fn run --path cloudfunctions/syncWdu --params "{\"source\":\"frontend_first_import\",\"schoolId\":\"wdu\",\"providerId\":\"wdu\",\"targets\":[\"course\",\"profile\",\"score\",\"exam\"],\"username\":\"学号\",\"password\":\"密码\"}"
```

## 数据边界

云函数只返回标准 `cacheResults` 数组。前端把 `cacheResults` 提交给后端保存，不再同时传 `cacheData` 和 `cacheResults`。

WebView 导入只接受学校页面返回的结构化 JSON，并直接上传后端 `raw-data` 接口，不再通过通用云 parser 中转。
