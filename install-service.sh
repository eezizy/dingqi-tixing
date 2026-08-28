#!/usr/bin/env bash
set -euo pipefail
# 定时提醒 · systemd 守护一键安装（开机自启 + 崩溃自动拉起）
#
# 用法（需 root）：
#   bash install-service.sh            # 已在网页「⚙设置 → 🔐 管理登录」设过登录密码时
#   bash install-service.sh 你的密码   # 尚未在网页设过密码时，用 env 兜底
#
# 脚本自动完成：检测 node 路径 → 停掉旧 nohup 进程 → 写 /etc/systemd/system/dingqi.service
#               → 开机自启 + 启动 → 健康检查

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(command -v node || echo /usr/local/bin/node)"
AUTH_PASS="${1:-}"

if [[ $EUID -ne 0 ]]; then
  echo "请用 root 运行：sudo bash install-service.sh" >&2
  exit 1
fi

# 是否已网页设过密码（settings.json 含 auth_user）
HAS_AUTH=0
if [[ -f "${APP_DIR}/data/settings.json" ]] && grep -q "auth_user" "${APP_DIR}/data/settings.json"; then
  HAS_AUTH=1
fi

if [[ $HAS_AUTH -eq 0 && -z "$AUTH_PASS" ]]; then
  echo "尚未在网页设置登录密码。请先网页设置，或运行：bash install-service.sh 你的密码" >&2
  exit 1
fi

# 停掉旧的 nohup / 手动 node 进程，避免抢 8080 端口
pkill -f "node server.js" 2>/dev/null || true
sleep 2

# 仅在未网页设密码时注入 env 兜底
ENV_BLOCK=""
if [[ $HAS_AUTH -eq 0 && -n "$AUTH_PASS" ]]; then
  ENV_BLOCK="Environment=AUTH_USER=admin"$'\n'"Environment=AUTH_PASS=${AUTH_PASS}"
fi

cat > /etc/systemd/system/dingqi.service <<EOF
[Unit]
Description=Dingqi Tixing Reminder Service
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} server.js
Restart=always
RestartSec=3
User=root
${ENV_BLOCK}
StandardOutput=append:${APP_DIR}/run.log
StandardError=append:${APP_DIR}/run.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dingqi
systemctl restart dingqi

sleep 2
echo "=== systemctl status ==="
systemctl status dingqi --no-pager | head -n 6
echo "=== 健康检查 ==="
curl -s http://127.0.0.1:8080/api/health || echo "health 失败，请查 run.log"
