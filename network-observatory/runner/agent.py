#!/usr/bin/env python3
"""Outbound-only, allowlisted probe worker for Komari's network observatory."""

import argparse
import getpass
import grp
import json
import os
import re
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
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native

CONFIG_PATH = Path("/etc/aster-network-observatory/agent.json")
SERVICE_NAME = "aster-network-observatory-agent.service"
RUNNER_VERSION = "1.9.1"
POLL_SECONDS = 15
REQUEST_TIMEOUT = 25
STATE_DIR = Path("/var/lib/aster-network-observatory")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


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
    return {
        "serverUrl": base_url,
        "nodeUuid": node_uuid,
        "token": token,
        "role": role,
    }


def api_request(config, suffix, method="GET", body=None):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        f"{config['serverUrl']}/api/aster-network-observatory/v2/workers/{config.get('role', 'node')}/{config['nodeUuid']}/{suffix}",
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


def load_config(path):
    config_path = Path(path)
    if config_path.is_symlink():
        raise ValueError("拒绝读取符号链接形式的凭证配置")
    metadata = config_path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o027:
        raise ValueError("凭证配置必须是普通文件，且不得允许其他用户读取或组写入")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    return validate_config(config)


def heartbeat(config, stop):
    # A long route/throughput test must not make a healthy worker appear offline.
    while not stop.is_set():
        try:
            response = api_request(config, "heartbeat", method="POST", body={"version": RUNNER_VERSION, "tools": [x for x in ("curl", "nexttrace", "traceroute", "mtr", "iperf3", "openssl", "nping") if shutil.which(x)], "authScheme": native.auth_scheme(), "features": ["report-v3", "latency-samples", "full-mtr", "speed-intervals", "http-speed", "tcp-quality", "public-speed"], "activeJobIds": native.active_tasks()})
            if "activeJobIds" in response:
                native.reconcile_tasks(set(response["activeJobIds"]))
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
    config = validate_config({
        "serverUrl": server_url,
        "nodeUuid": node_uuid,
        "token": token,
        "role": role,
    })
    api_request(config, "verify", method="POST", body={})

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
    with native.task_context(task.get("id", "")):
        return _native_task(config, task, listeners)


def outbox_dir(config):
    folder = STATE_DIR / (config.get("role", "node") + "-" + config["nodeUuid"])
    if not UUID_RE.fullmatch(config["nodeUuid"]) or config.get("role", "node") not in {"node", "probe"}:
        raise ValueError("结果缓存身份无效")
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    if folder.is_symlink():
        raise ValueError("拒绝使用符号链接结果缓存")
    return folder


def persist_result(config, task_id, data):
    if not UUID_RE.fullmatch(task_id):
        raise ValueError("结果缓存任务 ID 无效")
    folder = outbox_dir(config)
    output = folder / (task_id + ".json")
    temporary = output.with_suffix(".tmp")
    with open(temporary, "w", encoding="utf8") as file:
        os.chmod(temporary, 0o600)
        json.dump({"id": task_id, "data": data, "createdAt": time.time()}, file, separators=(",", ":"))
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, output)
    return output


def remove_result(file):
    try:
        file.unlink()
    except FileNotFoundError:
        pass


def flush_results(config):
    # Results survive a service restart. Retrying delivery never invokes measure().
    folder = outbox_dir(config)
    for file in sorted(folder.glob("*.json"))[:16]:
        if not UUID_RE.fullmatch(file.stem) or file.is_symlink():
            continue
        try:
            payload = json.loads(file.read_text(encoding="utf8"))
        except FileNotFoundError:
            continue  # The sending worker won the delivery race.
        if payload.get("id") != file.stem:
            raise ValueError("结果缓存 ID 不一致")
        if time.time() - payload.get("createdAt", 0) > 7 * 86400:
            remove_result(file)
            continue
        try:
            api_request(config, "result", method="POST", body={"id": payload["id"], "data": payload["data"]})
        except urllib.error.HTTPError as error:
            if error.code == 409:
                remove_result(file)
                continue
            raise
        remove_result(file)


def _native_task(config, task, listeners):
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
        data = {"kind": "speed" if task.get("operation") in {"benchmark", "listen", "http-speed", "iperf-speed", "public-speed"} else task.get("operation"), "state": "failed", "diagnostic": str(error)[:4000]}
        if task.get("operation") in {"latency", "tcp-quality"}:
            data["tcpQuality"] = native.tcp_connect_quality("", 443, 1)
    cached = persist_result(config, task_id, data) if task.get("operation") != "listen" else None
    # A failed result upload is retried; never repeat a bandwidth measurement.
    for attempt in range(3):
        try:
            api_request(config, "result", method="POST", body={"id": task_id, "data": data})
            if cached:
                remove_result(cached)
            return
        except urllib.error.HTTPError as error:
            if error.code in {401, 409}:
                if cached and error.code == 409:
                    remove_result(cached)
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
    pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="aster-latency")
    pending = {}
    print(f"网络观测探测器已启动，{config.get('role', 'node')} {config['nodeUuid']}。", flush=True)
    try:
        while True:
            try:
                for task_id, future in list(pending.items()):
                    if future.done():
                        del pending[task_id]
                        try:
                            future.result()
                        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as error:
                            print(f"结果回传失败，未重复测量：{error}", file=sys.stderr, flush=True)
                flush_results(config)
                native_response = None
                try:
                    native_response = api_request(config, "poll")
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
                        task = native_response["task"]
                        if task.get("operation") == "latency" and task.get("options", {}).get("reportVersion") == 3:
                            pending[task["id"]] = pool.submit(native_task, config, task, listeners)
                        else:
                            native_task(config, task, listeners)
                        continue
            except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError, TypeError) as error:
                print(f"测量暂不可用：{error}", file=sys.stderr, flush=True)
            # Listener expiry is local and independent of panel/network availability.
            for key, listener in list(listeners.items()):
                if time.monotonic() >= listener.expires:
                    listener.close()
                    del listeners[key]
            time.sleep(0.5 if pending else 3 if listeners else POLL_SECONDS)
    finally:
        stop.set()
        native.reconcile_tasks(set())
        pool.shutdown(wait=True)
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
