#!/usr/bin/env python3
"""Fixed native measurements. Jobs are data; no supplied text is executed."""
import hashlib
import ipaddress
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import threading
import socket
import statistics
import signal
import math
import sys
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path

HOST = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", re.I)
_active = {}
_active_lock = threading.Lock()
_task_local = threading.local()


@contextmanager
def task_context(task_id):
    event = threading.Event()
    with _active_lock:
        _active[task_id] = event
    _task_local.cancel = event
    try:
        yield
    finally:
        with _active_lock:
            _active.pop(task_id, None)
        _task_local.cancel = None


def active_tasks():
    with _active_lock:
        return list(_active)


def reconcile_tasks(allowed):
    with _active_lock:
        for task_id, event in _active.items():
            if task_id not in allowed:
                event.set()


def cancelled():
    event = getattr(_task_local, "cancel", None)
    return bool(event and event.is_set())


def host(value):
    if not isinstance(value, str) or not value or len(value) > 253:
        raise ValueError("测量目标无效")
    try:
        ipaddress.ip_address(value)
    except ValueError:
        if re.fullmatch(r"[0-9.]+", value) or not HOST.fullmatch(value):
            raise ValueError("测量目标必须是主机名或 IP")
    return value


def integer(value, minimum, maximum, label):
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(label + "无效")
    return value


def execute(command, timeout=30, env=None):
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
    deadline = time.monotonic() + timeout
    while True:
        if cancelled() or time.monotonic() >= deadline:
            code, reason = (130, "检测已取消") if cancelled() else (124, "测量超时")
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                output, _ = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                output, _ = process.communicate()
            return code, output, reason
        try:
            output, error = process.communicate(timeout=min(0.25, max(0.01, deadline - time.monotonic())))
            return process.returncode, output, error[:4000]
        except subprocess.TimeoutExpired:
            continue


def family_args(options):
    value = options.get("family", "auto")
    if value not in {"auto", "4", "6"}:
        raise ValueError("地址族无效")
    return [] if value == "auto" else ["-" + value]


def tcp_connect_quality(address, port, count):
    """Full TCP handshakes to one observed IP; failures are not packet loss."""
    count = integer(count, 1, 10, "TCP 样本数")
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return {"method": "TCP connect", "state": "unavailable", "address": "", "addressScope": "unknown", "sent": 0, "received": 0, "failurePercent": None, "avgMs": None, "medianMs": None, "minMs": None, "maxMs": None, "stdevMs": None, "samples": []}
    samples, attempts = [], []
    family = socket.AF_INET6 if ip.version == 6 else socket.AF_INET
    for i in range(count):
        if cancelled():
            break
        started = time.monotonic()
        try:
            with socket.socket(family, socket.SOCK_STREAM) as connection:
                connection.settimeout(1.5)
                connection.connect((str(ip), port))
                elapsed = (time.monotonic() - started) * 1000
                samples.append(elapsed)
                attempts.append({"index": i + 1, "state": "ok", "rttMs": elapsed, "address": str(ip), "error": ""})
        except OSError as error:
            attempts.append({"index": i + 1, "state": "timeout" if isinstance(error, (TimeoutError, socket.timeout)) else "refused" if isinstance(error, ConnectionRefusedError) else "failed", "rttMs": None, "address": str(ip), "error": str(error)[:200]})
        if i + 1 < count:
            time.sleep(0.1)
    sent = len(attempts)
    return {"method": "TCP connect", "state": "ok" if len(samples) == count else "partial" if samples else "failed", "address": str(ip), "addressScope": "public" if ip.is_global and not ip.is_multicast else "non-public", "sent": sent, "received": len(samples), "failurePercent": 100 * (sent - len(samples)) / sent if sent else None, "avgMs": statistics.mean(samples) if samples else None, "medianMs": statistics.median(samples) if samples else None, "minMs": min(samples) if samples else None, "maxMs": max(samples) if samples else None, "stdevMs": statistics.pstdev(samples) if samples else None, "samples": attempts}


def resolve_ip(target, options):
    """Use the OS resolver in a bounded child, then pin this measurement's IP."""
    pinned = options.get("pinnedIp")
    if pinned:
        candidates = [pinned]
    else:
        resolver = "import socket,sys,json; f={'4':socket.AF_INET,'6':socket.AF_INET6}.get(sys.argv[2],socket.AF_UNSPEC); print(json.dumps(list(dict.fromkeys(r[4][0] for r in socket.getaddrinfo(sys.argv[1],None,f,socket.SOCK_STREAM)))[:16]))"
        code, raw, error = execute([sys.executable, "-c", resolver, host(target), options.get("family", "auto")], 5)
        if code:
            raise ValueError("DNS 解析失败或超时：" + error[:200])
        candidates = json.loads(raw)
    for candidate in candidates:
        ip = ipaddress.ip_address(candidate)
        if options.get("family", "auto") in {"auto", str(ip.version)}:
            return str(ip)
    raise ValueError("没有符合地址族的解析地址")


