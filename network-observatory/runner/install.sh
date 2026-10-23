#!/bin/sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  printf '%s\n' '请使用 sudo 运行此安装脚本。' >&2
  exit 1
fi

if command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1 && [ ! -d /run/systemd/system ]; then
  INIT_SYSTEM=openrc
elif command -v systemctl >/dev/null 2>&1; then
  INIT_SYSTEM=systemd
else
  printf '%s\n' '此安装脚本需要 systemd 或 OpenRC。' >&2
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
  if command -v apk >/dev/null 2>&1; then addgroup -S "$SERVICE_GROUP"; else groupadd --system "$SERVICE_GROUP"; fi
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  if command -v apk >/dev/null 2>&1; then
    adduser -S -D -H -G "$SERVICE_GROUP" -h /nonexistent -s "$NOLOGIN" "$SERVICE_USER"
  else
    useradd --system --gid "$SERVICE_GROUP" --no-create-home --home-dir /nonexistent --shell "$NOLOGIN" "$SERVICE_USER"
  fi
fi

install -d -o root -g root -m 0755 "$SERVICE_DIR"
install -d -o root -g "$SERVICE_GROUP" -m 0750 "$CONFIG_DIR"
install -d -o root -g root -m 0700 /var/lib/aster-network-observatory
install -o root -g root -m 0644 "$SCRIPT_DIR/http_receiver.py" "$SERVICE_DIR/http_receiver.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/native.py" "$SERVICE_DIR/native.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/public_speed.py" "$SERVICE_DIR/public_speed.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/tcp_quality.py" "$SERVICE_DIR/tcp_quality.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/agent.py" "$SERVICE_DIR/agent.py"
install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory.openrc" "$SERVICE_DIR/aster-network-observatory.openrc"
if [ "$INIT_SYSTEM" = openrc ]; then
  install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory.openrc" /etc/init.d/aster-network-observatory
  install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory-http.openrc" /etc/init.d/aster-network-observatory-http
else
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-agent.service" \
    /etc/systemd/system/aster-network-observatory-agent.service
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-probe@.service" \
    /etc/systemd/system/aster-network-observatory-probe@.service
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-http.service" /etc/systemd/system/aster-network-observatory-http.service
  systemctl daemon-reload
fi
printf '%s\n' "$INIT_SYSTEM" > "$CONFIG_DIR/service-manager"
PROFILE=${ASTER_INSTALL_PROFILE:-}
if [ -z "$PROFILE" ] && [ -f "$CONFIG_DIR/install-profile" ]; then PROFILE=$(cat "$CONFIG_DIR/install-profile"); fi
case "$PROFILE" in lite|full) ;; '') PROFILE=full ;; *) printf '%s\n' '无效的安装模式。' >&2; exit 1 ;; esac
printf '%s\n' "$PROFILE" > "$CONFIG_DIR/install-profile"
chmod 0644 "$CONFIG_DIR/service-manager" "$CONFIG_DIR/install-profile"

printf '%s\n' \
  '节点服务和探测器已安装。下一步请运行：' \
  '  sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure' \
  '向导验证一次性节点凭证后，会安全保存凭证并启用服务。'
