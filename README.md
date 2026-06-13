# CSchedule

## 目录

- `frontend`：Taro 小程序前端
- `backend`：NestJS 后端
- `docs`：项目文档
- `wxapp`：小程序相关文件

## 后端配置

配置文件：`backend/.env`

首次使用：

```bash
cd backend
copy .env.example .env
```

需要填写：

| 变量 | 说明 | 本地示例 |
| --- | --- | --- |
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | 后端端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接串，供 Prisma 使用 | `postgresql://cschedule:cschedule@localhost:5433/cschedule?schema=public` |
| `CORS_ORIGIN` | 允许访问后端的前端地址 | `http://localhost:10086` |
| `ADMIN_API_KEY` | 管理接口密钥，生产环境必须改成随机强密钥 | `change-me-to-a-secure-random-string` |

注意：

- `DATABASE_URL` 里的用户名、密码、端口、数据库名要和本机 PostgreSQL 一致。
- `ADMIN_API_KEY` 不要提交真实值。
- 改完数据库连接后执行 Prisma 相关命令前，确认 `.env` 已生效。

## 前端配置

配置文件：

- `frontend/.env.development`：本地开发
- `frontend/.env.test`：测试环境
- `frontend/.env.production`：生产环境

需要填写：

| 变量 | 说明 | 本地示例 |
| --- | --- | --- |
| `TARO_APP_API_BASE_URL` | 后端 API 基础地址，必须包含 `/api/v1` | `http://localhost:3000/api/v1` |
| `TARO_APP_ID` | 小程序 AppID；没有可先不填 | `wx...` |

生产环境示例：

```env
TARO_APP_API_BASE_URL="https://api.example.com/api/v1"
TARO_APP_ID="wx..."
```

注意：

- 前端请求地址来自 `TARO_APP_API_BASE_URL`。
- 本地开发时，后端 `PORT=3000` 则前端填 `http://localhost:3000/api/v1`。
- 生产环境不要继续使用 `localhost`。

## 常用命令

运行、构建和部署说明请查看 [`docs/运行构建部署.md`](docs/运行构建部署.md)。

后端：

```bash
cd backend
npm install
npm run dev
```

前端：

```bash
cd frontend
npm install
npm run dev:weapp
```