def latency(target, options):
    target = host(target)
    family_args(options)
    port = integer(options.get("port", 443), 1, 65535, "端口")
    started = datetime.now(timezone.utc).isoformat()
    try:
        address = resolve_ip(target, options)
        ip = ipaddress.ip_address(address)
        if not ip.is_global or ip.is_multicast:
            raise ValueError("解析为非公网地址，未执行公共目标探测")
        quality = tcp_connect_quality(address, port, 10)
        data = {"kind": "latency", "state": quality["state"], "method": "TCP connect", "target": target, "resolvedIp": address, "family": str(ip.version), "port": port, "startedAt": started, "tcpQuality": quality}
        if options.get("https") and port == 443:
            # Independent application check; do not substitute its timing for TCP samples.
            data["https"] = website(target, {key: value for key, value in {**options, "pinnedIp": address}.items() if key != "tcpSamples"}) if shutil.which("curl") else {"kind": "website", "state": "missing", "diagnostic": "没有 curl，未采集 HTTPS 应用阶段"}
        data["completedAt"] = datetime.now(timezone.utc).isoformat()
        return data
    except (ValueError, OSError) as error:
        return {"kind": "latency", "state": "failed", "method": "TCP connect", "target": target, "family": options.get("family"), "port": port, "startedAt": started, "completedAt": datetime.now(timezone.utc).isoformat(), "errorStage": "dns", "diagnostic": str(error)[:500], "tcpQuality": tcp_connect_quality("", port, 10)}


def mtr_hops(payload):
    """Statistics from one MTR run only. Silence has no RTT, including Last=0."""
    hops = []
    for index, hub in enumerate(payload.get("report", {}).get("hubs", [])[:64]):
        sent = max(0, int(hub.get("Snt", 0)))
        loss = min(100, max(0, float(hub.get("Loss%", 100))))
        received = int(hub.get("Rcv", round(sent * (100 - loss) / 100)))
        responded = received > 0
        address = str(hub.get("host") or "")
        if address in {"???", "*"}:
            address = ""
        stats = {key: float(hub[field]) if responded and isinstance(hub.get(field), (int, float)) else None for key, field in [("lastMs", "Last"), ("avgMs", "Avg"), ("bestMs", "Best"), ("worstMs", "Wrst"), ("stdevMs", "StDev")]}
        hops.append({"ttl": int(hub.get("count", index + 1)), "address": address, "asn": "", "rttMs": stats["avgMs"], "sent": sent, "received": received, "receivedEstimated": "Rcv" not in hub, "lossPercent": loss, **stats})
    return hops


def mtr_route(target, options):
    address = resolve_ip(target, options)
    cycles = integer(options.get("packets", 20), 5, 50, "MTR 采样数")
    protocol = options.get("protocol", "tcp")
    if protocol not in {"tcp", "icmp"}:
        raise ValueError("路径协议无效")
    port = integer(options.get("port", 443), 1, 65535, "端口")
    command = ["mtr", *family_args(options), "--json", "--no-dns", "--report-cycles", str(cycles), "--interval", "0.2", "--max-ttl", "32"]
    if protocol == "tcp":
        command += ["--tcp", "--port", str(port)]
    code, output, error = execute([*command, address], 45)
    try:
        hops = mtr_hops(json.loads(output))
    except (ValueError, TypeError):
        hops = []
    complete = bool(hops and hops[-1]["address"] == address and hops[-1]["received"] > 0)
    terminal = hops[-1] if hops else {}
    return {"kind": "route", "state": "ok" if code == 0 and hops and complete else "partial" if code == 0 and hops else "failed", "method": "MTR", "target": target, "resolvedIp": address, "protocol": protocol, "family": str(ipaddress.ip_address(address).version), "port": port, "hops": hops, "complete": complete, "stopReason": "destination_reached" if complete else "unconfirmed", "quality": {"address": terminal.get("address", ""), "sent": terminal.get("sent", 0), "lossPercent": terminal.get("lossPercent"), "avgMs": terminal.get("avgMs"), "jitterMs": terminal.get("stdevMs"), "terminalConfirmed": complete}, "rawOutput": output[:16000], "diagnostic": error[:4000], "exitCode": code}


