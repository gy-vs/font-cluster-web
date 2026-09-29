# 字体排版检查器（Font Shaping Inspector）

一个用来核对「一段文本在具体字体里到底被排版成了哪些字形」的网页工具。

- 上传一份 OpenType/TrueType（支持 `.ttf` `.otf` `.woff` `.woff2`）字体，看到字体**真实的名称与排版特性**；
- 输入文字，由**服务端 HarfBuzz** 完成排版，浏览器只渲染服务端返回的字形轮廓、坐标与字符关联，**不使用浏览器自身的文字排版**；
- 双向核对：点字形可看到它关联的原始文本（连字、多分字等一对多关系来自 HarfBuzz cluster，不是按显示顺序逐个配对）；选中输入文字可找到参与形成的字形；
- 可随时改文字、切换 LTR/RTL/TTB/BTT 方向、开关字体中真实存在的 GSUB/GPOS 特性并比较前后变化；
- 计算中只显示等待状态，不会把旧字体轮廓与新文本范围拼在一起；上传失败只提示本次失败，已打开的有效检查不受影响。

## 目录结构

```
backend/app/
  main.py        FastAPI：字体上传/样本、字体信息、排版接口（同时托管前端构建产物）
  sessions.py    HarfBuzz(uharfbuzz) 排版、字形轮廓提取、内存会话隔离
  font_info.py   读取 name 表真实名称与 GSUB/GPOS 特性清单
  features.py    特性标签可读名称与 HarfBuzz 默认开启集合
frontend/        React + TypeScript + Vite 前端（SVG 渲染服务端轮廓）
sample-fonts/    随项目附带的 DejaVu Sans（Bitstream Vera 许可，允许再分发，LICENSE 已保留）
tests/           后端 API 端到端测试
```

## 快速启动

```bash
./run.sh                 # 首次会创建 .venv、装 Python 依赖并构建前端
# 或手动：
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000 。页面首次打开会自动通过 `/api/samples/DejaVuSans.ttf/load`
载入随附样本——样本与上传字体走**完全相同**的解析与排版路径。

前端开发模式（热更新，API 走 Vite 代理到 8000）：

```bash
.venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd frontend && npm run dev
```

## HTTP 接口（无页面时也可直接调用）

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/fonts` | multipart 上传一个字体，返回 `sessionId` 与字体信息 |
| `POST` | `/api/samples/{key}/load` | 载入随附样本（同一解析路径） |
| `GET`  | `/api/fonts/{sessionId}` | 读取会话对应字体的信息 |
| `POST` | `/api/fonts/{sessionId}/shape` | 排版：`{text, direction, script?, language?, features:{tag:bool}}` |
| `GET`  | `/api/samples` | 可用样本列表 |
| `GET`  | `/api/health` | 健康检查 |

交互式文档：http://127.0.0.1:8000/docs 。

示例：

```bash
SID=$(curl -s -F "file=@MyFont.otf" http://127.0.0.1:8000/api/fonts | python3 -c "import json,sys;print(json.load(sys.stdin)['sessionId'])")
curl -s -X POST http://127.0.0.1:8000/api/fonts/$SID/shape \
  -H 'Content-Type: application/json' \
  -d '{"text":"ffi","direction":"auto","features":{"liga":false}}'
```

每个返回字形包含：

- `gid` / `name`：字形 ID 与字形名；
- `clusterStart`/`clusterEnd`：关联的原始文本**码点**区间；`utf16Start`/`utf16End` 为 textarea 用的 UTF-16 区间；
- `x`/`y` 与 `advanceX`/`advanceY`、`ink`/`slot`：笔位、前进量、墨痕盒与排版槽盒（字体设计单位，y 向上）；
- `outlines`：按 gid 去重的 SVG path（合成字形已分解）；
- `features`：每个特性本次实际的开/关、是否默认开、是否对当前脚本/语言适用。

## 会话隔离与安全

- 字体只保存在服务端内存的 `SessionStore`，会话 ID 为 `secrets.token_urlsafe(16)` 随机值；
- 没有任何按文件名读取、列举、下载字体的接口，其它会话无法通过文件名取走字体；
- 会话 2 小时不活动自动过期，上限 32 个（LRU 淘汰）；单文件上限 20MB；
- 解析失败返回 `400`，不会替换或影响已有会话。

## 前端交互要点

- 选择状态以**文本含义（码点区间）**锚定，重排后按相同文本内容在新结果中重新定位字形，而不是沿用上一轮相同序号；
- 发起新排版即清空画布并显示遮罩，避免旧轮廓/新范围错配；过时请求用 AbortController 取消；
- SVG 画布支持滚轮缩放、按钮缩放、拖动平移、一键适应；
- 「复制当前排版结果」会把每个字形的 gid、名称、字符/UTF-16 区间、笔位、关联文本复制成 TSV。

## 测试

```bash
.venv/bin/python -m pytest tests/ -q          # 后端：上传/失败隔离/连字/RTL/多字节等
cd frontend && npm test                       # 前端：码点↔UTF-16 区间换算
```

浏览器端到端检查（Playwright，覆盖真实上传、双向选择、特性/方向切换、等待态与失败隔离）验证项包括：
`ffi` 连字为 1 字形对应 3 字符、关闭 `liga` 后文本选择重新匹配 2 个 `f`、
阿拉伯文自动 RTL 与强制 LTR、TTB、表情代理对 UTF-16 区间 (1,3) 与 U+1F603 显示等。

## 样本字体许可

`sample-fonts/DejaVuSans.ttf` 来自 DejaVu Fonts，基于 Bitstream Vera License 发布，
DejaVu 修改部分为公有领域，允许再分发；完整许可文本见 `sample-fonts/LICENSE`。
