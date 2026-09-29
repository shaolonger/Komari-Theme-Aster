#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' '请使用 sudo 运行此安装脚本。' >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  printf '%s\n' '此安装脚本需要 systemd/systemctl。' >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' '缺少 Python 3。请先安装 python3。' >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
SERVICE_USER=aster-netobs
SERVICE_GROUP=aster-netobs
SERVICE_DIR=/usr/local/libexec/aster-network-observatory
CONFIG_DIR=/etc/aster-network-observatory
NOLOGIN=$(command -v nologin || true)
if [ -z "$NOLOGIN" ]; then
  NOLOGIN=/usr/sbin/nologin
fi

if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
  groupadd --system "$SERVICE_GROUP"
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --gid "$SERVICE_GROUP" --no-create-home --home-dir /nonexistent --shell "$NOLOGIN" "$SERVICE_USER"
fi

install -d -o root -g root -m 0755 "$SERVICE_DIR"
install -d -o root -g "$SERVICE_GROUP" -m 0750 "$CONFIG_DIR"
install -o root -g root -m 0755 "$SCRIPT_DIR/probe.sh" "$SERVICE_DIR/probe.sh"
install -o root -g root -m 0644 "$SCRIPT_DIR/speedtest.py" "$SERVICE_DIR/speedtest.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/agent.py" "$SERVICE_DIR/agent.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-agent.service" \
  /etc/systemd/system/aster-network-observatory-agent.service
systemctl daemon-reload

printf '%s\n' \
  '节点服务和探测器已安装。下一步请运行：' \
  '  sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure' \
  '向导验证一次性节点凭证后，会安全保存凭证并启用 systemd 服务。'
