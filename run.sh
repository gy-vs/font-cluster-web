#!/usr/bin/env bash
# Build the frontend (if needed) and start the local inspection server.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-.venv/bin/python}"

if [ ! -x "$PYTHON" ]; then
  echo "未找到虚拟环境，正在创建 .venv 并安装依赖…"
  python3 -m venv --without-pip .venv
  if [ ! -f /tmp/pip.whl ]; then
    PIP_WHEEL_URL=$(python3 -c "
import json, urllib.request
d = json.load(urllib.request.urlopen('https://pypi.org/pypi/pip/json'))
print([u['url'] for u in d['urls'] if u['filename'].endswith('-py3-none-any.whl')][0])
" 2>/dev/null || true)
    if [ -n "${PIP_WHEEL_URL:-}" ]; then
      curl -sSL "$PIP_WHEEL_URL" -o /tmp/pip.whl
    fi
  fi
  if [ -f /tmp/pip.whl ]; then
    .venv/bin/python -c "
import zipfile, site
zipfile.ZipFile('/tmp/pip.whl').extractall(site.getsitepackages()[0])
"
  else
    .venv/bin/python -m ensurepip -y || true
  fi
  .venv/bin/python -m pip install -r requirements.txt
fi

if [ ! -d frontend/dist ] || [ "${1:-}" = "--build" ]; then
  echo "构建前端…"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi

PORT="${PORT:-8000}"
echo "启动服务： http://127.0.0.1:${PORT}  （API 文档 http://127.0.0.1:${PORT}/docs）"
exec "$PYTHON" -m uvicorn backend.app.main:app --host 127.0.0.1 --port "$PORT"
