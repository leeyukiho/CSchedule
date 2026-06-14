# CSchedule

项目只维护以下目录：

- `frontend`：前端
- `backend`：后端
- `docs`：文档

配置文件：

前端：修改 `frontend/.env.development` 或 `frontend/.env.production`。

| 变量 | 含义 |
| --- | --- |
| `TARO_APP_API_BASE_URL` | 后端 API 地址，需包含 `/api/v1` |
| `TARO_APP_ID` | 小程序 AppID，没有可先不填 |

后端：复制 `backend/.env.example` 为 `backend/.env` 后修改。

| 变量 | 含义 |
| --- | --- |
| `NODE_ENV` | 运行环境，如 `development`、`production` |
| `PORT` | 后端服务端口 |
| `DATABASE_URL` | PostgreSQL 数据库连接地址 |
| `CORS_ORIGIN` | 允许访问后端的前端地址 |
| `ADMIN_API_KEY` | 管理接口密钥，生产环境必须改成强随机值 |

微信开发者工具：

执行 `cd frontend && pnpm dev:weapp` 后，导入 `frontend/dist` 目录。

运行、构建和部署请查看 [`docs/运行构建部署.md`](docs/运行构建部署.md)。
管理员后台页面：frontend/admin-frontend/index.html
