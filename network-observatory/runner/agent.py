#!/usr/bin/env python3
"""Outbound-only, allowlisted probe worker for Komari's network observatory."""

import argparse
import base64
import getpass
import grp
import ipaddress
import json
import os
import re
import signal
import shutil
import threading
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native

API_BASE = "/api/aster-network-observatory/v1"
CONFIG_PATH = Path("/etc/aster-network-observatory/agent.json")
PROBE_PATH = Path("/usr/local/libexec/aster-network-observatory/probe.sh")
SERVICE_NAME = "aster-network-observatory-agent.service"
RUNNER_VERSION = "1.5.0"
POLL_SECONDS = 15
REQUEST_TIMEOUT = 25
TASK_TIMEOUT = 600
MODES = {
    "https",
    "route",
    "throughput",
    "speedtest",
    "tcpquality-route",
    "tcpquality-intl",
    "tcpquality-all",
    "tcpquality-report",
    "tcpquality-intl-report",
}
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
HOST_RE = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", re.I)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def validate_base_url(value):
    parsed = urllib.parse.urlsplit(value.strip())
    if parsed.scheme not in {"https", "http"} or not parsed.netloc:
        raise ValueError("Komari 地址必须是完整的 http(s) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Komari 地址不能包含账号、密码、查询参数或片段")
    if parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("节点凭证只允许通过 HTTPS 发送；HTTP 仅可用于本机回环地址")
    return value.strip().rstrip("/")


def validate_config(config):
    if not isinstance(config, dict):
        raise ValueError("配置必须是 JSON 对象")
    base_url = validate_base_url(config.get("serverUrl", ""))
    role = config.get("role", "node")
    if role not in {"node", "probe"}:
        raise ValueError("测量端角色无效")
    node_uuid = config.get("nodeUuid", "")
    token = config.get("token", "")
    if not isinstance(node_uuid, str) or not UUID_RE.fullmatch(node_uuid):
        raise ValueError("Komari 节点 UUID 无效")
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-f]{64}", token):
        raise ValueError("节点凭证格式无效")
    quality_bin = config.get("tcpqualityBin", "")
    if quality_bin and (not isinstance(quality_bin, str) or not os.path.isabs(quality_bin) or "\x00" in quality_bin):
        raise ValueError("TcpQuality 路径必须是绝对路径")
    return {
        "serverUrl": base_url,
        "nodeUuid": node_uuid,
        "token": token,
        "tcpqualityBin": quality_bin,
        "role": role,
    }


def api_url(config, suffix):
    return f"{config['serverUrl']}{API_BASE}/nodes/{config['nodeUuid']}/{suffix}"


def api_request(config, suffix, method="GET", body=None, native_api=False):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        (f"{config['serverUrl']}/api/aster-network-observatory/v2/workers/{config.get('role', 'node')}/{config['nodeUuid']}/{suffix}" if native_api else api_url(config, suffix)),
        data=data,
        headers={
            "Authorization": f"Bearer {config['token']}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Aster-Network-Observatory/1.x",
        },
        method=method,
    )
    with HTTP.open(request, timeout=REQUEST_TIMEOUT) as response:
        raw = response.read(131_073)
        if len(raw) > 131_072:
            raise ValueError("Komari 返回内容超出大小限制")
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))


def validate_task(task):
    if not isinstance(task, dict):
        raise ValueError("任务格式无效")
    task_id = task.get("taskId")
    schedule_id = task.get("scheduleId")
    mode = task.get("mode")
    target = task.get("target")
    port = task.get("port")
    if not isinstance(task_id, str) or not UUID_RE.fullmatch(task_id):
        raise ValueError("任务 ID 无效")
    if not isinstance(schedule_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,47}", schedule_id, re.I):
        raise ValueError("计划 ID 无效")
    if mode not in MODES:
        raise ValueError("检测类型不在允许列表中")
    if mode.startswith("tcpquality-"):
        if target != "default":
            raise ValueError("TcpQuality 目标无效")
    else:
        if not isinstance(target, str) or not target or len(target) > 253 or any(ch in target for ch in "\x00\r\n\t /\\@?#;"):
            raise ValueError("检测目标无效")
        try:
            ipaddress.ip_address(target)
        except ValueError:
            if re.fullmatch(r"[0-9.]+", target) or not HOST_RE.fullmatch(target):
                raise ValueError("检测目标必须是主机名或 IP 地址")
    if mode in {"https", "throughput", "speedtest"}:
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("端口无效")
    else:
        port = 0
    return {
        "taskId": task_id,
        "scheduleId": schedule_id,
        "mode": mode,
        "target": target,
        "port": port,
    }


