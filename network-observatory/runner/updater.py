#!/usr/bin/env python3
"""Credential-preserving maintenance; only fixed GitHub release artifacts are accepted."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
import zipfile

ROOT = Path("/usr/local/libexec/aster-network-observatory")
CONFIG = Path("/etc/aster-network-observatory")
STATE = Path("/var/lib/aster-network-observatory")
RELEASE_BASE = "https://github.com/shaolonger/Komari-Theme-Aster/releases/download/"
PY_FILES = ["agent.py", "native.py", "public_speed.py", "tcp_quality.py", "http_receiver.py", "updater.py"]
SERVICE_FILES = ["aster-network-observatory-agent.service", "aster-network-observatory-probe@.service", "aster-network-observatory-http.service", "aster-network-observatory.openrc", "aster-network-observatory-http.openrc", "aster-network-observatory-update.service", "aster-network-observatory-update.timer", "aster-network-observatory-update.openrc"]
JOURNAL = "upgrade-transaction.json"
HEALTH_SECONDS = 45


def atomic_write(path, data, mode=0o644):
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as temporary:
        temporary.write(data)
        temporary.flush()
        os.fsync(temporary.fileno())
        name = temporary.name
    os.chmod(name, mode)
    os.replace(name, path)


def manager():
    marker = CONFIG / "service-manager"
    return marker.read_text().strip() if marker.exists() else "systemd"


def service_name(config):
    probe = config.get("role", "node") == "probe"
    if manager() == "openrc":
        return "aster-network-observatory" + ("-probe-" + config["nodeUuid"] if probe else "")
    return "aster-network-observatory-probe@" + config["nodeUuid"] + ".service" if probe else "aster-network-observatory-agent.service"


def service(name, action, check=True):
    args = ["rc-service", name, action] if manager() == "openrc" else ["systemctl", action, name]
    return subprocess.run(args, check=check, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=50)


def journal_files(configs):
    files = {str(ROOT / name) for name in [*PY_FILES, *SERVICE_FILES, "release.json"]}
    if manager() == "openrc":
        files.update(str(Path("/etc/init.d") / service_name(c)) for c in configs)
        files.update(str(Path("/etc/init.d") / n) for n in ["aster-network-observatory-http", "aster-network-observatory-update"])
    else:
        files.update(str(Path("/etc/systemd/system") / n) for n in SERVICE_FILES if n.endswith((".service", ".timer")))
    return files


def recover():
    file = STATE / JOURNAL
    if not file.exists():
        return False
    data = json.loads(file.read_text())
    # The journal is root-only. Still reject paths outside our own service files.
    allowed = journal_files(data["configs"])
    for name in data["services"]:
        service(name, "stop", check=False)
    for name, previous in data["files"].items():
        if name not in allowed:
            raise ValueError("升级恢复记录包含非探测器文件")
        path = Path(name)
        if previous is None:
            path.unlink(missing_ok=True)
        else:
            atomic_write(path, base64.b64decode(previous["data"]), previous["mode"])
    if manager() == "systemd":
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        for name in data["services"]:
            subprocess.run(["systemctl", "reset-failed", name], check=True)
    for name in data["services"]:
        service(name, "start")
    file.unlink()
    return True


def version_tuple(version):
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("发行版本无效")
    return tuple(map(int, version.split(".")))


def release_url(release):
    version_tuple(release.get("version"))
    if release.get("protocol") != 2 or not re.fullmatch(r"v\d+\.\d+\.\d+", release.get("releaseTag", "")) or not re.fullmatch(r"Aster-Network-Observatory-v\d+\.\d+\.\d+\.zip", release.get("archive", "")):
        raise ValueError("面板没有提供兼容的固定版本发行包")
    return RELEASE_BASE + release["releaseTag"] + "/" + release["archive"]


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise ValueError("发行包只允许通过 HTTPS 下载")
        return super().redirect_request(request, fp, code, message, headers, newurl)


def download(url, output, limit):
    opener = urllib.request.build_opener(HTTPSRedirect())
    with opener.open(url, timeout=30) as response, open(output, "wb") as file:
        size = 0
        while True:
            block = response.read(65536)
            if not block:
                break
            size += len(block)
            if size > limit:
                raise ValueError("发行包超过升级大小限制")
            file.write(block)


def bundle_files(archive, checksum, release):
    expected_digest = checksum.read_text().strip()
    match = re.fullmatch(r"([0-9a-f]{64})\s+\*?" + re.escape(release["archive"]), expected_digest)
    if not match or hashlib.sha256(archive.read_bytes()).hexdigest() != match[1]:
        raise ValueError("发行包 SHA-256 校验失败")
    expected = {"runner/" + name for name in [*PY_FILES, *SERVICE_FILES, "release.json"]} | {"komari-plugin.json"}
    files = {}
    with zipfile.ZipFile(archive) as bundle:
        if len(bundle.infolist()) > 80:
            raise ValueError("发行包文件数量异常")
        for entry in bundle.infolist():
            if entry.filename not in expected:
                continue
            if entry.filename in files or entry.file_size > 2 * 1024 * 1024 or (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("发行包包含重复、不安全或过大的文件")
            files[entry.filename] = bundle.read(entry)
    if set(files) != expected:
        raise ValueError("发行包缺少升级文件")
    manifest = json.loads(files["komari-plugin.json"])
    if manifest.get("short") != "aster-network-observatory" or release["archive"] != "Aster-Network-Observatory-v" + manifest.get("version", "") + ".zip" or json.loads(files["runner/release.json"]) != release:
        raise ValueError("发行包版本与面板声明不一致")
    source = files["runner/agent.py"].decode()
    if not re.search(r'^RUNNER_VERSION = "' + re.escape(release["version"]) + '"$', source, re.M):
        raise ValueError("探测器版本与发行声明不一致")
    for name in PY_FILES:
        compile(files["runner/" + name], name, "exec")
    for name in SERVICE_FILES:
        if name.endswith(".openrc"):
            subprocess.run(["sh", "-n"], input=files["runner/" + name], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return files


def install_services(files, configs):
    if manager() == "openrc":
        for config in configs:
            atomic_write(Path("/etc/init.d") / service_name(config), files["runner/aster-network-observatory.openrc"], 0o755)
        for name in ["aster-network-observatory-http", "aster-network-observatory-update"]:
            atomic_write(Path("/etc/init.d") / name, files["runner/" + name + ".openrc"], 0o755)
    else:
        for name in SERVICE_FILES:
            if name.endswith((".service", ".timer")):
                atomic_write(Path("/etc/systemd/system") / name, files["runner/" + name])
        subprocess.run(["systemctl", "daemon-reload"], check=True)


def enable_scheduler():
    if manager() == "openrc":
        subprocess.run(["rc-update", "add", "aster-network-observatory-update", "default"], check=True)
        if service("aster-network-observatory-update", "status", check=False).returncode:
            service("aster-network-observatory-update", "start")
    else:
        subprocess.run(["systemctl", "enable", "--now", "aster-network-observatory-update.timer"], check=True)


def perform(args):
    # Recovery deliberately runs before importing potentially damaged runner code.
    recover()
    if args.command == "recover":
        return
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import agent
    paths = ([CONFIG / "agent.json"] if (CONFIG / "agent.json").exists() else []) + sorted(CONFIG.glob("probe-*.json"))
    configs = [agent.load_config(p) for p in paths]
    if not configs:
        if args.command == "auto":
            return
        raise ValueError("未找到已有凭证；首次安装请勿使用 --upgrade")
    if args.command == "manual":
        if args.node_uuid and args.probe_id:
            raise ValueError("--node-uuid 与 --probe-id 不能同时使用")
        if args.profile != "preserve":
            raise ValueError("维护升级保留原安装模式；调整工具请使用不带 --upgrade 的安装命令")
        selected_id = args.probe_id or args.node_uuid
        selected_role = "probe" if args.probe_id else "node"
        selected = next((c for c in configs if c.get("role", "node") == selected_role and (not selected_id or c["nodeUuid"] == selected_id)), None)
        if not selected or (args.server_url and agent.validate_base_url(args.server_url) != selected["serverUrl"]):
            raise ValueError("升级参数与已保存的面板 / 节点身份不匹配，未修改凭证")
    try:
        policies = [agent.api_request(c, "update-policy") for c in configs]
    except urllib.error.HTTPError as error:
        if error.code == 404:
            if args.command == "auto":
                return
            raise ValueError("请先更新面板网络观测插件，以使用保留凭证的维护升级") from error
        raise
    def report(message, state="waiting"):
        for config, policy in zip(configs, policies):
            if args.command != "auto" or policy.get("enabled"):
                agent.api_request(config, "maintenance", method="POST", body={"action": "report", "state": state, "message": message})
    if args.command == "auto" and not all(p.get("enabled") is True for p in policies):
        if any(p.get("enabled") for p in policies):
            report("本机另有接入身份尚未允许自动更新，等待管理员授权")
        return
    release = policies[0]["release"]
    url = release_url(release)
    if any(p["release"] != release for p in policies):
        raise ValueError("本机接入身份的面板建议版本不同，等待管理员统一后升级")
    current = re.search(r'^RUNNER_VERSION = "([\d.]+)"$', (ROOT / "agent.py").read_text(), re.M)
    if not current:
        raise ValueError("无法确定已安装探测器版本")
    if args.command == "auto" and version_tuple(current[1]) >= version_tuple(release["version"]):
        report("检查完成：当前探测器 " + current[1] + " 无需更新", "ok")
        return
    if version_tuple(current[1]) > version_tuple(release["version"]):
        raise ValueError("面板建议版本早于当前探测器，拒绝降级")
    if any(p.get("busy") for p in policies):
        if args.command == "auto":
            report("当前测量尚未结束，等待下次空闲检查")
            return
        raise ValueError("测量尚未结束，等待下一次检查或空闲后重试")
    services = [service_name(c) for c in configs if service(service_name(c), "status", check=False).returncode == 0]
    if args.command == "auto" and len(services) != len(configs):
        report("存在管理员停止的探测器，等待其恢复后更新")
        return  # Never restart a worker the administrator intentionally stopped.
    if args.command == "manual" and service_name(selected) not in services:
        services.append(service_name(selected))
    leases = []
    try:
        with tempfile.TemporaryDirectory(prefix="aster-upgrade-") as temporary:
            directory = Path(temporary)
            archive, checksum = directory / release["archive"], directory / "checksum"
            download(url, archive, 8 * 1024 * 1024)
            download(url + ".sha256", checksum, 1024)
            files = bundle_files(archive, checksum, release)
            candidate = directory / "candidate"
            candidate.mkdir()
            for name in PY_FILES:
                (candidate / name).write_bytes(files["runner/" + name])
            for path in paths:
                subprocess.run([sys.executable, "-B", str(candidate / "agent.py"), "check", "--config", str(path)], check=True, timeout=35, stdout=subprocess.DEVNULL)
            for config in configs:
                lease = agent.api_request(config, "maintenance", method="POST", body={"action": "claim", "version": release["version"], "automatic": args.command == "auto"})
                leases.append((config, lease["lease"]))
            targets = journal_files(configs)
            snapshot = {name: {"data": base64.b64encode(Path(name).read_bytes()).decode(), "mode": Path(name).stat().st_mode & 0o777} if Path(name).exists() else None for name in targets}
            atomic_write(STATE / JOURNAL, json.dumps({"files": snapshot, "services": services, "configs": configs_without_tokens(configs)}).encode(), 0o600)
            try:
                for name in services:
                    service(name, "stop")
                previous_instances = {service_name(c): agent.api_request(c, "update-policy").get("instanceId", "") for c in configs}
                for name in [*PY_FILES, *SERVICE_FILES, "release.json"]:
                    atomic_write(ROOT / name, files["runner/" + name], 0o755 if name.endswith(".openrc") else 0o644)
                install_services(files, configs)
                for name in services:
                    service(name, "start")
                deadline = time.monotonic() + HEALTH_SECONDS
                def healthy(config):
                    name = service_name(config)
                    status = agent.api_request(config, "update-policy")
                    return service(name, "status", check=False).returncode == 0 and status.get("version") == release["version"] and bool(re.fullmatch(r"[0-9a-f]{32}", status.get("instanceId", ""))) and status["instanceId"] != previous_instances[name]
                while True:
                    if all(healthy(c) for c in configs if service_name(c) in services):
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError("新版探测器启动 / 心跳检查未通过")
                    time.sleep(1)
                enable_scheduler()
                (STATE / JOURNAL).unlink()
            except BaseException:
                for name in services:
                    service(name, "stop", check=False)
                recover()
                raise
        message = f"探测器已升级至 {release['version']}，原配置和凭证保持不变"
        print(message)
        state = "ok"
    except BaseException:
        message, state = "升级未完成；已保留原凭证并恢复原探测器（若已进入替换阶段）", "failed"
        raise
    finally:
        for config, lease in leases:
            try:
                agent.api_request(config, "maintenance", method="POST", body={"action": "release", "lease": lease, "state": locals().get("state", "waiting"), "message": locals().get("message", "等待其他本机身份空闲，下次重试")})
            except Exception:
                pass  # The reservation expires independently after ten minutes.


def configs_without_tokens(configs):
    return [{"role": c.get("role", "node"), "nodeUuid": c["nodeUuid"]} for c in configs]


def main():
    parser = argparse.ArgumentParser(description="Aster 保留凭证升级器")
    parser.add_argument("command", choices=["manual", "auto", "recover"])
    parser.add_argument("--server-url", default="")
    parser.add_argument("--node-uuid", default="")
    parser.add_argument("--probe-id", default="")
    parser.add_argument("--profile", choices=["preserve", "lite", "full", "auto"], default="preserve")
    args = parser.parse_args()
    try:
        if os.geteuid() != 0:
            raise PermissionError("请使用 root / sudo 执行升级")
        STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
        with open(STATE / "upgrade.lock", "w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            perform(args)
    except BlockingIOError:
        if args.command in {"auto", "recover"}:
            return 0
        print("另一个升级进程正在运行，请稍后重试", file=sys.stderr)
        return 1
    except Exception as error:
        print("探测器升级未完成：" + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
