#!/usr/bin/env python3
"""Outbound-only, allowlisted probe worker for Komari's network observatory."""

import argparse
import getpass
import grp
import json
import os
import pwd
import re
import shutil
import signal
import socket
import threading
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import native

CONFIG_PATH = Path("/etc/aster-network-observatory/agent.json")
SERVICE_NAME = "aster-network-observatory-agent.service"
SERVICE_DIR = Path("/usr/local/libexec/aster-network-observatory")
INIT_DIR = Path("/etc/init.d")
RUNNER_VERSION = "1.14.0"
RUN_INSTANCE = uuid.uuid4().hex
POLL_SECONDS = 15
REQUEST_TIMEOUT = 25
STATE_DIR = Path("/var/lib/aster-network-observatory")
TCPQUALITY_SOCKET = Path("/run/aster-network-observatory/tcpquality.sock")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
_outbox_scans = OrderedDict()
_outbox_scan_lock = threading.Lock()
_helper_allowed = None
_helper_allowed_lock = threading.Lock()


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


class TcpQualityNotConnected(OSError):
    """The helper socket failed before any request bytes could be sent."""


def tcpquality_request(action, **values):
    """Talk only to the locally installed, fixed-purpose privileged service."""
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(3)
        try:
            connection.connect(str(TCPQUALITY_SOCKET))
        except OSError as error:
            raise TcpQualityNotConnected(str(error)) from error
        connection.sendall((json.dumps({"action": action, **values}, separators=(",", ":")) + "\n").encode())
        data = bytearray()
        while b"\n" not in data:
            chunk = connection.recv(65536)
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > 1100000:
                raise ValueError("TcpQuality 服务响应过大")
    response = json.loads(bytes(data).split(b"\n", 1)[0].decode("utf-8"))
    if not isinstance(response, dict) or response.get("error"):
        raise ValueError(str(response.get("error", "TcpQuality 服务响应无效")) if isinstance(response, dict) else "TcpQuality 服务响应无效")
    return response


def tcpquality_tasks(config):
    if config.get("role", "node") != "node":
        return None
    try:
        result = tcpquality_request("list")
        tasks = result.get("tasks")
        if not isinstance(tasks, list):
            return None
        return [task for task in tasks if isinstance(task, dict) and task.get("nodeUuid") == config["nodeUuid"]
                and UUID_RE.fullmatch(task.get("id", "")) and task.get("state") in ("running", "complete")]
    except (OSError, ValueError, TypeError):
        return None


def heartbeat(config, stop):
    # A long route/throughput test must not make a healthy worker appear offline.
    while not stop.is_set():
        try:
            helper_tasks = tcpquality_tasks(config)
            features = ["report-v3", "latency-samples", "full-mtr", "speed-intervals", "http-speed", "tcp-quality", "public-speed"]
            if helper_tasks is not None:
                features.append("tcpquality-full")
                try:
                    if "nodequality-full" in tcpquality_request("capabilities").get("operations", []):
                        features.append("nodequality-full")
                except (OSError, ValueError, TypeError):
                    pass  # Older helpers only support TcpQuality.
            active = native.active_tasks() + [t["id"] for t in (helper_tasks or [])]
            response = api_request(config, "heartbeat", method="POST", body={"version": RUNNER_VERSION, "instanceId": RUN_INSTANCE, "tools": [x for x in ("curl", "nexttrace", "traceroute", "mtr", "iperf3", "openssl", "nping") if shutil.which(x)], "authScheme": native.auth_scheme(), "features": features, "activeJobIds": list(dict.fromkeys(active))})
            if "activeJobIds" in response:
                allowed = set(response["activeJobIds"])
                global _helper_allowed
                with _helper_allowed_lock:
                    _helper_allowed = allowed
                native.reconcile_tasks(allowed)
                for task in helper_tasks or []:
                    if task["state"] == "running" and task["id"] not in allowed:
                        try:
                            tcpquality_request("cancel", id=task["id"], nodeUuid=config["nodeUuid"])
                        except (OSError, ValueError):
                            pass
        except (urllib.error.URLError, OSError, ValueError):
            pass  # Polling reports connectivity errors; older plugins lack heartbeat.
        stop.wait(30)


