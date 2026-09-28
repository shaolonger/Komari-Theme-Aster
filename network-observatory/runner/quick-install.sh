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

if ! command -v python3 >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y python3
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y python3
  elif command -v yum >/dev/null 2>&1; then
    yum install -y python3
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install python3
  else
    fail '缺少 Python 3，且未找到支持的系统包管理器（apt、dnf、yum、zypper）。'
  fi
fi

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

sh "$TEMP_DIR/runner/install.sh"
if [ -r /dev/tty ]; then
  printf '\n现在登记节点并启动服务；请准备好 Komari 地址、节点 UUID 和一次性凭证。\n'
  python3 /usr/local/libexec/aster-network-observatory/agent.py configure "$@" </dev/tty
else
  printf '%s\n' \
    '当前会话没有交互终端，节点服务尚未登记凭证。' \
    '准备好节点凭证后运行：sudo python3 /usr/local/libexec/aster-network-observatory/agent.py configure'
fi
