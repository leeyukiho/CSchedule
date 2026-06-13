# 华夏理工学院与 WTBU 差异补充

## 结论

华夏理工学院不能直接复用 WTBU 的 EAMS 适配逻辑。

WTBU 是 EAMS，课表来自 `TaskActivity` HTML/JS 脚本解析；华夏理工学院是正方 `jwglxt` V9.0，课表来自 JSON 接口。

## 关键差异

| 项目 | WTBU | 华夏理工学院 |
| --- | --- | --- |
| 教务系统 | EAMS | 正方教务 `jwglxt` |
| 登录入口 | `/eams/home.action` | `/jwglxt/xtgl/login_slogin.html` |
| 登录提交 | `/eams/login.action` | 登录页表单提交，进入 `index_initMenu.html?jsdm=xs` |
| 密码处理 | `SHA1(salt + password)` | 页面脚本/表单处理，已验证可通过页面交互登录 |
| 验证码 | 当前不需要 | 当前不需要 |
| 课表入口 | `/eams/courseTableForStd.action` | `/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151` |
| 课表接口 | `/eams/courseTableForStd!courseTable.action` | `/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151` |
| 请求方式 | 先取 `ids` 和 `semester.id`，再 POST | POST `xnm`、`xqm` 即可返回 JSON |
| 返回格式 | HTML/JS | JSON |
| 主要解析对象 | `TaskActivity` | `kbList`、`sjkList` |
| 学期参数 | `semester.id` | `xnm` + `xqm`，其中 `3/12/16` 对应第 1/2/3 学期 |
| TLS 注意点 | WTBU 文档记录需要限定域名的 `rejectUnauthorized: false` | 本次 Firecrawl 验证未发现必须复用 WTBU TLS 兼容逻辑 |

## 需要立刻注意的不同点

- 不要把 WTBU 的 `TaskActivity` parser 用到华夏理工学院。
- 不要把 WTBU 的 `ids`、`semester.id` 参数模型用到华夏理工学院。
- 不要把 WTBU 的动态 salt + SHA1 登录假设套到华夏理工学院。
- 华夏理工学院课表接口返回 `application/json;charset=UTF-8`，适配层应直接解析 JSON。
- 华夏理工学院 `kbList` 和 `sjkList` 都要处理；只读 `kbList` 会漏掉实践课、课外课或网络课。

## Provider 拆分建议

```text
wtbuProvider
  system: EAMS
  login: salt + SHA1
  course: TaskActivity parser

whhxitProvider
  system: ZF jwglxt
  login: jwglxt form session
  course: xskbcx JSON parser
```

两者只应该共享统一的 `Course` 输出模型、CookieJar/session 抽象和错误码映射，不应共享登录器和课表 parser。
