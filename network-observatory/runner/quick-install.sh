#!/bin/sh
set -eu

RELEASE_BASE=https://github.com/shaolonger/Komari-Theme-Aster/releases/latest/download
ARCHIVE_NAME=Aster-Network-Observatory-latest.zip

fail() {
  printf 'Aster 网络观测安装失败：%s\n' "$1" >&2
  exit 1
}

if [ "$(id -u)" -ne 0 ]; then
  fail '请用 sudo 运行，例如 curl -fsSL <安装器地址> | sudo sh。'
fi
command -v systemctl >/dev/null 2>&1 || fail '需要 systemd/systemctl 的 Linux VPS。'
command -v curl >/dev/null 2>&1 || fail '缺少 curl；请先安装 curl 后重新运行一键命令。'

package_manager() {
  if command -v apt-get >/dev/null 2>&1; then printf apt;
  elif command -v dnf >/dev/null 2>&1; then printf dnf;
  elif command -v yum >/dev/null 2>&1; then printf yum;
  elif command -v zypper >/dev/null 2>&1; then printf zypper;
  else fail '未找到受支持的系统包管理器（apt、dnf、yum、zypper）。'; fi
}

install_packages() {
  [ "$#" -gt 0 ] || return 0
  case "$(package_manager)" in
    apt) apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" || fail 'apt 安装网络检测依赖失败；请检查软件源或包管理器锁。' ;;
    dnf) dnf install -y "$@" || fail 'dnf 安装网络检测依赖失败。' ;;
    yum) yum install -y "$@" || fail 'yum 安装网络检测依赖失败。' ;;
    zypper) zypper --non-interactive install "$@" || fail 'zypper 安装网络检测依赖失败。' ;;
  esac
}

if ! command -v python3 >/dev/null 2>&1; then install_packages python3; fi

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
    "runner/install.sh",
    "runner/probe.sh",
    "runner/aster-network-observatory-agent.service",
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
    os.chmod(target, 0o755 if name.endswith(("install.sh", "probe.sh")) else 0o644)

print(f"已下载并验证网络观测 runner v{manifest['version']}。")
PY

install_probe_dependencies() {
  packages=''
  command -v timeout >/dev/null 2>&1 || packages="$packages coreutils"
  command -v bash >/dev/null 2>&1 || packages="$packages bash"
  command -v iperf3 >/dev/null 2>&1 || packages="$packages iperf3"
  command -v jq >/dev/null 2>&1 || packages="$packages jq"
  command -v traceroute >/dev/null 2>&1 || packages="$packages traceroute"
  command -v nmap >/dev/null 2>&1 || packages="$packages nmap"
  command -v ping >/dev/null 2>&1 || packages="$packages iputils-ping"
  command -v ip >/dev/null 2>&1 || packages="$packages iproute2"
  case "$(package_manager)" in
    dnf|yum) packages=$(printf '%s' "$packages" | sed 's/iputils-ping/iputils/g; s/iproute2/iproute/g') ;;
    zypper) packages=$(printf '%s' "$packages" | sed 's/iputils-ping/iputils/g') ;;
  esac
  # Word splitting is intentional for this fixed, internal package-name list.
  [ -z "$packages" ] || install_packages $packages
  command -v iperf3 >/dev/null 2>&1 || fail 'iperf3 安装后仍不可用。'
  command -v timeout >/dev/null 2>&1 || fail 'timeout 安装后仍不可用。'
  command -v nping >/dev/null 2>&1 || fail 'nmap 安装后 nping 仍不可用；请检查系统软件源中的 nmap 包。'
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

install_tcpquality() {
  quality_dir=/usr/local/libexec/tcpquality
  if [ -s "$quality_dir/runTcpQuality-core.sh" ] && [ -x "$quality_dir/runTcpQuality.sh" ]; then
    printf '%s\n' '已检测到本地 TcpQuality，保留现有安装。'
    return 0
  fi
  source_base=https://raw.githubusercontent.com/ibsgss/TcpQuality/c2295ae096437859ce4bbc36f170428fcac47be9
  curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 120 \
    "$source_base/runTcpQuality.sh" -o "$TEMP_DIR/runTcpQuality.sh" || fail '无法从上游下载 TcpQuality 入口。'
  curl --fail --location --silent --show-error --retry 3 --connect-timeout 10 --max-time 120 \
    "$source_base/runTcpQuality-core.sh" -o "$TEMP_DIR/runTcpQuality-core.sh" || fail '无法从上游下载 TcpQuality core。'
  [ "$(sha256sum "$TEMP_DIR/runTcpQuality.sh" | cut -d ' ' -f 1)" = b5fbc67029e6c9371a3fc4cc0c191661c419b5e5c06fe475831ca748f94e675f ] || fail 'TcpQuality 入口 SHA-256 校验失败。'
  [ "$(sha256sum "$TEMP_DIR/runTcpQuality-core.sh" | cut -d ' ' -f 1)" = a7274458ddd785d637b526e2d337b80326aac1d1663414490f2a20ee161ba5c0 ] || fail 'TcpQuality core SHA-256 校验失败。'
  install -d -m 0755 "$quality_dir"
  install -m 0755 "$TEMP_DIR/runTcpQuality.sh" "$quality_dir/runTcpQuality.sh"
  install -m 0644 "$TEMP_DIR/runTcpQuality-core.sh" "$quality_dir/runTcpQuality-core.sh"
  printf '%s\n' '已从上游固定提交安装并校验 TcpQuality。'
}

install_probe_dependencies
install_nexttrace
install_tcpquality

sh "$TEMP_DIR/runner/install.sh"
if [ -r /dev/tty ]; then
  printf '\n现在登记节点并启动服务；请准备好 Komari 地址、节点 UUID 和一次性凭证。\n'
  python3 /usr/local/libexec/aster-network-observatory/agent.py configure "$@" </dev/tty
else
  printf '%s\n' \
    '当前会话没有交互终端，节点服务尚未登记凭证。' \
    '准备好节点凭证后运行：sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure'
fi