def enable_service(probe_id=""):
    marker = CONFIG_PATH.parent / "service-manager"
    manager = marker.read_text().strip() if marker.exists() else "systemd"
    if manager == "systemd":
        name = "aster-network-observatory-probe@" + probe_id + ".service" if probe_id else SERVICE_NAME
        subprocess.run(["systemctl", "enable", name], check=True)
        subprocess.run(["systemctl", "restart", name], check=True)
    elif manager == "openrc":
        if probe_id and not UUID_RE.fullmatch(probe_id):
            raise ValueError("大陆探针 ID 无效")
        name = "aster-network-observatory" + ("-probe-" + probe_id if probe_id else "")
        # One trusted template per identity; no user-supplied shell fragments.
        with tempfile.NamedTemporaryFile("wb", dir=INIT_DIR, delete=False) as temporary:
            temporary.write((SERVICE_DIR / "aster-network-observatory.openrc").read_bytes())
            path = Path(temporary.name)
        os.chmod(path, 0o755)
        os.replace(path, INIT_DIR / name)
        subprocess.run(["rc-update", "add", name, "default"], check=True)
        status = subprocess.run(["rc-service", name, "status"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["rc-service", name, "restart" if status.returncode == 0 else "start"], check=True)
    else:
        raise ValueError("服务管理器标记无效，请重新安装探测器")
    return name


def worker_capacity():
    marker = CONFIG_PATH.parent / "install-profile"
    return 1 if marker.exists() and marker.read_text().strip() == "lite" else 4


def configure(server_url="", node_uuid="", probe_id=""):

    if os.geteuid() != 0:
        raise PermissionError("请使用 sudo 运行配置向导，以安全写入节点凭证")
    if probe_id and not UUID_RE.fullmatch(probe_id):
        raise ValueError("大陆探针 ID 无效")
    if probe_id and node_uuid:
        raise ValueError("--probe-id 与 --node-uuid 不能同时使用")
    config_target = CONFIG_PATH.with_name("probe-" + probe_id + ".json") if probe_id else CONFIG_PATH
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
    service_name = enable_service(probe_id)
    print(f"已登记节点 {node_uuid} 并启动 {service_name}。")


def native_task(config, task, listeners):
    with native.task_context(task.get("id", "")):
        return _native_task(config, task, listeners)


def outbox_dir(config):
    folder = STATE_DIR / (config.get("role", "node") + "-" + config["nodeUuid"])
    if not UUID_RE.fullmatch(config["nodeUuid"]) or config.get("role", "node") not in {"node", "probe"}:
        raise ValueError("结果缓存身份无效")
    folder.mkdir(parents=True, exist_ok=True, mode=0o770)
    if folder.is_symlink():
        raise ValueError("拒绝使用符号链接结果缓存")
    return folder


def prepare_outbox(config):
    """Prepare one worker's existing outbox for both old and unprivileged runners.

    Called as root before starting that worker. Never follow a link when
    adjusting ownership or permissions; do not touch other workers' data.
    """
    if os.geteuid() != 0:
        raise PermissionError("准备探测器工作目录需要 root")
    account = pwd.getpwnam("aster-netobs")
    group = grp.getgrnam("aster-netobs").gr_gid
    if account.pw_uid == 0 or group == 0 or account.pw_gid != group:
        raise ValueError("aster-netobs 必须使用非 root UID 和独立主组；请检查系统账户配置")
    role, identity = config.get("role", "node"), config["nodeUuid"]
    if role not in {"node", "probe"} or not UUID_RE.fullmatch(identity):
        raise ValueError("工作目录身份无效")
    root_fd = os.open(STATE_DIR, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchown(root_fd, 0, group)
        os.fchmod(root_fd, 0o750)
        name = role + "-" + identity
        try:
            os.mkdir(name, 0o770, dir_fd=root_fd)
        except FileExistsError:
            pass
        folder_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
        try:
            os.fchown(folder_fd, 0, group)
            os.fchmod(folder_fd, 0o770)
            for entry in os.listdir(folder_fd):
                stem = entry.split('.', 1)[0]
                if not UUID_RE.fullmatch(stem) or entry[len(stem):] not in {'.json', '.tmp', '.start.json', '.start.tmp', '.orphan.json'}:
                    continue
                fd = os.open(entry, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder_fd)
                try:
                    info = os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                        raise ValueError("拒绝迁移非普通文件或硬链接结果缓存")
                    os.fchown(fd, 0, group)
                    os.fchmod(fd, 0o660 if entry.endswith('.tmp') else 0o640)
                finally:
                    os.close(fd)
        finally:
            os.close(folder_fd)
    finally:
        os.close(root_fd)


def atomic_outbox_write(output, payload):
    """Use a unique exclusive temporary name so links and old runners cannot collide."""
    fd, name = tempfile.mkstemp(prefix=output.name + '.', suffix='.tmp', dir=output.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf8') as file:
            json.dump(payload, file, separators=(',', ':'))
            file.flush()
            os.fsync(file.fileno())
            os.fchmod(file.fileno(), 0o640)
        os.replace(name, output)
    except BaseException:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass
        raise


def persist_result(config, task_id, data, revision=None):
    if not UUID_RE.fullmatch(task_id):
        raise ValueError("结果缓存任务 ID 无效")
    folder = outbox_dir(config)
    output = folder / (task_id + ".json")
    payload = {"id": task_id, "data": data, "createdAt": time.time()}
    if revision is not None:
        payload["helperRevision"] = revision
    atomic_outbox_write(output, payload)
    return output


def remove_result(file):
    try:
        file.unlink()
    except FileNotFoundError:
        pass


def retain_orphan(file):
    """An expired full report remains recoverable instead of being silently deleted."""
    destination = file.with_name(file.stem + ".orphan.json")
    try:
        os.replace(file, destination)
        print(f"TcpQuality 结果未被面板接收，已保留：{destination}", file=sys.stderr, flush=True)
    except FileNotFoundError:
        pass


def close_outbox_scans():
    with _outbox_scan_lock:
        for scan in _outbox_scans.values():
            scan.close()
        _outbox_scans.clear()


def outbox_batch(folder):
    """Advance a bounded directory cursor, including after a failed upload.

    Each worker process normally owns one identity. Retain a small LRU of
    cursors for callers using more than one; the durable JSON files remain the
    source of truth across restart. A failing record is retried next pass, so it
    cannot pin the queue ahead of every other record.
    """
    key, selected = str(folder), 0
    for _ in range(64):
        with _outbox_scan_lock:
            scan = _outbox_scans.get(key)
            if scan is None:
                scan = os.scandir(folder)
                _outbox_scans[key] = scan
                if len(_outbox_scans) > 8:
                    _, old = _outbox_scans.popitem(last=False)
                    old.close()
            _outbox_scans.move_to_end(key)
            entry = next(scan, None)
            if entry is None:
                scan.close()
                del _outbox_scans[key]
                return
        name = entry.name
        if not name.endswith(".json") or not UUID_RE.fullmatch(name[:-5]) or not entry.is_file(follow_symlinks=False):
            continue
        yield folder / name
        selected += 1
        if selected == 16:
            return


def flush_results(config):
    # Results survive a service restart. Retrying delivery never invokes measure().
    folder = outbox_dir(config)
    for file in outbox_batch(folder):
        if not UUID_RE.fullmatch(file.stem) or file.is_symlink():
            continue
        try:
            payload = json.loads(file.read_text(encoding="utf8"))
        except FileNotFoundError:
            continue  # The sending worker won the delivery race.
        if payload.get("id") != file.stem:
            raise ValueError("结果缓存 ID 不一致")
        full = payload.get("data", {}).get("kind") in {"tcpquality-full", "nodequality-full"}
        if not full and time.time() - payload.get("createdAt", 0) > 7 * 86400:
            remove_result(file)
            continue
        try:
            api_request(config, "result", method="POST", body={"id": payload["id"], "data": payload["data"]})
        except urllib.error.HTTPError as error:
            if error.code == 409:
                retain_orphan(file) if full else remove_result(file)
                continue
            raise
        remove_result(file)
        if full:
            try:
                tcpquality_request("ack", id=payload["id"], nodeUuid=config["nodeUuid"], revision=payload.get("helperRevision"))
            except (OSError, ValueError):
                pass  # A helper replay is safe and acknowledged on the next pass.


def persist_helper_start(config, task):
    task_id = task.get("id", "")
    if not UUID_RE.fullmatch(task_id):
        raise ValueError("TcpQuality 任务 ID 无效")
    folder = outbox_dir(config)
    output = folder / (task_id + ".start.json")
    atomic_outbox_write(output, {"id": task_id, "kind": task.get("operation", "tcpquality-full"), "options": task.get("options") or {}})
    with _helper_allowed_lock:
        if _helper_allowed is not None:
            _helper_allowed.add(task_id)


def flush_helper_starts(config):
    folder = outbox_dir(config)
    with _helper_allowed_lock:
        allowed = None if _helper_allowed is None else set(_helper_allowed)
    if allowed is None:
        return
    for file in folder.glob("*.start.json"):
        task_id = file.name[:-len(".start.json")]
        if not UUID_RE.fullmatch(task_id) or file.is_symlink():
            continue
        # A previous attempt may have saved a terminal failure immediately
        # before a crash. Never start it after that result has been saved.
        if (folder / (task_id + ".json")).exists():
            remove_result(file)
            continue
        if task_id not in allowed:
            # A heartbeat can have been taken before this task was claimed.
            # Retain the intent until a later heartbeat confirms the lease.
            continue
        payload = json.loads(file.read_text(encoding="utf8"))
        if payload.get("id") != task_id:
            raise ValueError("TcpQuality 启动缓存 ID 不一致")
        # Persist uncertainty before contacting the helper. If the process
        # crashes or loses the response, retries remain idempotent and never
        # report failure while the real measurement might be running.
        first_attempt = not payload.get("attempted", False)
        if first_attempt:
            payload["attempted"] = True
            atomic_outbox_write(file, payload)
        try:
            tcpquality_request("start", id=task_id, nodeUuid=config["nodeUuid"], kind=payload.get("kind", "tcpquality-full"), options=payload.get("options", {}))
        except TcpQualityNotConnected:
            if not first_attempt:
                raise  # A prior request may have started the measurement.
            persist_result(config, task_id, {"kind": payload.get("kind", "tcpquality-full"), "state": "failed",
                "diagnostic": "完整 TcpQuality 执行器未连接；请检查服务后重新检测"})
            remove_result(file)
            continue
        remove_result(file)


def collect_helper_results(config):
    """Reattach after agent restart without launching the test again."""
    for task in tcpquality_tasks(config) or []:
        if task["state"] != "complete":
            continue
        folder = outbox_dir(config)
        if (folder / (task["id"] + ".orphan.json")).exists():
            continue
        result = tcpquality_request("status", id=task["id"], nodeUuid=config["nodeUuid"])
        data = result.get("data")
        revision = result.get("revision")
        if result.get("state") == "complete" and isinstance(data, dict) and data.get("kind") in {"tcpquality-full", "nodequality-full"} and type(revision) is int and revision > 0:
            target = folder / (task["id"] + ".json")
            if not target.exists():
                persist_result(config, task["id"], data, revision=revision)


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
                    retain_orphan(cached) if data.get("kind") in {"tcpquality-full", "nodequality-full"} else remove_result(cached)
                return
            if attempt == 2:
                raise
        except (urllib.error.URLError, OSError):
            if attempt == 2:
                raise
        time.sleep(2)


def run_daemon(config_path, stop=None):
    config = load_config(config_path)
    global _helper_allowed
    with _helper_allowed_lock:
        _helper_allowed = None
    stop = stop if stop is not None else threading.Event()
    worker = threading.Thread(target=heartbeat, args=(config, stop), daemon=True)
    worker.start()
    listeners = {}
    capacity = worker_capacity()
    pool = ThreadPoolExecutor(max_workers=capacity, thread_name_prefix="aster-latency")
    finished = threading.Event()
    def cancel_on_stop():
        stop.wait()
        while not finished.is_set():
            native.reconcile_tasks(set())
            finished.wait(0.25)
    threading.Thread(target=cancel_on_stop, daemon=True).start()
    pending = {}
    print(f"网络观测探测器已启动，{config.get('role', 'node')} {config['nodeUuid']}。", flush=True)
    try:
        while not stop.is_set():
            try:
                for task_id, future in list(pending.items()):
                    if future.done():
                        del pending[task_id]
                        try:
                            future.result()
                        except (urllib.error.URLError, OSError, ValueError, KeyError, TypeError) as error:
                            print(f"结果回传失败，未重复测量：{error}", file=sys.stderr, flush=True)
                if len(pending) >= capacity:
                    stop.wait(0.5)
                    continue
                flush_helper_starts(config)
                collect_helper_results(config)
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
                        if task.get("operation") in {"tcpquality-full", "nodequality-full"}:
                            persist_helper_start(config, task)
                            # A claimed task is authorized even before the next heartbeat.
                            with _helper_allowed_lock:
                                if _helper_allowed is None:
                                    _helper_allowed = {task["id"]}
                            flush_helper_starts(config)
                        elif task.get("operation") == "latency" and task.get("options", {}).get("reportVersion") == 3:
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
            stop.wait(0.5 if pending else 3 if listeners else POLL_SECONDS)
    finally:
        stop.set()
        native.reconcile_tasks(set())
        pool.shutdown(wait=True)
        finished.set()
        close_outbox_scans()
        for listener in listeners.values():
            listener.close()


def main():
    parser = argparse.ArgumentParser(description="Aster 网络观测节点探测器")
    subparsers = parser.add_subparsers(dest="command", required=True)
    configure_parser = subparsers.add_parser("configure", help="交互式登记节点凭证并启用服务")
    configure_parser.add_argument("--server-url", default="")
    configure_parser.add_argument("--node-uuid", default="")
    configure_parser.add_argument("--probe-id", default="")
    run_parser = subparsers.add_parser("run", help="运行节点任务轮询服务")
    run_parser.add_argument("--config", default=str(CONFIG_PATH))
    check_parser = subparsers.add_parser("check", help="检查配置、运行环境和面板凭证，不启动服务")
    check_parser.add_argument("--config", default=str(CONFIG_PATH))
    prepare_parser = subparsers.add_parser("prepare", help="为降权服务安全准备本工作身份的缓存目录")
    prepare_parser.add_argument("--config", default=str(CONFIG_PATH))
    args = parser.parse_args()
    try:
        if args.command == "configure":
            configure(args.server_url, args.node_uuid, args.probe_id)
        elif args.command == "check":
            api_request(load_config(args.config), "verify", method="POST", body={})
        elif args.command == "prepare":
            prepare_outbox(load_config(args.config))
        else:
            stop = threading.Event()
            previous = signal.signal(signal.SIGTERM, lambda *_: stop.set())
            try:
                run_daemon(args.config, stop)
            finally:
                signal.signal(signal.SIGTERM, previous)
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"网络观测探测器无法启动：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
