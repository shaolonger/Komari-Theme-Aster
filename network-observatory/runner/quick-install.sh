#!/bin/sh
set -eu

RELEASE_BASE=https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download
ARCHIVE_NAME=Aster-Network-Observatory-latest.zip
PROFILE=auto
SERVER_URL=''
NODE_UUID=''
PROBE_ID=''
UPGRADE=0

fail() {
  printf 'Aster 网络观测安装失败：%s\n' "$1" >&2
  exit 1
}

# This must run before id/awk/cat (including command substitutions). In a
# PID-starved LXC even the first such command aborts BusyBox ash with EAGAIN,
# closing stdin and leaving the downloading curl with a misleading error 23.
# Shell builtins still work when the container cannot create another task.
check_pid_budget() {
  pid_dir=$1
  while :; do
    if [ -r "$pid_dir/pids.max" ] && [ -r "$pid_dir/pids.current" ]; then
      pid_max= pid_current=
      IFS= read -r pid_max < "$pid_dir/pids.max" || :
      IFS= read -r pid_current < "$pid_dir/pids.current" || :
      case "$pid_max:$pid_current" in
        *[!0-9:]*|:*|*:) ;;
        *)
          pid_free=$((pid_max - pid_current))
          if [ "$pid_free" -lt 8 ]; then
            fail "进程/线程配额不足：${pid_dir} 的 pids.current=${pid_current}，pids.max=${pid_max}。安装前至少预留 8 个任务名额；请停止不需要的服务，或由 LXC 宿主机/服务商调整容器及父级的 pids.max。内存有空闲也可能触发此限制。请先下载脚本到文件，再运行，避免 curl 管道额外占用进程。"
          fi
          ;;
      esac
    fi
    # Also check visible ancestors: a child can say 'max' while its parent
    # enforces the limit. Never walk beyond the standard controller mount.
    case "$pid_dir" in
      /sys/fs/cgroup|/sys/fs/cgroup/pids) break ;;
      /sys/fs/cgroup/*) pid_dir=${pid_dir%/*} ;;
      *) break ;;
    esac
  done
}

resource_preflight() {
  cgroup_v2= cgroup_pids= cgroup_memory=
  if [ -r /proc/self/cgroup ]; then
    while IFS=: read -r hierarchy controllers cgroup_path; do
      # These paths are kernel supplied; reject parent traversal rather than
      # following a non-namespaced container path outside the mount.
      case "$cgroup_path" in /*) ;; *) continue ;; esac
      case "/$cgroup_path/" in */../*|*/./*) continue ;; esac
      case ",$controllers," in
        ,,) cgroup_v2=/sys/fs/cgroup${cgroup_path%/} ;;
        *,pids,*) cgroup_pids=/sys/fs/cgroup/pids${cgroup_path%/} ;;
      esac
      case ",$controllers," in
        *,memory,*) cgroup_memory=/sys/fs/cgroup/memory${cgroup_path%/} ;;
      esac
    done < /proc/self/cgroup
  fi
  [ -z "$cgroup_v2" ] || check_pid_budget "$cgroup_v2"
  [ -z "$cgroup_pids" ] || check_pid_budget "$cgroup_pids"
  # Namespaced controller roots remain useful when /proc is unavailable or
  # exposes an ancestor path which is not mounted inside this container.
  check_pid_budget /sys/fs/cgroup
  check_pid_budget /sys/fs/cgroup/pids
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --upgrade) UPGRADE=1; shift ;;
    --profile|--server-url|--node-uuid|--probe-id)
      [ "$#" -ge 2 ] || fail "$1 缺少参数。"
      case "$1" in
        --profile) PROFILE=$2 ;;
        --server-url) SERVER_URL=$2 ;;
        --node-uuid) NODE_UUID=$2 ;;
        --probe-id) PROBE_ID=$2 ;;
      esac
      shift 2 ;;
    --help|-h)
      printf '%s\n' '用法：sh install.sh [--upgrade] [--profile auto|lite|full|preserve] [--server-url URL] [--node-uuid UUID | --probe-id UUID]' \
        'auto 在内存不超过 192 MiB 或根分区可用空间少于 192 MiB 时选 lite。' \
        'lite：Python、HTTPS 环境、MTR 和 traceroute；full 另含 NextTrace、iperf3、openssl 和 nping。'
      exit 0 ;;
    *) fail "未知安装参数：$1" ;;
  esac
done
case "$PROFILE" in auto|lite|full) ;; preserve) [ "$UPGRADE" -eq 1 ] || fail 'preserve 仅用于 --upgrade。' ;; *) fail '安装模式必须是 auto、lite、full 或 preserve。' ;; esac

resource_preflight
effective_uid=
if [ -r /proc/self/status ]; then
  while read -r status_key real_uid status_uid rest; do
    case "$status_key" in Uid:) effective_uid=$status_uid; break ;; esac
  done < /proc/self/status
fi
if [ -z "$effective_uid" ]; then effective_uid=$(id -u) || fail '无法读取用户身份；请检查进程数限制。'; fi
if [ "$effective_uid" != 0 ]; then
  fail '请用 sudo 运行，例如 curl -fsSL <安装器地址> | sudo sh。'
fi
if command -v rc-service >/dev/null 2>&1 && command -v rc-update >/dev/null 2>&1 && [ ! -d /run/systemd/system ]; then
  INIT_SYSTEM=openrc
elif command -v systemctl >/dev/null 2>&1; then
  INIT_SYSTEM=systemd
else
  fail '需要使用 systemd 或 OpenRC 的 Linux VPS；Alpine 请确认已安装并启用 OpenRC。'
fi
command -v curl >/dev/null 2>&1 || fail '缺少 curl；请先安装 curl 后重新运行一键命令。'
if [ "$UPGRADE" -eq 1 ]; then
  case "$PROFILE" in auto|preserve) ;; *) fail '--upgrade 会保留原模式；调整工具请使用不带 --upgrade 的安装命令。' ;; esac
  command -v python3 >/dev/null 2>&1 || fail '未找到已有 Python 环境，请先执行普通安装命令。'
fi
upgrade_existing() {
  updater=$1
  set -- manual --profile preserve
  [ -z "$SERVER_URL" ] || set -- "$@" --server-url "$SERVER_URL"
  [ -z "$NODE_UUID" ] || set -- "$@" --node-uuid "$NODE_UUID"
  [ -z "$PROBE_ID" ] || set -- "$@" --probe-id "$PROBE_ID"
  python3 "$updater" "$@"
}
if [ "$UPGRADE" -eq 1 ] && [ -f /usr/local/libexec/aster-network-observatory/updater.py ]; then
  upgrade_existing /usr/local/libexec/aster-network-observatory/updater.py
  exit
fi

package_manager() {
  if command -v apk >/dev/null 2>&1; then printf apk;
  elif command -v apt-get >/dev/null 2>&1; then printf apt;
  elif command -v dnf >/dev/null 2>&1; then printf dnf;
  elif command -v yum >/dev/null 2>&1; then printf yum;
  elif command -v zypper >/dev/null 2>&1; then printf zypper;
  else fail '未找到受支持的系统包管理器（apk、apt、dnf、yum、zypper）。'; fi
}

install_packages() {
  [ "$#" -gt 0 ] || return 0
  case "$(package_manager)" in
    apk) apk add --no-cache "$@" || fail 'apk 安装依赖失败；请检查可用磁盘空间、软件源与包管理器锁。' ;;
    apt) apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" || fail 'apt 安装网络检测依赖失败；请检查软件源或包管理器锁。' ;;
    dnf) dnf install -y "$@" || fail 'dnf 安装网络检测依赖失败。' ;;
    yum) yum install -y "$@" || fail 'yum 安装网络检测依赖失败。' ;;
    zypper) zypper --non-interactive install "$@" || fail 'zypper 安装网络检测依赖失败。' ;;
  esac
}

if [ "$PROFILE" = preserve ]; then PROFILE=auto; fi
if [ "$PROFILE" = auto ]; then
  memory_kb=
  if [ -r /proc/meminfo ]; then
    while read -r memory_key memory_value rest; do
      case "$memory_key" in MemTotal:) memory_kb=$memory_value; break ;; esac
    done < /proc/meminfo
  fi
  for limit_file in "${cgroup_v2:-/sys/fs/cgroup}/memory.max" "${cgroup_memory:-/sys/fs/cgroup/memory}/memory.limit_in_bytes" /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do
    [ -r "$limit_file" ] || continue
    limit_bytes=
    IFS= read -r limit_bytes < "$limit_file" || :
    case "$limit_bytes" in ''|*[!0-9]*) continue ;; esac
    limit_kb=$((limit_bytes / 1024))
    if [ "$limit_kb" -gt 0 ] && { [ -z "$memory_kb" ] || [ "$limit_kb" -lt "$memory_kb" ]; }; then memory_kb=$limit_kb; fi
  done
  disk_usage=$(df -Pk /) || fail '无法检查磁盘空间；请检查进程数限制和文件系统。'
  free_kb=
  while read -r filesystem blocks used available rest; do
    case "$available" in ''|*[!0-9]*) continue ;; esac
    free_kb=$available
  done <<EOF
$disk_usage
EOF
  PROFILE=full
  if { [ -n "$memory_kb" ] && [ "$memory_kb" -le 196608 ]; } || { [ -n "$free_kb" ] && [ "$free_kb" -lt 196608 ]; }; then PROFILE=lite; fi
fi
printf '服务管理：%s；安装模式：%s。\n' "$INIT_SYSTEM" "$PROFILE"
if [ "$PROFILE" = lite ]; then
  printf '%s\n' '轻量模式保留基础延迟、TCP 建连、MTR 路由；不自动安装 NextTrace、iperf3、nping。' \
    'NextTrace 位置补充、自建 iperf3 测速和原始 SYN 比较需要相应工具；可用 --profile full 补齐，已有工具不会卸载。'
fi
bootstrap_packages=''
command -v python3 >/dev/null 2>&1 || bootstrap_packages="$bootstrap_packages python3"
if [ "$UPGRADE" -eq 0 ] && [ "$(package_manager)" = apk ]; then
  apk info -e ca-certificates >/dev/null 2>&1 || bootstrap_packages="$bootstrap_packages ca-certificates"
  command -v mtr >/dev/null 2>&1 || bootstrap_packages="$bootstrap_packages mtr"
  # BusyBox traceroute does not provide the TCP fallback used by this worker.
  apk info -e traceroute >/dev/null 2>&1 || bootstrap_packages="$bootstrap_packages traceroute"
fi
# Fixed internal package names only; never shell-expand user arguments.
[ -z "$bootstrap_packages" ] || install_packages $bootstrap_packages

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
ARCHIVE="$TEMP_DIR/$ARCHIVE_NAME"
CHECKSUM="$ARCHIVE.sha256"

curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 180 \
  "$RELEASE_BASE/$ARCHIVE_NAME" -o "$ARCHIVE" || fail '无法下载最新 runner 发布包。'
curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 30 \
  "$RELEASE_BASE/$ARCHIVE_NAME.sha256" -o "$CHECKSUM" || fail '无法下载 runner 校验文件。'

python3 - "$ARCHIVE" "$CHECKSUM" "$TEMP_DIR/runner" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys
import zipfile
from pathlib import Path

archive_path, checksum_path, output_dir = map(Path, sys.argv[1:])
archive_name = "Aster-Network-Observatory-latest.zip"
checksum_text = checksum_path.read_text(encoding="ascii").strip()
match = re.fullmatch(r"([0-9a-f]{64})\s+\*?" + re.escape(archive_name), checksum_text)
if not match:
    raise SystemExit("校验文件格式无效，已停止安装。")
actual_digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
if actual_digest != match.group(1):
    raise SystemExit("runner 发布包 SHA-256 校验失败，已停止安装。")

expected = {
    "komari-plugin.json",
    "runner/agent.py",
    "runner/updater.py",
    "runner/release.json",
    "runner/aster-network-observatory-update.service",
    "runner/aster-network-observatory-update.timer",
    "runner/aster-network-observatory-update.openrc",
    "runner/install.sh",
    "runner/native.py",
    "runner/public_speed.py",
    "runner/tcp_quality.py",
    "runner/http_receiver.py",
    "runner/aster-network-observatory-http.service",
    "runner/aster-network-observatory-agent.service",
    "runner/aster-network-observatory-probe@.service",
    "runner/aster-network-observatory.openrc",
    "runner/aster-network-observatory-http.openrc",
}
files = {}
with zipfile.ZipFile(archive_path) as bundle:
    entries = bundle.infolist()
    if len(entries) > 64:
        raise SystemExit("runner 发布包包含异常数量的文件，已停止安装。")
    for entry in entries:
        if entry.filename not in expected:
            continue
        mode = entry.external_attr >> 16
        if stat.S_ISLNK(mode) or entry.file_size > 2 * 1024 * 1024:
            raise SystemExit("runner 发布包包含不安全或过大的文件，已停止安装。")
        if entry.filename in files:
            raise SystemExit("runner 发布包包含重复文件，已停止安装。")
        files[entry.filename] = bundle.read(entry)

    missing = expected.difference(files)
    if missing:
        raise SystemExit("runner 发布包缺少必要文件：" + ", ".join(sorted(missing)))
    manifest = json.loads(files["komari-plugin.json"])
    if manifest.get("short") != "aster-network-observatory" or not re.fullmatch(r"\d+\.\d+\.\d+", manifest.get("version", "")):
        raise SystemExit("插件清单无效，已停止安装。")

root = output_dir.parent
for name in expected:
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(files[name])
    os.chmod(target, 0o755 if name.endswith("install.sh") else 0o644)

print(f"已下载并验证网络观测插件包 v{manifest['version']} 中的 runner。")
PY

if [ "$UPGRADE" -eq 1 ]; then
  upgrade_existing "$TEMP_DIR/runner/updater.py"
  exit
fi

install_probe_dependencies() {
  packages=''
  command -v mtr >/dev/null 2>&1 || packages="$packages mtr"
  command -v traceroute >/dev/null 2>&1 || packages="$packages traceroute"
  if [ "$PROFILE" = full ]; then
    command -v iperf3 >/dev/null 2>&1 || packages="$packages iperf3"
    command -v openssl >/dev/null 2>&1 || packages="$packages openssl"
    if ! command -v nping >/dev/null 2>&1; then
      if [ "$(package_manager)" = apk ]; then packages="$packages nmap-nping"; else packages="$packages nmap"; fi
    fi
  fi
  # Word splitting is intentional for this fixed, internal package-name list.
  [ -z "$packages" ] || install_packages $packages
  command -v mtr >/dev/null 2>&1 || fail 'mtr 安装后仍不可用。'
  command -v traceroute >/dev/null 2>&1 || fail 'traceroute 安装后仍不可用。'
  if [ "$PROFILE" = full ]; then
    command -v iperf3 >/dev/null 2>&1 || fail 'iperf3 安装后仍不可用。'
    command -v nping >/dev/null 2>&1 || fail 'nping 安装后仍不可用；请检查系统软件源中的 nmap/nping 包。'
  fi
}

install_nexttrace() {
  if command -v nexttrace >/dev/null 2>&1; then
    printf '%s\n' '已检测到 nexttrace，保留现有安装。'
    return 0
  fi
  case "$(uname -s)/$(uname -m)" in
    Linux/x86_64|Linux/amd64) arch=amd64; digest=aa75440fcdee46c16d941f48f9dabee1eb4c35bea6b739b0960fcf8307088c29 ;;
    Linux/aarch64|Linux/arm64) arch=arm64; digest=4fbf436e2d4737e4a491e71ce3cd140a7a268d43ec94fb9ac9497aec7eda080e ;;
    Linux/armv7l) arch=armv7; digest=d7741bd54a5cae13acf5decb6576216fb355f9dfbcb830b29aea092e08606979 ;;
    Linux/riscv64) arch=riscv64; digest=d6d30f2b747c92391d86da32475346b4e1829ee94032f189e08bb8208a58b8e7 ;;
    *) fail '当前 Linux CPU 架构尚无已校验的 NextTrace 安装文件。' ;;
  esac
  binary="$TEMP_DIR/nexttrace"
  curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 180 \
    "https://github.com/nxtrace/NTrace-core/releases/download/v1.7.3/nexttrace_linux_$arch" -o "$binary" || fail '无法下载 NextTrace v1.7.3。'
  actual=$(sha256sum "$binary" | cut -d ' ' -f 1)
  [ "$actual" = "$digest" ] || fail 'NextTrace SHA-256 校验失败。'
  install -m 0755 "$binary" /usr/local/bin/nexttrace
  printf '%s\n' '已安装并校验 NextTrace v1.7.3。'
}

install_probe_dependencies
[ "$PROFILE" != full ] || install_nexttrace

ASTER_INSTALL_PROFILE="$PROFILE" sh "$TEMP_DIR/runner/install.sh"
set --
[ -z "$SERVER_URL" ] || set -- "$@" --server-url "$SERVER_URL"
[ -z "$NODE_UUID" ] || set -- "$@" --node-uuid "$NODE_UUID"
[ -z "$PROBE_ID" ] || set -- "$@" --probe-id "$PROBE_ID"
if ( : </dev/tty ) 2>/dev/null; then
  printf '\n现在登记节点并启动服务；请准备好 Komari 地址、节点 UUID 和一次性凭证。\n'
  python3 /usr/local/libexec/aster-network-observatory/agent.py configure "$@" </dev/tty
else
  printf '%s\n' \
    '当前会话没有交互终端，节点服务尚未登记凭证。' \
    '准备好节点凭证后运行：sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure'
fi
