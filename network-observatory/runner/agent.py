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

API_BASE = "/api/aster-network-observatory/v1"
CONFIG_PATH = Path("/etc/aster-network-observatory/agent.json")
PROBE_PATH = Path("/usr/local/libexec/aster-network-observatory/probe.sh")
SERVICE_NAME = "aster-network-observatory-agent.service"
RUNNER_VERSION = "1.2.0"
POLL_SECONDS = 15
REQUEST_TIMEOUT = 25
TASK_TIMEOUT = 600
MODES = {
    "https",
    "route",
    "throughput",
    "tcpquality-route",
    "tcpquality-intl",
    "tcpquality-all",
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
    }


def api_url(config, suffix):
    return f"{config['serverUrl']}{API_BASE}/nodes/{config['nodeUuid']}/{suffix}"


def api_request(config, suffix, method="GET", body=None):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        api_url(config, suffix),
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
    if mode in {"https", "throughput"}:
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
    entry = Path(config.get("tcpqualityBin") or "/usr/local/libexec/tcpquality/runTcpQuality.sh")
    if os.access(entry, os.X_OK) and entry.with_name("runTcpQuality-core.sh").is_file():
        found.append("tcpquality")
    return {"capabilities": found, "runnerVersion": RUNNER_VERSION}


def heartbeat(config, stop):
    # A long route/throughput test must not make a healthy worker appear offline.
    while not stop.is_set():
        try:
            api_request(config, "heartbeat", method="POST", body=capabilities(config))
        except (urllib.error.URLError, OSError, ValueError):
            pass  # Polling reports connectivity errors; older plugins lack heartbeat.
        stop.wait(30)


def configure(server_url="", node_uuid=""):

    if os.geteuid() != 0:
        raise PermissionError("请使用 sudo 运行配置向导，以安全写入节点凭证")
    previous = load_config(CONFIG_PATH) if CONFIG_PATH.exists() else {}
    print("Aster 网络观测节点配置（探测器密钥只显示一次，输入不会回显）")
    default_url = server_url or previous.get("serverUrl", "")
    server_url = validate_base_url(server_url or input(f"Komari 地址 [{default_url}]: ").strip() or default_url)
    node_uuid = node_uuid or input(f"Komari 节点 UUID [{previous.get('nodeUuid', '')}]: ").strip() or previous.get("nodeUuid", "")
    reuse = previous.get("serverUrl") == server_url and previous.get("nodeUuid") == node_uuid
    token = getpass.getpass("探测器密钥（已有配置可回车保留）: ").strip() or (previous.get("token", "") if reuse else "")
    tcpquality_bin = input("TcpQuality 脚本路径（回车保留现有路径或使用默认）: ").strip() or previous.get("tcpqualityBin", "")
    config = validate_config({
        "serverUrl": server_url,
        "nodeUuid": node_uuid,
        "token": token,
        "tcpqualityBin": tcpquality_bin,
    })
    api_request(config, "verify", method="POST", body={})

    try:
        group = grp.getgrnam("aster-netobs")
    except KeyError as error:
        raise RuntimeError("请先运行随插件包提供的 install.sh 安装节点服务") from error
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=CONFIG_PATH.parent, delete=False) as temporary:
        json.dump(config, temporary, separators=(",", ":"))
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    os.chmod(temporary_path, 0o640)
    os.chown(temporary_path, 0, group.gr_gid)
    os.replace(temporary_path, CONFIG_PATH)
    subprocess.run(["systemctl", "enable", SERVICE_NAME], check=True)
    subprocess.run(["systemctl", "restart", SERVICE_NAME], check=True)
    print(f"已登记节点 {node_uuid} 并启动 {SERVICE_NAME}。")


def run_daemon(config_path):
    config = load_config(config_path)
    stop = threading.Event()
    worker = threading.Thread(target=heartbeat, args=(config, stop), daemon=True)
    worker.start()
    print(f"网络观测探测器已启动，节点 {config['nodeUuid']}，每 {POLL_SECONDS} 秒检查一次任务。", flush=True)
    while True:
        try:
            response = api_request(config, "poll")
            task = response.get("task") if isinstance(response, dict) else None
            if task is not None:
                try:
                    process_task(config, task)
                except Exception as error:  # keep the worker alive across transient API failures
                    print(f"任务处理失败：{error}", file=sys.stderr, flush=True)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
            print(f"Komari 暂不可达或响应无效：{error}", file=sys.stderr, flush=True)
        time.sleep(POLL_SECONDS)


def main():
    parser = argparse.ArgumentParser(description="Aster 网络观测节点探测器")
    subparsers = parser.add_subparsers(dest="command", required=True)
    configure_parser = subparsers.add_parser("configure", help="交互式登记节点凭证并启用 systemd 服务")
    configure_parser.add_argument("--server-url", default="")
    configure_parser.add_argument("--node-uuid", default="")
    run_parser = subparsers.add_parser("run", help="运行节点任务轮询服务")
    run_parser.add_argument("--config", default=str(CONFIG_PATH))
    args = parser.parse_args()
    try:
        if args.command == "configure":
            configure(args.server_url, args.node_uuid)
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
