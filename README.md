# 字形排版检查 · Shaping Inspector

服务端用 HarfBuzz（`uharfbuzz`）做真正的 OpenType/TrueType 排版计算，用
fontTools 读取字体名称、排版特性和字形轮廓；浏览器只负责把**这一次**服务端
计算返回的轮廓、位置和字符关联画出来，不使用浏览器自身的文字排版。

## 目录

- `backend/` — FastAPI 服务（上传、字体信息、排版计算接口）
- `frontend/` — React + TypeScript + Vite 前端
- `sample/` — 随项目提供的可再分发样本字体（Amiri，SIL OFL 1.1，含 `OFL.txt`）

## 本地启动

需要 Python 3.10+、Node 18+。

```bash
# 1) 后端依赖
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2) 构建前端
cd frontend && npm install && npm run build

# 3) 启动（一个进程同时提供 API 和已构建的前端页面）
.venv/bin/python -m uvicorn --app-dir backend app:app --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000 ，首次打开会通过和手动上传**完全相同的接口路径**载入
`sample/amiri-regular.ttf`。

开发模式（前端热更新）：

```bash
# 终端 A
.venv/bin/python -m uvicorn --app-dir backend app:app --reload --port 8000
# 终端 B
cd frontend && npm run dev   # http://127.0.0.1:5173 ，/api 已代理到 8000
```

## 不依赖页面直接调用接口

```bash
# 上传字体，得到仅本次会话可用的 session_id
curl -F "file=@sample/amiri-regular.ttf" http://127.0.0.1:8000/api/fonts

# 查看字体真实名称、字符数、GSUB/GPOS 特性、坐标轴
curl http://127.0.0.1:8000/api/fonts/$SESSION_ID

# 排版计算：返回字形序列、位置、轮廓(d)和每个字形对应的输入码点区间
curl -X POST http://127.0.0.1:8000/api/shape \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"...","text":"office لا","direction":"auto","features":{"liga":true}}'
```

会话只保存在服务进程内存中，重启即失效；字体只与不可猜测的 `session_id`
绑定，没有按文件名读取的接口，其他会话无法互相访问。