def website(target, options):
    target = host(target)
    port = integer(options.get("port", 443), 1, 65535, "端口")
    resource = options.get("path", "/")
    if not isinstance(resource, str) or not resource.startswith("/") or len(resource) > 500 or re.search(r"[\x00-\x20\x7f\\]", resource):
        raise ValueError("网站路径无效")
    authority = "[" + target + "]" if ":" in target else target
    url = "https://%s:%s%s" % (authority, port, resource)
    template = '{"httpStatus":%{http_code},"dns":%{time_namelookup},"connect":%{time_connect},"tls":%{time_appconnect},"ttfb":%{time_starttransfer},"total":%{time_total},"remoteIp":"%{remote_ip}","localIp":"%{local_ip}","redirects":%{num_redirects},"bytes":%{size_download},"tlsVerify":%{ssl_verify_result}}'
    base = ["curl", *family_args(options), "--noproxy", "*", "--proto", "=https", "--silent", "--show-error", "--connect-timeout", "5", "--max-time", "12", "--output", "/dev/null", "--write-out", template]
    if options.get("pinnedIp"):
        pinned = str(ipaddress.ip_address(options["pinnedIp"]))
        base += ["--resolve", "%s:%s:%s" % (target, port, "[" + pinned + "]" if ":" in pinned else pinned)]
    code, output, diagnostic = execute([*base, "--head", url], 15)
    try:
        data = json.loads(output)
    except (ValueError, TypeError):
        data = {}
    if data.get("httpStatus") == 405:
        code, output, diagnostic = execute([*base, "--range", "0-4095", "--max-filesize", "65536", url], 15)
        try:
            data = json.loads(output)
        except (ValueError, TypeError):
            data = {}
    status = data.get("httpStatus", 0)
    responded = isinstance(status, int) and status > 0
    stage = "response" if responded else "dns" if code == 6 else "tls" if code in {35, 51, 60} else "response" if data.get("tls", 0) > 0 else "tls" if data.get("connect", 0) > 0 else "connect"
    tcp_address = data.get("remoteIp", "")
    if "tcpSamples" in options and not tcp_address and code != 6:
        # A failed curl connect may omit remote_ip. Resolve with the same OS
        # resolver in a bounded child; Python's getaddrinfo has no timeout.
        resolver = "import socket,sys,json; f={'4':socket.AF_INET,'6':socket.AF_INET6}.get(sys.argv[2],socket.AF_UNSPEC); print(json.dumps([r[4][0] for r in socket.getaddrinfo(sys.argv[1],None,f,socket.SOCK_STREAM)][:4]))"
        resolve_code, resolved, _ = execute([sys.executable, "-c", resolver, target, options.get("family", "auto")], 3)
        try:
            candidates = json.loads(resolved) if resolve_code == 0 else []
            tcp_address = candidates[0] if isinstance(candidates, list) and candidates else ""
        except (ValueError, TypeError):
            pass
    return {
        "kind": "website", "target": target, "family": options.get("family", "auto"),
        "state": "ok" if responded and 200 <= status < 400 else "application" if responded else "failed",
        "errorStage": "" if responded else stage, "exitCode": code,
        "httpStatus": status, "resolvedIp": data.get("remoteIp", ""), "localIp": data.get("localIp", ""),
        "timingsMs": {"dns": 1000 * data.get("dns", 0), "connect": 1000 * max(0, data.get("connect", 0) - data.get("dns", 0)), "tls": 1000 * max(0, data.get("tls", 0) - data.get("connect", 0)), "ttfb": 1000 * data.get("ttfb", 0), "total": 1000 * data.get("total", 0)},
        "tlsVerified": data.get("tlsVerify") == 0 and data.get("tls", 0) > 0,
        "path": resource,
        "tcpQuality": tcp_connect_quality(tcp_address, port, options["tcpSamples"]) if "tcpSamples" in options else None,
        "diagnostic": diagnostic,
    }


def parse_traceroute(output):
    hops = []
    for line in output.splitlines():
        match = re.match(r"^\s*(\d{1,2})\s+(\*|[0-9a-fA-F:.]+)(?:\s+([0-9.]+)\s*ms)?", line)
        if match:
            hops.append({"ttl": int(match[1]), "address": "" if match[2] == "*" else match[2], "asn": "", "rttMs": float(match[3]) if match[3] else None})
    return hops


