# CSchedule 仓库管理

## 导入

```bash
git clone https://github.com/leeyukiho/CSchedule.git
```

本地保持：

- `frontend`：前端独立仓库
- `backend`：后端独立仓库
- `CSchedule`：GitHub 总仓库

## 管理

```bash
cd frontend && git status
cd ../backend && git status
```

GitHub 总仓库只保留：

- `frontend`
- `backend`
- `docs`
- `README.md`

## 上传

```bash
git add frontend backend docs README.md
git commit -m "chore: update cschedule"
git push origin main
```
