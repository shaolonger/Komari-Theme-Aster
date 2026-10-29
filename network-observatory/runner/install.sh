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
if [ "${ASTER_ENABLE_TCPQUALITY_FULL:-0}" = 1 ]; then
  # Updating a machine with existing identities must stop and migrate every
  # worker transactionally before the root helper can become available.
  if [ -f "$CONFIG_DIR/agent.json" ]; then
    printf '%s\n' '检测到现有探测器；请使用一键安装器 --upgrade --enable-tcpquality-full，以安全迁移并保留凭证。' >&2; exit 1
  fi
  for config in "$CONFIG_DIR"/probe-*.json; do
    if [ -f "$config" ]; then
      printf '%s\n' '检测到现有测量点；请使用一键安装器 --upgrade --enable-tcpquality-full，以安全迁移并保留凭证。' >&2; exit 1
    fi
  done
fi
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
SERVICE_UID=$(id -u "$SERVICE_USER")
SERVICE_GID=$(id -g "$SERVICE_USER")
EXPECTED_GID=$(getent group "$SERVICE_GROUP" | cut -d: -f3)
case "$SERVICE_UID:$SERVICE_GID:$EXPECTED_GID" in
  *[!0-9:]*|:*|*::*|*:|0:*|*:0:*|*:0)
    printf '%s\n' 'aster-netobs 必须使用非 root UID 和独立主组；请检查系统账户配置。' >&2; exit 1 ;;
esac
if [ "$SERVICE_GID" != "$EXPECTED_GID" ]; then
  printf '%s\n' 'aster-netobs 的主组与服务组不一致；请检查系统账户配置。' >&2; exit 1
fi

install -d -o root -g root -m 0755 "$SERVICE_DIR"
install -d -o root -g "$SERVICE_GROUP" -m 0750 "$CONFIG_DIR"
install -d -o root -g "$SERVICE_GROUP" -m 0750 /var/lib/aster-network-observatory
install -o root -g root -m 0644 "$SCRIPT_DIR/http_receiver.py" "$SERVICE_DIR/http_receiver.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/native.py" "$SERVICE_DIR/native.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/public_speed.py" "$SERVICE_DIR/public_speed.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/tcp_quality.py" "$SERVICE_DIR/tcp_quality.py"
for name in tcpquality_full.py nodequality_full.py tcpquality_helper.py aster-network-observatory-tcpquality.service aster-network-observatory-tcpquality.openrc; do
  install -o root -g root -m 0644 "$SCRIPT_DIR/$name" "$SERVICE_DIR/$name"
done
install -o root -g root -m 0644 "$SCRIPT_DIR/agent.py" "$SERVICE_DIR/agent.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/updater.py" "$SERVICE_DIR/updater.py"
install -o root -g root -m 0644 "$SCRIPT_DIR/release.json" "$SERVICE_DIR/release.json"
for name in aster-network-observatory-update.service aster-network-observatory-update.timer aster-network-observatory-update.openrc; do
  install -o root -g root -m 0644 "$SCRIPT_DIR/$name" "$SERVICE_DIR/$name"
done
install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory.openrc" "$SERVICE_DIR/aster-network-observatory.openrc"
if [ "$INIT_SYSTEM" = openrc ]; then
  install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory-tcpquality.openrc" /etc/init.d/aster-network-observatory-tcpquality
  install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory.openrc" /etc/init.d/aster-network-observatory
  install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory-http.openrc" /etc/init.d/aster-network-observatory-http
  install -o root -g root -m 0755 "$SCRIPT_DIR/aster-network-observatory-update.openrc" /etc/init.d/aster-network-observatory-update
else
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-agent.service" \
    /etc/systemd/system/aster-network-observatory-agent.service
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-probe@.service" \
    /etc/systemd/system/aster-network-observatory-probe@.service
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-http.service" /etc/systemd/system/aster-network-observatory-http.service
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-update.service" /etc/systemd/system/aster-network-observatory-update.service
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-update.timer" /etc/systemd/system/aster-network-observatory-update.timer
  install -o root -g root -m 0644 "$SCRIPT_DIR/aster-network-observatory-tcpquality.service" /etc/systemd/system/aster-network-observatory-tcpquality.service
  systemctl daemon-reload
fi
printf '%s\n' "$INIT_SYSTEM" > "$CONFIG_DIR/service-manager"
PROFILE=${ASTER_INSTALL_PROFILE:-}
if [ -z "$PROFILE" ] && [ -f "$CONFIG_DIR/install-profile" ]; then PROFILE=$(cat "$CONFIG_DIR/install-profile"); fi
case "$PROFILE" in lite|full) ;; '') PROFILE=full ;; *) printf '%s\n' '无效的安装模式。' >&2; exit 1 ;; esac
printf '%s\n' "$PROFILE" > "$CONFIG_DIR/install-profile"
chmod 0644 "$CONFIG_DIR/service-manager" "$CONFIG_DIR/install-profile"
if [ "$INIT_SYSTEM" = openrc ]; then
  if [ "${ASTER_ENABLE_TCPQUALITY_FULL:-0}" = 1 ]; then
    rc-update add aster-network-observatory-tcpquality default
    if ! rc-service aster-network-observatory-tcpquality status >/dev/null 2>&1; then rc-service aster-network-observatory-tcpquality start; fi
  fi
  rc-update add aster-network-observatory-update default
  if ! rc-service aster-network-observatory-update status >/dev/null 2>&1; then rc-service aster-network-observatory-update start; fi
else
  if [ "${ASTER_ENABLE_TCPQUALITY_FULL:-0}" = 1 ]; then systemctl enable --now aster-network-observatory-tcpquality.service; fi
  systemctl enable --now aster-network-observatory-update.timer
fi

printf '%s\n' \
  '节点服务和探测器已安装。下一步请运行：' \
  '  sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure' \
  '向导验证一次性节点凭证后，会安全保存凭证并启用服务。'