def route(target, options):
    target = host(target)
    if options.get("fullMtr") and shutil.which("mtr"):
        result = mtr_route(target, options)
        if result["hops"]:
            return result
    protocol = options.get("protocol", "tcp")
    if protocol not in {"tcp", "icmp"}:
        raise ValueError("路径协议无效")
    port = integer(options.get("port", 443), 1, 65535, "端口")
    hops, output, diagnostic, code = [], "", "", 127
    stop_reason, method = "unknown", "nexttrace"
    if shutil.which("nexttrace"):
        command = ["nexttrace", *family_args(options), "--json", "--no-rdns", "--max-hops", "32", "--queries", "3"]
        if protocol == "tcp":
            command += ["--tcp", "--port", str(port)]
        code, output, diagnostic = execute([*command, target], 85)
        try:
            payload = json.loads(output[output.index("{"):output.rindex("}") + 1])
            for index, probes in enumerate(payload.get("Hops", [])):
                probes = probes if isinstance(probes, list) else [probes]
                value = next((p for p in probes if p.get("Success")), probes[0] if probes else {})
                address, geo = value.get("Address") or {}, value.get("Geo") or {}
                if not isinstance(geo, dict):
                    geo = {}
                if not geo.get("asnumber"):
                    # Queries at one TTL can hit different routers. Reuse metadata
                    # only from another response for the same IP, never an ECMP peer.
                    geo = next((p["Geo"] for p in probes if p.get("Address") == value.get("Address") and isinstance(p.get("Geo"), dict) and p["Geo"].get("asnumber")), geo)
                asn = re.sub(r"^AS", "", str(geo.get("asnumber") or "")).strip()
                hops.append({"ttl": value.get("TTL", index + 1), "address": address.get("IP", "") if isinstance(address, dict) else address, "asn": asn, "rttMs": value.get("RTT", 0) / 1e6 if value.get("Success") else None, "network": str(geo.get("owner") or geo.get("isp") or "")[:160], "location": " · ".join(str(geo.get(k) or "") for k in ("country", "prov", "city") if geo.get(k))[:160], "prefix": str(geo.get("prefix") or "")[:80], "asnSource": "NextTrace / " + str(geo.get("source") or "GeoIP") if asn else "", "asnStatus": "available" if asn else "lookup-failed" if geo.get("source") in {"timeout", "pending"} else "not-provided"})
            stop_reason = (payload.get("StopReason") or {}).get("reason", "unknown")
        except (ValueError, TypeError, KeyError):
            pass
    if code != 0 or not hops:
        first_error = diagnostic or output[:2000]
        method = "traceroute"
        command = ["traceroute", *family_args(options), "-n", "-q", "3", "-m", "32", "-w", "0.5"]
        command += ["-T", "-p", str(port)] if protocol == "tcp" else ["-I"]
        code, output, diagnostic = execute([*command, target], 60)
        diagnostic = ("NextTrace: " + first_error + "\n" + diagnostic)[:4000]
        hops = parse_traceroute(output)
        try:
            resolved = {row[4][0] for row in socket.getaddrinfo(target, None)}
            if hops and hops[-1]["address"] in resolved:
                stop_reason = "destination_reached"
        except OSError:
            pass
    quality = None
    if options.get("quality", True) and shutil.which("mtr"):
        command = ["mtr", *family_args(options), "--json", "--no-dns", "--report-cycles", "20", "--interval", "0.2"]
        if protocol == "tcp":
            command += ["--tcp", "--port", str(port)]
        mtr_code, mtr_output, mtr_error = execute([*command, target], 25)
        try:
            hubs = json.loads(mtr_output).get("report", {}).get("hubs", [])
            if hubs:
                last = hubs[-1]
                quality = {"address": last.get("host", ""), "sent": last.get("Snt", 0), "lossPercent": last.get("Loss%", 0), "avgMs": last.get("Avg", 0), "jitterMs": last.get("StDev", 0), "terminalConfirmed": bool(hops and last.get("host") == hops[-1]["address"] and stop_reason == "destination_reached")}
        except (ValueError, TypeError):
            diagnostic += "\nMTR: " + mtr_error
    return {"kind": "route", "target": target, "family": options.get("family", "auto"), "protocol": protocol, "port": port, "state": "ok" if code == 0 and hops else "failed", "exitCode": code, "method": method, "hops": hops, "stopReason": stop_reason, "complete": stop_reason == "destination_reached", "quality": quality, "diagnostic": (diagnostic + "\n" + output)[:8000]}


def auth_scheme():
    if not shutil.which("iperf3"):
        return "unavailable"
    _, output, error = execute(["iperf3", "--help"], 5)
    if "--rsa-private-key-path" not in output + error:
        return "unavailable"
    return "oaep" if "--use-pkcs1-padding" in output + error else "pkcs1"


def receiver_intervals(payload, reverse):
    """Client is receiver in reverse mode; server is receiver in forward mode."""
    receiver = payload if reverse else payload.get("server_output_json")
    if isinstance(receiver, str):
        try:
            receiver = json.loads(receiver)
        except ValueError:
            receiver = None
    if not isinstance(receiver, dict):
        return [], "unavailable"
    intervals, origin = [], None
    for interval in receiver.get("intervals", [])[:80]:
        summary = interval.get("sum", {})
        if summary.get("omitted") or summary.get("sender") is True:
            continue
        start, end, duration, size = (summary.get(key) for key in ["start", "end", "seconds", "bytes"])
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 0 for v in [start, end, duration, size]) or duration <= 0:
            continue
        if origin is None:
            origin = start
        intervals.append({"start": start - origin, "end": end - origin, "seconds": duration, "bytes": size, "bitsPerSecond": size * 8 / duration, "completeSecond": 0.95 <= duration <= 1.05})
    return intervals, "client-receiver" if reverse else "server-receiver"