def failure_marker(task, exit_code, message):
    encoded = base64.b64encode(message.encode("utf-8", errors="replace")[:36_000]).decode("ascii")
    return f"ASTER_NETWORK_RESULT_V1\t{task['mode']}\t{task['target']}\t{exit_code}\t{encoded}\n"


def run_probe(task, probe_path=PROBE_PATH, tcpquality_bin=""):
    task = validate_task(task)
    if not Path(probe_path).is_file():
        return failure_marker(task, 127, f"找不到节点探测脚本：{probe_path}")
    env = os.environ.copy()
    if tcpquality_bin:
        env["ASTER_TCPQUALITY_BIN"] = tcpquality_bin
    command = ["/bin/sh", str(probe_path), task["mode"], task["target"], str(task["port"] or 5201)]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=TASK_TIMEOUT)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.communicate(timeout=2)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
        return failure_marker(task, 124, "节点探测器运行超过 10 分钟，已终止。")
    text = output.decode("utf-8", errors="replace")
    if len(text) > 64_000:
        return failure_marker(task, 125, "节点探测器返回内容超出大小限制。")
    return text


def process_task(config, task):
    normalized = validate_task(task)
    output = run_probe(normalized, tcpquality_bin=config.get("tcpqualityBin", ""))
    api_request(config, "result", method="POST", body={"taskId": normalized["taskId"], "output": output})
    print(f"完成任务 {normalized['taskId']}：{normalized['mode']} → {normalized['target']}", flush=True)


def load_config(path):
    config_path = Path(path)
    if config_path.is_symlink():
        raise ValueError("拒绝读取符号链接形式的凭证配置")
    metadata = config_path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o027:
        raise ValueError("凭证配置必须是普通文件，且不得允许其他用户读取或组写入")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    return validate_config(config)


def capabilities(config):
    found = [name for name in ("curl", "nexttrace", "iperf3", "timeout") if shutil.which(name)]
    if "iperf3" in found and PROBE_PATH.with_name("speedtest.py").is_file():
        found.append("speedtest")
    entry = Path(config.get("tcpqualityBin") or "/usr/local/libexec/tcpquality/runTcpQuality.sh")
    if os.access(entry, os.X_OK) and entry.with_name("runTcpQuality-core.sh").is_file():
        found.append("tcpquality")
    return {"capabilities": found, "runnerVersion": RUNNER_VERSION}


def heartbeat(config, stop):
    # A long route/throughput test must not make a healthy worker appear offline.
    while not stop.is_set():
        try:
            if config.get("role", "node") == "node":
                api_request(config, "heartbeat", method="POST", body=capabilities(config))
            api_request(config, "heartbeat", method="POST", body={"version": RUNNER_VERSION, "tools": [x for x in ("curl", "nexttrace", "traceroute", "mtr", "iperf3", "openssl") if shutil.which(x)], "authScheme": native.auth_scheme()}, native_api=True)
        except (urllib.error.URLError, OSError, ValueError):
            pass  # Polling reports connectivity errors; older plugins lack heartbeat.
        stop.wait(30)


def configure(server_url="", node_uuid="", probe_id=""):

    if os.geteuid() != 0:
        raise PermissionError("请使用 sudo 运行配置向导，以安全写入节点凭证")
    if probe_id and not UUID_RE.fullmatch(probe_id):
        raise ValueError("大陆探针 ID 无效")
    if probe_id and node_uuid:
        raise ValueError("--probe-id 与 --node-uuid 不能同时使用")
    config_target = CONFIG_PATH.with_name("probe-" + probe_id + ".json") if probe_id else CONFIG_PATH
    service_name = "aster-network-observatory-probe@" + probe_id + ".service" if probe_id else SERVICE_NAME
    previous = load_config(config_target) if config_target.exists() else {}
    role = "probe" if probe_id else "node"
    if probe_id:
        node_uuid = probe_id
    print("Aster 网络观测节点配置（探测器密钥只显示一次，输入不会回显）")
    default_url = server_url or previous.get("serverUrl", "")
    server_url = validate_base_url(server_url or input(f"Komari 地址 [{default_url}]: ").strip() or default_url)
    node_uuid = node_uuid or input(f"Komari 节点 UUID [{previous.get('nodeUuid', '')}]: ").strip() or previous.get("nodeUuid", "")
    reuse = previous.get("serverUrl") == server_url and previous.get("nodeUuid") == node_uuid and previous.get("role", "node") == role
    token = getpass.getpass("探测器密钥（已有配置可回车保留）: ").strip() or (previous.get("token", "") if reuse else "")
    tcpquality_bin = input("TcpQuality 脚本路径（回车保留现有路径或使用默认）: ").strip() or previous.get("tcpqualityBin", "")
    config = validate_config({
        "serverUrl": server_url,
        "nodeUuid": node_uuid,
        "token": token,
        "tcpqualityBin": tcpquality_bin,
        "role": role,
    })
    api_request(config, "verify", method="POST", body={}, native_api=role == "probe")

    try:
        group = grp.getgrnam("aster-netobs")
    except KeyError as error:
        raise RuntimeError("请先运行随插件包提供的 install.sh 安装节点服务") from error
    config_target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=config_target.parent, delete=False) as temporary:
        json.dump(config, temporary, separators=(",", ":"))
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    os.chmod(temporary_path, 0o640)
    os.chown(temporary_path, 0, group.gr_gid)
    os.replace(temporary_path, config_target)
    subprocess.run(["systemctl", "enable", service_name], check=True)
    subprocess.run(["systemctl", "restart", service_name], check=True)
    print(f"已登记节点 {node_uuid} 并启动 {service_name}。")


