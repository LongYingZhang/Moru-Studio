#!/bin/zsh

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8787}"
BASE_URL="http://127.0.0.1:${PORT}"
START_URL="${BASE_URL}/admin/#/orders"

ADMIN_PAGE="$(curl --silent --fail --max-time 1 "${BASE_URL}/admin/" 2>/dev/null || true)"
if [[ "$ADMIN_PAGE" == *"LONGYING SHOP 商品管理后台"* ]]; then
  open "$START_URL"
  exit 0
fi

EXISTING_PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$EXISTING_PID" ]]; then
  EXISTING_COMMAND="$(ps -p "$EXISTING_PID" -o command= 2>/dev/null || true)"
  if [[ "$EXISTING_COMMAND" == *"http.server"* || "$EXISTING_COMMAND" == *"server.py"* ]]; then
    kill "$EXISTING_PID"
    sleep 0.3
  else
    echo "端口 ${PORT} 已被其他程序占用，请先关闭占用程序后重试。"
    read -r "?按回车键关闭窗口…"
    exit 1
  fi
fi

nohup python3 "$ROOT_DIR/server.py" >"$ROOT_DIR/.server.log" 2>&1 &
echo "$!" >"$ROOT_DIR/.server.pid"

for _ in {1..30}; do
  if curl --silent --fail --max-time 1 "${BASE_URL}/admin/" >/dev/null 2>&1; then
    open "$START_URL"
    exit 0
  fi
  sleep 0.1
done

echo "网站启动失败，请查看 $ROOT_DIR/.server.log"
read -r "?按回车键关闭窗口…"
exit 1