def sender_tcp_metrics(payload, reverse):
    sender = payload.get("server_output_json") if reverse else payload
    if isinstance(sender, str):
        try:
            sender = json.loads(sender)
        except ValueError:
            sender = None
    sender = sender if isinstance(sender, dict) else {}
    # A receiver client's sum_sent may carry the server's sender counters even
    # when full server output is unavailable. RTT is never taken from a ping.
    sent = sender.get("end", {}).get("sum_sent") or payload.get("end", {}).get("sum_sent") or {}
    retransmits = sent.get("retransmits")
    rtts = [row.get("sender", {}).get("mean_rtt") for row in sender.get("end", {}).get("streams", [])]
    rtts = [x / 1000 for x in rtts if isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0]
    return {"retransmits": retransmits if isinstance(retransmits, int) and retransmits >= 0 else None, "tcpRttMs": statistics.mean(rtts) if rtts else None, "tcpRttMethod": "iperf3 sender TCP_INFO mean_rtt (µs→ms)" if rtts else "unavailable", "tcpSampleSide": "server-sender" if reverse else "client-sender"}


def benchmark(target, options, credentials=None):
    target = host(target)
    port = integer(options.get("port", 5201), 1, 65535, "端口")
    seconds = integer(options.get("seconds", 10), 5, 20, "测速时长")
    streams = options.get("streams", [1, 4])
    if not isinstance(streams, list) or not streams or len(streams) > 2 or any(isinstance(x, bool) or x not in {1, 4, 8} for x in streams):
        raise ValueError("测速连接数无效")
    env = os.environ.copy()
    runs = []
    structured = options.get("reportVersion") == 3
    warmup = integer(options.get("warmupSeconds", 0), 0, 2, "测速预热时长") if structured else 0
    pinned = resolve_ip(target, options) if structured else target
    tool_version = ""
    if structured:
        _, version, _ = execute(["iperf3", "--version"], 5)
        tool_version = version.splitlines()[0][:120] if version else "unknown"
    with tempfile.TemporaryDirectory(prefix="aster-speed-") as directory:
        key = Path(directory) / "public.pem"
        if credentials:
            public = credentials.get("publicKey", "")
            if not isinstance(public, str) or not public.startswith("-----BEGIN PUBLIC KEY-----") or len(public) > 4096:
                raise ValueError("测速公钥无效")
            key.write_text(public)
            os.chmod(key, 0o600)
            if not isinstance(credentials.get("password"), str) or not re.fullmatch(r"[0-9a-f]{64}", credentials["password"]):
                raise ValueError("测速会话密码无效")
            env["IPERF3_PASSWORD"] = credentials["password"]
        for count in dict.fromkeys(streams):
            for reverse in [False, True]:
                if cancelled():
                    break
                command = ["iperf3", *family_args(options), "-c", pinned, "-p", str(port), "-t", str(seconds), "-P", str(count), "-J", "--connect-timeout", "5000"]
                if structured:
                    command += ["--get-server-output", "-i", "1"]
                    if warmup:
                        command += ["-O", str(warmup)]
                if reverse:
                    command += ["-R"]
                if credentials:
                    command += ["--username", "aster", "--rsa-public-key-path", str(key)]
                    if credentials.get("scheme") == "pkcs1" and auth_scheme() == "oaep":
                        command += ["--use-pkcs1-padding"]
                code, output, error = execute(command, seconds + warmup + 15, env)
                try:
                    payload = json.loads(output)
                except ValueError:
                    payload = {"error": error or output[:500] or "iperf3 未返回数据"}
                received = payload.get("end", {}).get("sum_received", {})
                sent = payload.get("end", {}).get("sum_sent", {})
                valid = code == 0 and not payload.get("error") and isinstance(received.get("bits_per_second"), (int, float)) and math.isfinite(received["bits_per_second"]) and received["bits_per_second"] >= 0
                if structured:
                    values = [received.get("bytes"), received.get("seconds")]
                    valid = valid and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 for v in values) and received.get("seconds", 0) > 0
                    actual_rate = received["bytes"] * 8 / received["seconds"] if valid else None
                else:
                    actual_rate = received.get("bits_per_second") if valid else None
                connected = payload.get("start", {}).get("connected") or [{}]
                intervals, interval_source = receiver_intervals(payload, reverse) if structured else ([{"seconds": x.get("sum", {}).get("end", 0), "bitsPerSecond": x.get("sum", {}).get("bits_per_second", 0)} for x in payload.get("intervals", [])[:25]], "legacy-client-output")
                tcp = sender_tcp_metrics(payload, reverse) if structured and valid else {"retransmits": sent.get("retransmits") if valid else None}
                omitted = sum(x.get("sum", {}).get("bytes", 0) for x in payload.get("intervals", []) if x.get("sum", {}).get("omitted"))
                direction = "upload" if (reverse and options.get("vpsRole", "server") == "server") or (not reverse and options.get("vpsRole", "server") == "client") else "download"
                runs.append({"direction": "target-to-source" if reverse else "source-to-target", "vpsDirection": direction, "streams": count, "state": "ok" if valid else "failed", "bitsPerSecond": actual_rate, "bytes": received.get("bytes") if valid else None, "seconds": received.get("seconds") if valid else None, **tcp, "remoteIp": connected[0].get("remote_host", ""), "intervals": intervals, "intervalSource": interval_source, "receiverIntervalsAvailable": bool(intervals), "maxBitsPerSecond": max((x["bitsPerSecond"] for x in intervals if x.get("completeSecond")), default=None), "warmupBytesObserved": omitted, "trafficBytesObserved": (received.get("bytes", 0) if valid else 0) + omitted, "congestionControl": payload.get("start", {}).get("test_start", {}).get("congestion") or payload.get("start", {}).get("sockopts", {}).get("tcp_congestion", "unknown"), "cpuLoad": payload.get("end", {}).get("cpu_utilization_percent", {}), "diagnostic": str(payload.get("error") or error)[:1000]})
    return {"kind": "speed", "target": target, "resolvedIp": pinned, "port": port, "family": options.get("family", "auto"), "protocol": "TCP", "method": "iperf3", "toolVersion": tool_version, "rateLimited": False, "warmupSeconds": warmup, "state": "ok" if runs and all(x["state"] == "ok" for x in runs) else "partial" if any(x["state"] == "ok" for x in runs) else "failed", "runs": runs}