def native_task(config, task, listeners):
    if not isinstance(task, dict) or not UUID_RE.fullmatch(task.get("id", "")):
        raise ValueError("原生任务 ID 无效")
    task_id = task["id"]
    try:
        if task.get("operation") == "listen":
            options = task.get("options") or {}
            listener = native.Listener(options.get("port"), options.get("password"), options.get("peerScheme"))
            listeners[task_id] = listener
            data = {"state": "ready", "publicKey": listener.public_key, "scheme": listener.scheme}
        else:
            data = native.measure(task)
    except (ValueError, OSError, KeyError, TypeError) as error:
        data = {"kind": "speed" if task.get("operation") in {"benchmark", "listen"} else task.get("operation"), "state": "failed", "diagnostic": str(error)[:4000]}
    # A failed result upload is retried; never repeat a bandwidth measurement.
    for attempt in range(3):
        try:
            api_request(config, "result", method="POST", body={"id": task_id, "data": data}, native_api=True)
            return
        except urllib.error.HTTPError as error:
            if error.code in {401, 409}:
                return
            if attempt == 2:
                raise
        except (urllib.error.URLError, OSError):
            if attempt == 2:
                raise
        time.sleep(2)


def run_daemon(config_path):
    config = load_config(config_path)
    stop = threading.Event()
    worker = threading.Thread(target=heartbeat, args=(config, stop), daemon=True)
    worker.start()
    listeners = {}
    print(f"网络观测探测器已启动，{config.get('role', 'node')} {config['nodeUuid']}。", flush=True)
    try:
        while True:
            try:
                native_response = None
                try:
                    native_response = api_request(config, "poll", native_api=True)
                except urllib.error.HTTPError as error:
                    if error.code != 404:
                        raise
                if native_response is not None:
                    allowed = set(native_response.get("listeners", []))
                    for key, listener in list(listeners.items()):
                        if key not in allowed or time.monotonic() >= listener.expires or listener.process.poll() is not None:
                            listener.close()
                            del listeners[key]
                    if native_response.get("task"):
                        native_task(config, native_response["task"], listeners)
                        continue
                if not listeners and config.get("role", "node") == "node":
                    response = api_request(config, "poll")
                    task = response.get("task") if isinstance(response, dict) else None
                    if task is not None:
                        process_task(config, task)
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as error:
                print(f"测量暂不可用：{error}", file=sys.stderr, flush=True)
            # Listener expiry is local and independent of panel/network availability.
            for key, listener in list(listeners.items()):
                if time.monotonic() >= listener.expires:
                    listener.close()
                    del listeners[key]
            time.sleep(3 if listeners else POLL_SECONDS)
    finally:
        stop.set()
        for listener in listeners.values():
            listener.close()


def main():
    parser = argparse.ArgumentParser(description="Aster 网络观测节点探测器")
    subparsers = parser.add_subparsers(dest="command", required=True)
    configure_parser = subparsers.add_parser("configure", help="交互式登记节点凭证并启用 systemd 服务")
    configure_parser.add_argument("--server-url", default="")
    configure_parser.add_argument("--node-uuid", default="")
    configure_parser.add_argument("--probe-id", default="")
    run_parser = subparsers.add_parser("run", help="运行节点任务轮询服务")
    run_parser.add_argument("--config", default=str(CONFIG_PATH))
    args = parser.parse_args()
    try:
        if args.command == "configure":
            configure(args.server_url, args.node_uuid, args.probe_id)
        else:
            run_daemon(args.config)
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"网络观测探测器无法启动：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
