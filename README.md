# CSchedule 仓库管理

## 导入

本地保持三个目录：

- `frontend`：前端独立仓库
- `backend`：后端独立仓库
- `docs`：项目文档

GitHub 使用一个总仓库：

```bash
git clone https://github.com/leeyukiho/CSchedule.git
```

## 管理

前后端本地分别管理：

```bash
cd frontend
git status

cd ../backend
git status
```

总仓库只用于发布整合版本，内容只包含：

- `frontend`
- `backend`
- `docs`
- `README.md`

## 上传

从项目根目录执行发布：

```bash
git add frontend backend docs README.md
git commit -m "chore: update cschedule"
git push origin main
```