def tcp_info(connection):
    """Read only the data socket. Unsupported layouts return unavailable."""
    try:
        import struct
        raw = connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 104)
        if len(raw) < 104 or not sys.platform.startswith("linux"):
            return {"tcpRttMs": None, "retransmits": None}
        return {"tcpRttMs": struct.unpack_from("=I", raw, 68)[0] / 1000,
                "retransmits": struct.unpack_from("=I", raw, 100)[0]}
    except (OSError, AttributeError):
        return {"tcpRttMs": None, "retransmits": None}


def http_speed(target, options, credentials=None):
    """One pinned HTTP data connection per direction; no rate limiting."""
    import http.client
    import ssl
    target = host(target)
    endpoint = options.get("endpoint") or {}
    if credentials and credentials.get("token") and endpoint.get("https", True) is False:
        raise ValueError("带密钥的测速端点必须使用 HTTPS")
    seconds = integer(options.get("seconds", 10), 5, 20, "测速时长")
    warmup = integer(options.get("warmupSeconds", 2), 0, 2, "预热")
    if options.get("streams", [1]) != [1]:
        raise ValueError("HTTP 测速仅支持单连接；多连接请选择 iperf3")
    port = integer(options.get("port", 443), 1, 65535, "端口")
    pinned = resolve_ip(target, options)
    if not ipaddress.ip_address(pinned).is_global or ipaddress.ip_address(pinned).is_multicast:
        raise ValueError("HTTP 测速端点必须是公网地址")
    paths = [("download", endpoint.get("path", "/")), ("upload", endpoint.get("uploadPath", ""))]
    load_before = list(os.getloadavg()) if hasattr(os, "getloadavg") else []
    runs = []
    for direction, path in paths:
        if not path:
            runs.append({"direction": "target-to-source" if direction == "download" else "source-to-target", "vpsDirection": direction, "streams": 1, "state": "missing", "diagnostic": "端点未提供获授权的上传接收接口", "intervals": []})
            continue
        if not isinstance(path, str) or not path.startswith("/") or any(c in path for c in "\r\n") or len(path) > 500:
            raise ValueError("HTTP 测速路径无效")
        connection, data_socket = None, None
        intervals, rtts, size, omitted, bucket, started, last = [], [], 0, 0, 0, 0, 0
        try:
            # Retain the underlying socket even if http.client detaches it at EOF.
            data_socket = socket.create_connection((pinned, port), timeout=5)
            if endpoint.get("https", True):
                data_socket = ssl.create_default_context().wrap_socket(data_socket, server_hostname=target)
            data_socket.settimeout(1)
            connection = http.client.HTTPConnection(target, port)
            connection.sock = data_socket
            headers = {"Host": target if port in {80, 443} else f"{target}:{port}", "Accept-Encoding": "identity", "User-Agent": "Aster-Network-Observatory/2", "Connection": "close"}
            if credentials and credentials.get("token"):
                headers["Authorization"] = "Bearer " + credentials["token"]
            started = time.monotonic()
            last = started + warmup
            deadline = last + seconds
            early = False
            if direction == "download":
                connection.request("GET", path, headers=headers)
                response = connection.getresponse()
                if response.status not in {200, 206} or response.getheader("Content-Encoding", "identity") != "identity":
                    raise ValueError(f"下载接口返回 HTTP {response.status} 或压缩响应；未跟随跳转")
                started = time.monotonic()
                last, deadline = started + warmup, started + warmup + seconds
                while time.monotonic() < deadline and not cancelled():
                    try:
                        block = response.read1(65536)
                    except socket.timeout:
                        break  # Socket readers cannot safely resume after timeout.
                    now = time.monotonic()
                    if not block:
                        early = now < deadline - 0.1
                        break
                    if now < started + warmup:
                        omitted += len(block)
                    else:
                        size += len(block)
                        bucket += len(block)
                        if now - last >= 1:
                            duration = now - last
                            intervals.append({"start": last - started - warmup, "end": now - started - warmup, "seconds": duration, "bytes": bucket, "bitsPerSecond": bucket * 8 / duration, "completeSecond": 0.95 <= duration <= 1.05})
                            last, bucket = now, 0
                            metrics = tcp_info(data_socket)
                            if metrics["tcpRttMs"] is not None:
                                rtts.append(metrics["tcpRttMs"])
                early = early or time.monotonic() < deadline - 0.1
                elapsed = max(0, time.monotonic() - started - warmup)
                if bucket and elapsed > last - started - warmup:
                    duration = elapsed - (last - started - warmup)
                    intervals.append({"start": last - started - warmup, "end": elapsed, "seconds": duration, "bytes": bucket, "bitsPerSecond": bucket * 8 / duration, "completeSecond": 0.95 <= duration <= 1.05})
                receiver = {"bytes": size, "seconds": elapsed, "intervals": intervals}
            else:
                # Companion receiver contract: chunked POST, explicit warmup,
                # receiver byte/time acknowledgement. Sent bytes are never speed.
                headers.update({"Transfer-Encoding": "chunked", "Content-Type": "application/octet-stream", "X-Aster-Warmup": str(warmup)})
                connection.putrequest("POST", path, skip_host=True)
                for name, value in headers.items():
                    connection.putheader(name, value)
                connection.endheaders()
                started = time.monotonic()
                deadline = started + warmup + seconds
                block = b"\0" * 65536
                last_tcp_sample = started
                while time.monotonic() < deadline and not cancelled():
                    connection.send(b"10000\r\n" + block + b"\r\n")
                    omitted += len(block)
                    now = time.monotonic()
                    if now - last_tcp_sample >= 0.25:
                        metrics = tcp_info(data_socket)
                        if metrics["tcpRttMs"] is not None:
                            rtts.append(metrics["tcpRttMs"])
                        last_tcp_sample = now
                connection.send(b"0\r\n\r\n")
                data_socket.settimeout(5)
                response = connection.getresponse()
                if response.status != 200:
                    raise ValueError(f"上传接收器返回 HTTP {response.status}")
                receiver = json.loads(response.read(32769))
                if not isinstance(receiver, dict) or receiver.get("schema") != "aster-http-receiver-v1":
                    raise ValueError("接收器未提供可核实的接收端报告")
                size, elapsed = receiver.get("bytes"), receiver.get("seconds")
                if not isinstance(size, int) or size < 0 or not isinstance(elapsed, (int, float)) or not math.isfinite(elapsed) or not 0 < elapsed <= seconds + 10:
                    raise ValueError("上传接收端字节/时间无效")
                intervals = receiver.get("intervals", [])[:80]
                for row in intervals:
                    if not all(isinstance(row.get(k), (int, float)) and math.isfinite(row[k]) and row[k] >= 0 for k in ["start", "end", "seconds", "bytes"]) or row["seconds"] <= 0:
                        raise ValueError("上传接收端区间无效")
                    row["bitsPerSecond"] = row["bytes"] * 8 / row["seconds"]
                    row["completeSecond"] = 0.95 <= row["seconds"] <= 1.05
                omitted = receiver.get("warmupBytes", 0)
                if not isinstance(omitted, int) or omitted < 0:
                    raise ValueError("上传接收端预热字节无效")
                if sum(r["bytes"] for r in intervals) > size:
                    raise ValueError("上传接收端区间字节超出总量")
            metrics = tcp_info(data_socket)
            try:
                congestion_control = data_socket.getsockopt(socket.IPPROTO_TCP, socket.TCP_CONGESTION, 64).rstrip(b"\0").decode("ascii")
            except (OSError, AttributeError, UnicodeError):
                congestion_control = "unavailable"
            rate = size * 8 / elapsed if elapsed > 0 and size > 0 else None
            runs.append({"direction": "target-to-source" if direction == "download" else "source-to-target", "vpsDirection": direction, "streams": 1, "state": ("partial" if early or cancelled() else "ok") if rate is not None else "failed", "bitsPerSecond": rate, "bytes": size, "seconds": elapsed, "intervals": intervals, "intervalSource": "vps-receiver" if direction == "download" else "http-remote-receiver", "maxBitsPerSecond": max((r["bitsPerSecond"] for r in intervals if r.get("completeSecond")), default=None), "tcpRttMs": statistics.mean(rtts) if rtts else metrics["tcpRttMs"], "retransmits": metrics["retransmits"] if direction == "upload" else receiver.get("retransmits"), "tcpRttMethod": "data socket TCP_INFO tcpi_rtt", "tcpSampleSide": "VPS data socket", "congestionControl": congestion_control, "congestionControlSampleSide": "VPS data socket; download sender configuration unavailable", "warmupBytesObserved": omitted, "trafficBytesObserved": size + omitted, "diagnostic": "文件提前结束或测量中断；有效时间少于计划时间" if early or cancelled() else ""})
        except (OSError, ValueError, http.client.HTTPException) as error:
            runs.append({"direction": "target-to-source" if direction == "download" else "source-to-target", "vpsDirection": direction, "streams": 1, "state": "failed", "intervals": [], "diagnostic": str(error)[:500]})
        finally:
            if connection:
                connection.close()
            if data_socket:
                data_socket.close()
    return {"kind": "speed", "method": "HTTP/1.1 single connection", "protocol": "TCP", "target": target, "resolvedIp": pinned, "port": port, "family": options.get("family"), "warmupSeconds": warmup, "rateLimited": False, "toolVersion": "Python " + sys.version.split()[0], "cpuLoad": {"before": load_before, "after": list(os.getloadavg()) if hasattr(os, "getloadavg") else []}, "runs": runs, "state": "ok" if all(r["state"] == "ok" for r in runs) else "partial" if any(r["state"] in {"ok", "partial"} for r in runs) else "failed"}


