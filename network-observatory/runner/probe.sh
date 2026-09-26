#!/bin/sh
set -u

MAX_OUTPUT_BYTES=36000
TEMP_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/aster-network.XXXXXX")" || exit 70
trap 'rm -f "$TEMP_OUTPUT"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

MODE="${1:-}"
TARGET="${2:-}"
PORT="${3:-5201}"
EXIT_CODE=0

case "$MODE" in tcpquality-route|tcpquality-intl|tcpquality-all) TARGET=default ;; esac

case "$MODE" in
  https)
    if ! command -v curl >/dev/null 2>&1; then
      printf '%s\n' '缺少 curl。' >"$TEMP_OUTPUT"
      EXIT_CODE=127
    elif ! printf '%s' "$TARGET" | LC_ALL=C grep -Eq '^[A-Za-z0-9._:-]+$' ||
      ! printf '%s' "$PORT" | LC_ALL=C grep -Eq '^[0-9]{1,5}$' ||
      [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
      printf '%s\n' '无效的 HTTPS 目标。' >"$TEMP_OUTPUT"
      EXIT_CODE=64
    else
      HTTPS_HOST="$TARGET"
      case "$TARGET" in *:*) HTTPS_HOST="[$TARGET]" ;; esac
      timeout 10s curl --proto '=https' --silent --show-error --fail --output /dev/null \
        --connect-timeout 3 --max-time 8 \
        --write-out 'status=%{http_code} connect_seconds=%{time_connect} tls_seconds=%{time_appconnect} ttfb_seconds=%{time_starttransfer}\n' \
        "https://$HTTPS_HOST:$PORT/" >"$TEMP_OUTPUT" 2>&1 || EXIT_CODE=$?
    fi
    ;;
  route)
    if ! command -v nexttrace >/dev/null 2>&1; then
      printf '%s\n' '缺少 nexttrace；请按部署文档安装。' >"$TEMP_OUTPUT"
      EXIT_CODE=127
    elif ! printf '%s' "$TARGET" | LC_ALL=C grep -Eq '^[A-Za-z0-9._:-]+$'; then
      printf '%s\n' '无效的路径追踪目标。' >"$TEMP_OUTPUT"
      EXIT_CODE=64
    else
      timeout 60s nexttrace --traceroute --json --no-rdns --max-hops 16 --queries 1 "$TARGET" >"$TEMP_OUTPUT" 2>&1 || EXIT_CODE=$?
    fi
    ;;
  throughput)
    if ! command -v iperf3 >/dev/null 2>&1; then
      printf '%s\n' '缺少 iperf3；请按部署文档安装。' >"$TEMP_OUTPUT"
      EXIT_CODE=127
    elif ! printf '%s' "$TARGET" | LC_ALL=C grep -Eq '^[A-Za-z0-9._:-]+$' ||
      ! printf '%s' "$PORT" | LC_ALL=C grep -Eq '^[0-9]{1,5}$' ||
      [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
      printf '%s\n' '无效的 iperf3 目标。' >"$TEMP_OUTPUT"
      EXIT_CODE=64
    else
      timeout 15s iperf3 --client "$TARGET" --port "$PORT" --time 10 --json >"$TEMP_OUTPUT" 2>&1 || EXIT_CODE=$?
    fi
    ;;
  tcpquality-route|tcpquality-intl|tcpquality-all)
    TCPQUALITY_BIN="${ASTER_TCPQUALITY_BIN:-/usr/local/libexec/tcpquality/runTcpQuality.sh}"
    TCPQUALITY_CORE="$(dirname "$TCPQUALITY_BIN")/runTcpQuality-core.sh"
    if [ ! -x "$TCPQUALITY_BIN" ] || [ ! -s "$TCPQUALITY_CORE" ]; then
      printf '%s\n' "找不到已安装的 TcpQuality 入口和本地 core 脚本：$TCPQUALITY_BIN" >"$TEMP_OUTPUT"
      EXIT_CODE=127
    else
      case "$MODE" in
        tcpquality-route) TCPQUALITY_LIMIT=180s ;;
        tcpquality-intl) TCPQUALITY_LIMIT=300s ;;
        tcpquality-all) TCPQUALITY_LIMIT=480s ;;
      esac
      # Every permitted option is a fixed literal; user input is never evaluated.
      case "$MODE" in
        tcpquality-route) timeout "$TCPQUALITY_LIMIT" bash "$TCPQUALITY_BIN" --no-rootfs --route --route-protocol both --no-rank-upload >"$TEMP_OUTPUT" 2>&1 || EXIT_CODE=$? ;;
        tcpquality-intl) timeout "$TCPQUALITY_LIMIT" bash "$TCPQUALITY_BIN" --no-rootfs --intl --no-rank-upload >"$TEMP_OUTPUT" 2>&1 || EXIT_CODE=$? ;;
        tcpquality-all) timeout "$TCPQUALITY_LIMIT" bash "$TCPQUALITY_BIN" --no-rootfs --all --no-rank-upload >"$TEMP_OUTPUT" 2>&1 || EXIT_CODE=$? ;;
      esac
    fi
    ;;
  *)
    printf '%s\n' '检测类型无效。' >"$TEMP_OUTPUT"
    EXIT_CODE=64
    MODE=invalid
    TARGET=unknown
    ;;
esac

if [ -s "$TEMP_OUTPUT" ]; then
  OUTPUT="$(head -c "$MAX_OUTPUT_BYTES" "$TEMP_OUTPUT" | base64 | tr -d '\n')"
else
  OUTPUT=""
fi
printf 'ASTER_NETWORK_RESULT_V1\t%s\t%s\t%s\t%s\n' "$MODE" "$TARGET" "$EXIT_CODE" "$OUTPUT"
exit 0