class Listener:
    """Authenticated, short-lived iperf listener; caller owns its lifetime."""
    def __init__(self, port, password, peer_scheme="oaep", lifetime=240):
        self._lock = threading.Lock()
        self._closed = False
        self.timer = None
        self.port = integer(port, 20000, 40000, "临时测速端口")
        if not isinstance(password, str) or not re.fullmatch(r"[0-9a-f]{64}", password):
            raise ValueError("测速会话凭证无效")
        scheme = auth_scheme()
        if scheme == "unavailable" or not shutil.which("openssl"):
            raise ValueError("测速端需要带认证支持的 iperf3 和 openssl")
        self.scheme = "pkcs1" if "pkcs1" in {scheme, peer_scheme} else "oaep"
        self.temp = tempfile.TemporaryDirectory(prefix="aster-listener-")
        folder = Path(self.temp.name)
        private, public, users = folder / "private.pem", folder / "public.pem", folder / "users.csv"
        code, _, error = execute(["openssl", "genrsa", "-out", str(private), "2048"], 15)
        if code:
            self.temp.cleanup()
            raise ValueError(error)
        code, _, error = execute(["openssl", "rsa", "-in", str(private), "-pubout", "-out", str(public)], 5)
        if code:
            self.temp.cleanup()
            raise ValueError(error)
        users.write_text("aster," + hashlib.sha256(("{aster}" + password).encode()).hexdigest() + "\n")
        for file in [private, public, users]:
            os.chmod(file, 0o600)
        self.public_key = public.read_text()
        self.log = open(folder / "server.log", "w+")
        command = ["iperf3", "-s", "-J", "-p", str(port), "--rsa-private-key-path", str(private), "--authorized-users-path", str(users)]
        if scheme == "oaep" and self.scheme == "pkcs1":
            command += ["--use-pkcs1-padding"]
        try:
            self.process = subprocess.Popen(command, stdout=self.log, stderr=subprocess.STDOUT)
        except OSError:
            self.log.close()
            self.temp.cleanup()
            raise
        self.expires = time.monotonic() + lifetime
        time.sleep(0.3)
        if self.process.poll() is not None:
            self.log.seek(0)
            error = self.log.read(1000)
            self.close()
            raise ValueError("测速监听未启动：" + error)

        self.timer = threading.Timer(lifetime, self.close)
        self.timer.daemon = True
        self.timer.start()

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
        if self.timer:
            self.timer.cancel()
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.log.close()
        self.temp.cleanup()


def measure(job):
    if not isinstance(job, dict) or job.get("operation") not in {"website", "route", "benchmark", "latency", "http-speed", "iperf-speed"}:
        raise ValueError("原生测量任务无效")
    options = job.get("options") or {}
    if not isinstance(options, dict):
        raise ValueError("测量参数无效")
    if options.get("reportVersion") == 3 and job["operation"] in {"benchmark", "iperf-speed", "route"}:
        address = resolve_ip(job["target"], options)
        ip = ipaddress.ip_address(address)
        if not ip.is_global or ip.is_multicast:
            raise ValueError("新版测量端点必须解析为公网地址；未对私网或代理保留地址测量")
        options = {**options, "pinnedIp": address}
    if job["operation"] == "website":
        return website(job["target"], options)
    if job["operation"] == "latency":
        return latency(job["target"], options)
    if job["operation"] == "route":
        return route(job["target"], options)
    if job["operation"] == "http-speed":
        return http_speed(job["target"], options, job.get("credentials"))
    if job["operation"] == "iperf-speed":
        options = {**options, "vpsRole": "client"}
    return benchmark(job["target"], options, job.get("credentials"))
