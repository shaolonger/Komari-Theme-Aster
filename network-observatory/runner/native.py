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
_auth_scheme_cache = None
_auth_scheme_lock = threading.Lock()


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


def execute(command, timeout=30, env=None, cwd=None, input_text=None):
    process = subprocess.Popen(command, stdin=subprocess.PIPE if input_text is not None else None,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, cwd=cwd,
                               start_new_session=True)
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
            pending, input_text = input_text, None
            output, error = process.communicate(input=pending, timeout=min(0.25, max(0.01, deadline - time.monotonic())))
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
    # mtr refuses intervals below one second for non-root users even when
    # CAP_NET_RAW is available. Keep its real MTR observations after the
    # worker is deliberately dropped to the unprivileged service account.
    interval = 0.2 if os.geteuid() == 0 else 1.0
    command = ["mtr", *family_args(options), "--json", "--no-dns", "--report-cycles", str(cycles), "--interval", str(interval), "--max-ttl", "32"]
    if protocol == "tcp":
        command += ["--tcp", "--port", str(port)]
    code, output, error = execute([*command, address], max(45, int(cycles * interval) + 15))
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


def nexttrace_route(target, options):
    """Keep the independent observation, including metadata with no origin ASN."""
    started = datetime.now(timezone.utc).isoformat()
    beginning = time.monotonic()
    command = ["nexttrace", *family_args(options), "--json", "--no-rdns", "--map", "--max-hops", "32", "--queries", "1" if options.get("metadataOnly") else "3"]
    if options.get("protocol", "tcp") == "tcp":
        command += ["--tcp", "--port", str(options.get("port", 443))]
    destination = options.get("pinnedIp") or target
    code, output, error = execute([*command, destination], 25 if options.get("metadataOnly") else 85)
    queried = datetime.now(timezone.utc).isoformat()
    hops, parse_error, stop_reason = [], "", "unknown"
    try:
        # Some versions prepend progress messages. Accept only an actual trace
        # object, never a JSON error object or unrelated log entry.
        decoder = json.JSONDecoder()
        payload = None
        for match in re.finditer(r"\{", output):
            try:
                candidate, _ = decoder.raw_decode(output[match.start():])
            except ValueError:
                continue
            if isinstance(candidate, dict) and isinstance(candidate.get("Hops"), list):
                payload = candidate
                break
        if payload is None:
            raise ValueError("NextTrace 未返回包含 Hops 的有效 JSON")
        for index, probes in enumerate(payload["Hops"][:32]):
            probes = probes if isinstance(probes, list) else [probes]
            probes = [p for p in probes if isinstance(p, dict)]
            value = next((p for p in probes if p.get("Success")), probes[0] if probes else {})
            address = value.get("Address") or {}
            address = address.get("IP", "") if isinstance(address, dict) else address
            candidates = [p["Geo"] for p in probes if p.get("Address") == value.get("Address") and isinstance(p.get("Geo"), dict)]
            geo = dict(max(candidates, key=lambda g: sum(bool(g.get(k)) for k in ("asnumber", "country", "prov", "city", "owner", "isp", "domain", "whois")), default={}))
            # A TTL can contain ECMP peers. Reuse fields only for this same IP.
            for peer in probes:
                if peer.get("Address") == value.get("Address") and isinstance(peer.get("Geo"), dict):
                    for key, entry in peer["Geo"].items():
                        if not geo.get(key) and entry:
                            geo[key] = entry
            asn = re.sub(r"^AS", "", str(geo.get("asnumber") or "")).strip()
            source = "NextTrace / " + str(geo.get("source") or "GeoIP")[:80]
            location = " · ".join(dict.fromkeys(str(geo.get(k) or "") for k in ("country", "prov", "city", "district") if geo.get(k)))[:160]
            network = " · ".join(dict.fromkeys(str(geo.get(k) or "") for k in ("owner", "isp") if geo.get(k)))[:160]
            available = bool(asn or location or network or geo.get("domain") or geo.get("whois") or geo.get("prefix"))
            status = "available" if available else "lookup-failed" if geo.get("source") in {"timeout", "pending"} else "not-provided"
            hops.append({"ttl": value.get("TTL", index + 1), "address": str(address), "asn": asn,
                         "rttMs": value.get("RTT", 0) / 1e6 if value.get("Success") else None,
                         "network": network, "location": location, "domain": str(geo.get("domain") or "")[:160],
                         "whois": str(geo.get("whois") or "")[:120], "hostname": str(value.get("Hostname") or "")[:160],
                         "prefix": str(geo.get("prefix") or "")[:80], "geoSource": source,
                         "geoQueriedAt": queried, "geoStatus": status,
                         "asnSource": source if asn else "", "asnQueriedAt": queried if asn else "",
                         "asnStatus": "available" if asn else "lookup-failed" if status == "lookup-failed" else "not-provided"})
        stop_reason = (payload.get("StopReason") or {}).get("reason", "unknown")
    except (ValueError, TypeError, KeyError, AttributeError) as failure:
        parse_error = str(failure)[:500]
    return {"method": "nexttrace", "hops": hops, "exitCode": code, "rawOutput": output,
            "stderr": error, "parseError": parse_error, "stopReason": stop_reason,
            "complete": stop_reason == "destination_reached", "target": str(destination),
            "startedAt": started, "completedAt": queried, "durationMs": round((time.monotonic() - beginning) * 1000, 1)}


def route_metadata(result, target, options):
    observation = {"method": "nexttrace", "target": target, "resolvedIp": result.get("resolvedIp", ""),
                   "protocol": options.get("protocol", "tcp"), "port": options.get("port", 443),
                   "matchedIps": [], "hops": [], "conditions": "独立 NextTrace 观测仅按相同 IP 补充元数据；不合并路径、RTT 或未响应率"}
    result["metadataObservation"] = observation
    if not options.get("routeMetadata", True):
        observation.update(state="disabled", diagnostic="此任务未启用 NextTrace 元数据补充")
        return
    if cancelled():
        observation.update(state="cancelled", diagnostic="任务已取消，未继续补充元数据")
        return
    if not shutil.which("nexttrace"):
        observation.update(state="missing", diagnostic="未安装 NextTrace；MTR 统计独立保留")
        return
    try:
        metadata = nexttrace_route(target, {**options, "metadataOnly": True, "pinnedIp": result.get("resolvedIp") or target})
    except (OSError, ValueError) as failure:
        observation.update(state="failed", diagnostic="NextTrace 无法执行：" + str(failure)[:500], completedAt=datetime.now(timezone.utc).isoformat())
        return
    fields = ("asn", "asnSource", "asnQueriedAt", "asnStatus", "network", "location", "prefix", "domain", "whois", "hostname", "geoSource", "geoQueriedAt", "geoStatus")
    matching = {h["address"]: h for h in metadata["hops"] if h.get("address") and (h.get("geoStatus") == "available" or h.get("hostname"))}
    for hop in result["hops"]:
        peer = matching.get(hop["address"])
        if not peer:
            continue
        for key in fields:
            if peer.get(key) and not (key.startswith("asn") and not peer.get("asn")):
                hop[key] = peer[key]
        observation["matchedIps"].append(hop["address"])
    observation.update({k: metadata[k] for k in ("exitCode", "parseError", "stopReason", "complete", "startedAt", "completedAt", "durationMs")})
    observation["queriedAt"] = metadata["completedAt"]
    observation["state"] = "failed" if metadata["exitCode"] or metadata["parseError"] else "ok" if matching else "empty"
    observation["diagnostic"] = metadata["parseError"] or ("NextTrace 执行失败" if metadata["exitCode"] else "未取得可关联的元数据" if not observation["matchedIps"] else "")
    observation["hops"] = metadata["hops"]
    observation["stdout"] = metadata["rawOutput"][:6000]
    observation["stderr"] = metadata["stderr"][:2000]
    observation["stdoutTruncated"] = len(metadata["rawOutput"]) > 6000
    observation["stderrTruncated"] = len(metadata["stderr"]) > 2000
    # Remain compatible with the existing 48k result contract on older panels.
    # Drop raw excerpts before sacrificing structured per-hop evidence.
    def result_size():
        # JavaScript validates UTF-16 code units, including supplementary text.
        return len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-16-le")) // 2
    for owner, key in ((observation, "stdout"), (result, "rawOutput"), (observation, "stderr")):
        excess = result_size() - 46000
        if excess > 0 and owner.get(key):
            owner[key] = owner[key][:max(0, len(owner[key]) - excess - 1000)]
            owner[key + "Truncated"] = True
    for limit in (80, 32, 16):
        if result_size() <= 46000:
            break
        observation["metadataTruncated"] = True
        for hop in [*result["hops"], *observation["hops"]]:
            for key in ("network", "location", "domain", "whois", "hostname", "prefix"):
                if hop.get(key):
                    hop[key] = hop[key][:limit]


def route(target, options):
    target = host(target)
    if options.get("fullMtr") and shutil.which("mtr"):
        result = mtr_route(target, options)
        if result["hops"]:
            route_metadata(result, target, options)
            return result
    protocol = options.get("protocol", "tcp")
    if protocol not in {"tcp", "icmp"}:
        raise ValueError("路径协议无效")
    port = integer(options.get("port", 443), 1, 65535, "端口")
    hops, output, diagnostic, code = [], "", "", 127
    stop_reason, method = "unknown", "nexttrace"
    if shutil.which("nexttrace"):
        trace = nexttrace_route(target, options)
        code, output, diagnostic = trace["exitCode"], trace["rawOutput"], trace["stderr"]
        hops, stop_reason = trace["hops"], trace["stopReason"]
        if trace["parseError"]:
            diagnostic = (diagnostic + "\n" + trace["parseError"]).strip()
    if (code != 0 or not hops) and not options.get("metadataOnly"):
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
        interval = 0.2 if os.geteuid() == 0 else 1.0
        command = ["mtr", *family_args(options), "--json", "--no-dns", "--report-cycles", "20", "--interval", str(interval)]
        if protocol == "tcp":
            command += ["--tcp", "--port", str(port)]
        mtr_code, mtr_output, mtr_error = execute([*command, target], max(25, int(20 * interval) + 15))
        try:
            hubs = json.loads(mtr_output).get("report", {}).get("hubs", [])
            if hubs:
                last = hubs[-1]
                quality = {"address": last.get("host", ""), "sent": last.get("Snt", 0), "lossPercent": last.get("Loss%", 0), "avgMs": last.get("Avg", 0), "jitterMs": last.get("StDev", 0), "terminalConfirmed": bool(hops and last.get("host") == hops[-1]["address"] and stop_reason == "destination_reached")}
        except (ValueError, TypeError):
            diagnostic += "\nMTR: " + mtr_error
    return {"kind": "route", "target": target, "family": options.get("family", "auto"), "protocol": protocol, "port": port, "state": "ok" if code == 0 and hops else "failed", "exitCode": code, "method": method, "hops": hops, "stopReason": stop_reason, "complete": stop_reason == "destination_reached", "quality": quality, "diagnostic": (diagnostic + "\n" + output)[:8000]}


def auth_scheme():
    executable = shutil.which("iperf3")
    if not executable:
        return "unavailable"
    try:
        metadata = os.stat(executable)
    except OSError:
        return "unavailable"
    # Heartbeats run every 30s. Probe once per binary identity; package upgrades
    # and path changes invalidate the result without a permanent stale cache.
    identity = (executable, metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns)
    global _auth_scheme_cache
    with _auth_scheme_lock:
        if _auth_scheme_cache is not None and _auth_scheme_cache[0] == identity:
            return _auth_scheme_cache[1]
        code, output, error = execute([executable, "--help"], 5)
        if code in {124, 130}:
            return "unavailable"  # Do not cache an interrupted / timed-out probe.
        scheme = "unavailable" if "--rsa-private-key-path" not in output + error else "oaep" if "--use-pkcs1-padding" in output + error else "pkcs1"
        _auth_scheme_cache = (identity, scheme)
        return scheme


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
        raw = connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 232)
        if len(raw) < 104 or not sys.platform.startswith("linux"):
            return {"tcpRttMs": None, "retransmits": None}
        return {"tcpRttMs": struct.unpack_from("=I", raw, 68)[0] / 1000,
                "retransmits": struct.unpack_from("=I", raw, 100)[0],
                "bytesAcked": struct.unpack_from("=Q", raw, 120)[0] if len(raw) >= 128 else None}
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
                framed_block = b"10000\r\n" + block + b"\r\n"
                last_tcp_sample = started
                while time.monotonic() < deadline and not cancelled():
                    connection.send(framed_block)
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


# Pinned homepage checks return only fixed, public-safe fields.
IP_SCRIPT = ("https://raw.githubusercontent.com/xykt/IPQuality/8643bcd0a0b7b42ed53030f794d63ce72067ca77/ip.sh",
             "e2ac9648bc0ba67770599fdf769bfd5df5cc323ce8de382e72496c42caa8b9a8")
MEDIA_SCRIPT = ("https://raw.githubusercontent.com/1-stream/RegionRestrictionCheck/ef841d0a2910a44a6ca565e3a03de0f2282d83b3/check.sh",
                "6d5360396c736995008c912191b55a38e90835a31e161ef005d3566736593b17")
HOME_DIAGNOSTIC_OPERATIONS = ("ip-quality", "media-unlock")
PROVIDERS = ("IPinfo", "ipregistry", "ipapi", "IP2Location", "AbuseIPDB")
RISK_PROVIDERS = {"IP2Location": "IP2LOCATION", "Scamalytics": "SCAMALYTICS", "ipapi": "ipapi", "AbuseIPDB": "AbuseIPDB"}
SERVICES = {"TikTok": "TikTok", "Disney+": "DisneyPlus", "Netflix": "Netflix",
            "YouTube Premium": "Youtube", "Amazon Prime Video": "AmazonPrimeVideo",
            "Reddit": "Reddit", "ChatGPT": "ChatGPT"}
IP_TYPES = {"isp": "isp", "line isp": "line-isp", "residential": "isp", "business": "business",
            "hosting": "hosting", "data center": "hosting", "datacenter": "hosting",
            "education": "education", "government": "government", "banking": "banking",
            "organization": "organization", "military": "military", "library": "library",
            "cdn": "cdn", "mobile isp": "mobile-isp", "web spider": "web-spider",
            "reserved": "reserved", "other": "other"}
ANSI = re.compile(r"(?:\x1b|\\033|\\?x1[bB])\[[0-?]*[ -/]*[@-~]")
MAX_SCRIPT = 524288
SCORE = re.compile(r"[0-9]{1,3}(?:\.[0-9]{1,4})?%?")


def missing_diagnostic_tools():
    return [tool for tool in ("bash", "curl", "jq", "python3", "bc", "dig") if not shutil.which(tool)]


def home_diagnostics_supported():
    return not missing_diagnostic_tools()


def object_or_empty(value):
    return value if isinstance(value, dict) else {}


def diagnostic_text(value):
    return ANSI.sub("", str(value)).strip()


def read_score(value):
    value = diagnostic_text(value)
    return value if SCORE.fullmatch(value) and float(value.rstrip("%")) <= 100 else None


def ip_rows(report):
    kinds = object_or_empty(report.get("Type"))
    usage = object_or_empty(kinds.get("Usage"))
    company = object_or_empty(kinds.get("Company"))
    score = object_or_empty(report.get("Score"))
    providers = {}
    for key in PROVIDERS:
        upstream = "IP2LOCATION" if key == "IP2Location" else key
        risk = read_score(score.get(upstream))
        row = {}
        for field, source in (("usage", usage), ("company", company)):
            kind = IP_TYPES.get(diagnostic_text(source.get(upstream, "")).lower())
            # IPQuality's fallback "Other" can also mean the AbuseIPDB
            # response did not contain a record or a usage type.
            if kind and not (key == "AbuseIPDB" and kind == "other" and risk is None):
                row[field] = kind
        if risk is not None:
            row["score"] = risk
        if row:
            providers[key] = row
    return providers


def risk_scores(report):
    values = object_or_empty(report.get("Score"))
    scores = {}
    for name, key in RISK_PROVIDERS.items():
        value = read_score(values.get(key))
        if value is not None:
            scores[name] = value
    return scores


def media_status(message, service, region_check=False):
    value = diagnostic_text(message).lower()
    if re.match(r"^(?:failed\b|error\b|timeout\b|失败)", value):
        return "failed"
    if re.search(r"\bunknown\b", value) or (region_check and service == "ChatGPT" and value == "no"):
        return "unknown"
    if re.match(r"^(?:yes\b|unlocked\b|解锁)", value):
        return "unlocked"
    if re.match(r"^(?:no\b|block(?:ed)?\b|china\b|noprem\b|屏蔽|中国|禁会员)", value):
        return "blocked"
    if re.match(r"^(?:web\s*only|app\s*only|nf\.only|originals only|available for|provided by|pending|idc\b|仅|待支持|机房)", value):
        return "partial"
    if re.match(r"^(?:ipv[46] not support|unsupported)", value):
        return "unsupported"
    return None


def media_observation(status, region="", mode=""):
    row = {"status": status}
    if status in ("failed", "unknown"):
        return row
    region = diagnostic_text(region).strip(" []").upper()
    if re.fullmatch(r"[A-Z]{2}", region):
        row["region"] = region
    mode = {"native": "native", "dns": "dns", "viadns": "dns", "原生": "native"}.get(diagnostic_text(mode).lower())
    if mode and status in ("unlocked", "partial"):
        row["mode"] = mode
    return row


def media_rows(output, primary):
    region_results = {}
    names = {label.lower(): key for label, key in SERVICES.items()}
    for line in ANSI.sub("", output).splitlines():
        label, _, text = line.strip().partition(":")
        key = names.get(label.lower())
        state = media_status(text, key, region_check=True)
        if not key or not state:
            continue
        region = re.search(r"\bRegion:\s*([A-Z]{2})\b", text, re.I)
        region_results[key] = media_observation(state, region[1] if region else "")
    result, evidence = {}, {}
    for key in SERVICES.values():
        upstream = object_or_empty(primary.get(key))
        state = media_status(upstream.get("Status", ""), key)
        sources = {}
        if state:
            sources["ipQuality"] = media_observation(state, upstream.get("Region"), upstream.get("Type"))
        if key in region_results:
            sources["regionRestriction"] = region_results[key]
        if sources:
            evidence[key] = sources
        for row in sources.values():
            if row["status"] not in ("failed", "unknown"):
                result[key] = row
                break
    return result, evidence


def download(spec, destination, env):
    url, digest = spec
    status, _, _ = execute(["curl", "-q", "-fsS", "--proto", "=https", "--max-time", "15",
                            "--max-filesize", str(MAX_SCRIPT), "-o", str(destination), url], timeout=17, env=env)
    if status or not destination.is_file() or destination.stat().st_size > MAX_SCRIPT:
        return False
    return hashlib.sha256(destination.read_bytes()).hexdigest() == digest


def select_media_checks(script, family):
    # Keep the pinned initialization and functions, and run only the two groups
    # that supply the homepage. The default menu also runs regional suites.
    source, marker, trailing = script.read_bytes().rpartition(b"\nRunScript")
    if not marker or trailing.strip():
        return False
    entry = f"\nCheckV{family}\nif [[ \"$isv{family}\" == 1 ]]; then\n    Global_UnlockTest {family}\n    AI_UnlockTest {family}\nfi\n"
    script.write_bytes(source + entry.encode("ascii"))
    return True


def select_ip_checks(script, kind):
    # Adjust known entry points only after verifying the pinned script digest.
    source = script.read_text()
    providers = source.find("countRunTimes\ndb_maxmind $2")
    media = source.find("\nMediaUnlockTest_TikTok $2\n", providers)
    trailing_checks = '\ncheck_mail\n[[ $2 -eq 4 ]]&&check_dnsbl "$IP" 50\n'
    end = source.find(trailing_checks, media)
    render = source.find('if [[ $mode_lite -eq 0 ]];then\nlocal ip_report=$(show_head\n', end)
    after_render = source.find('local report_link=""', render)
    if min(providers, media, end, render, after_render) < 0:
        return False
    tail = source[end + len(trailing_checks):render] + 'local ip_report=""\n' + source[after_render:]
    if kind == "media-unlock":
        # The upstream TikTok fallback and OpenAI locale request omit -4/-6.
        # Preserve address discovery and DNS comparisons; pin media HTTP calls.
        enforce_family = 'aster_media_family=$2\ncurl() { command curl -q "-$aster_media_family" "$@"; }\n'
        source = source[:providers] + enforce_family + source[media:end] + "\n" + tail
    else:
        source = source[:media] + "\n" + tail
        source = source.replace("countRunTimes\ndb_maxmind $2", "db_maxmind $2")
        retry = """
aster_provider_json(){
    local family=$1 url=$2 filter=$3 retain_partial=${4:-yes} first body timeout
    for timeout in 10 5; do
        body=$(command curl -q -fsSL "-$family" --max-time "$timeout" "$url" 2>/dev/null) || continue
        if jq -e "$filter" >/dev/null 2>&1 <<<"$body"; then printf '%s' "$body"; return; fi
        if [[ $retain_partial == yes && -z $first ]] && jq -e 'type == "object"' >/dev/null 2>&1 <<<"$body"; then first=$body; fi
    done
    printf '%s' "$first"
}
"""
        clear_missing_types = []
        for provider in ("ipinfo", "ipregistry", "ipapi", "ip2location", "abuseipdb"):
            fields = ("usetype",) if provider == "abuseipdb" else ("usetype", "comtype")
            for field in fields:
                raw = "${" + provider + "[" + field + "]}"
                clear_missing_types.append(f"if [[ -z {raw} || {raw} == null ]]; then unset '{provider}[s{field}]'; fi")
        replacements = {
            "db_maxmind(){": retry + "\ndb_maxmind(){",
            'curl $CurlARG -Ls -$1 -m 10 "https://ipinfo.check.place/$IP?lang=$YY"':
                """aster_provider_json "$1" "https://ipinfo.check.place/$IP?lang=$YY" '(.ASN // .Country) | type == "object"' no""",
            'curl $CurlARG -sL -$1 -m 10 "https://ipinfo.check.place/$IP?db=scamalytics"':
                """aster_provider_json "$1" "https://ipinfo.check.place/$IP?db=scamalytics" '.scamalytics.scamalytics_score | tonumber?'""",
            'curl $CurlARG -sL -$1 -m 10 "https://ipinfo.check.place/$IP?db=abuseipdb"':
                """aster_provider_json "$1" "https://ipinfo.check.place/$IP?db=abuseipdb" '.data.abuseConfidenceScore | tonumber?'""",
            # DB-IP's /self score describes the connection's address rather
            # than accepting the measured address in the query.
            'local tmpcurlarg="$CurlARG"\nif [[ $IP == *:* ]];then\ntmpcurlarg=""\nfi': 'local tmpcurlarg="-$1 $CurlARG"',
            '\ndb_dbip\n': '\ndb_dbip $2\n',
            '[[ -n ${ipapi[scorenum]} ]]&&ipapi[score]=':
                r'[[ ${ipapi[scorenum]} =~ ^[0-9]+([.][0-9]+)?$ || ${ipapi[scorenum]} =~ ^[.][0-9]+$ ]]&&ipapi[score]=',
            'local head_updates=""': "\n".join(clear_missing_types) + '\nlocal head_updates=""',
        }
        for original, replacement in replacements.items():
            if source.count(original) != 1:
                return False
            source = source.replace(original, replacement)
        source = source.replace("\ncheck_connectivity\nread_ref\n", "\n")
    startup = '\nshow_ad\n[[ $IPV4work'
    discovery = "\nget_ipv4\nget_ipv6\nis_valid_ipv4 $IPV4\nis_valid_ipv6 $IPV6\nget_opts"
    if source.count(startup) != 1 or source.count(discovery) != 1:
        return False
    source = source.replace(startup, '\n[[ $IPV4work')
    source = source.replace(discovery, '\n[[ $1 != -6 ]] && get_ipv4\n[[ $1 != -4 ]] && get_ipv6\nis_valid_ipv4 $IPV4\nis_valid_ipv6 $IPV6\nget_opts')
    clean = source.find("clean_ansi(){\n")
    after_clean = source.find("\nfactor_bool(){", clean)
    save = 'ipjson=$(echo "$ipjson"|jq "$head_updates$basic_updates$type_updates$score_updates$factor_updates$media_updates$mail_updates.")'
    if clean < 0 or after_clean < 0 or source.count(save) != 1:
        return False
    # GNU and BusyBox sed interpret a replacement containing \x1b differently.
    # Feed sed a literal escape byte and omit unrelated metadata from the JSON.
    source = source[:clean] + r"""clean_ansi(){
local value=${1//\\033/$'\033'}
printf '%s' "$value" | sed -e $'s|\033\\[[0-9;]*m||g' -e 's/^[[:space:]]*//; s/[[:space:]]*$//'
}""" + source[after_clean:]
    source = source.replace(save, r"""local aster_mode=full
[[ $mode_lite == 1 ]] && aster_mode=lite
ipjson=$(printf '%s' "$ipjson" | jq --arg mode "$aster_mode" "$type_updates$score_updates$media_updates.Head.Mode = \$mode")""")
    script.write_text(source)
    return True


def run_ip_checks(root, kind, family, env):
    script, target = root / "ip.sh", root / "result.json"
    if not download(IP_SCRIPT, script, env):
        return {}, "IPQuality 脚本下载或校验失败"
    if not select_ip_checks(script, kind):
        return {}, "IPQuality 脚本入口不兼容"
    code, _, _ = execute(["bash", str(script), "-" + family, "-n", "-p", "-E", "-o", str(target)],
                         timeout=150, env=env, cwd=str(root), input_text="")
    # The IPv4-only run can exit on a false IPv6 condition after writing JSON.
    if code in (0, 1, 124) and target.is_file() and target.stat().st_size <= MAX_SCRIPT:
        try:
            report = object_or_empty(json.loads(target.read_text()))
            if report:
                return report, ""
        except (ValueError, OSError):
            pass
    return {}, "IPQuality 执行超时" if code == 124 else "IPQuality 未返回有效的 JSON"


def ip_result(report, diagnostic):
    values, scores = ip_rows(report), risk_scores(report)
    mode = object_or_empty(report.get("Head")).get("Mode")
    db_ip = read_score(object_or_empty(report.get("Score")).get("DBIP"))
    if db_ip not in ("0", "50", "100"):
        db_ip = None
    if not values and not scores and db_ip is None:
        return {"kind": "ip-quality", "state": "failed", "diagnostic": diagnostic or "该地址族未返回可识别的 IP 质量数据"}
    missing_providers = [name for name in PROVIDERS if not values.get(name, {}).get("usage")
                         or (name != "AbuseIPDB" and not values.get(name, {}).get("company"))]
    missing_scores = [name for name in RISK_PROVIDERS if name not in scores]
    issues = [diagnostic] if diagnostic else []
    if mode == "lite":
        issues.append("IPQuality 对该地址族使用 Lite 模式，跳过 IP2Location、Scamalytics 和 AbuseIPDB")
    if missing_providers:
        issues.append("缺少部分 IP 类型：" + "、".join(missing_providers))
    if missing_scores:
        issues.append("未取得评分：" + "、".join(missing_scores))
    return {"kind": "ip-quality", "state": "partial" if issues else "ok", "providers": values,
            "diagnostic": "。".join(issues), **({"riskScores": scores} if scores else {}),
            **({"ipMode": mode} if mode in ("full", "lite") else {}),
            **({"dbIpScore": db_ip} if db_ip is not None else {})}


def media_result(report, output, issues):
    rows, evidence = media_rows(output, object_or_empty(report.get("Media")))
    conflicts = []
    for name, sources in evidence.items():
        main, secondary = sources.get("ipQuality"), sources.get("regionRestriction")
        if main and secondary and all(row["status"] not in ("unknown", "failed") for row in (main, secondary)):
            if main["status"] != secondary["status"] or (main.get("region") and secondary.get("region") and main["region"] != secondary["region"]):
                conflicts.append(name)
    missing = [name for name in SERVICES.values() if name not in rows]
    missing_metadata = [name for name, row in rows.items() if row["status"] == "unlocked" and (not row.get("region") or not row.get("mode"))]
    if missing:
        issues.append("未能确认：" + "、".join(missing))
    if missing_metadata:
        issues.append("缺少地区或方式：" + "、".join(missing_metadata))
    if conflicts:
        issues.append("两套脚本判定不同，采用 IPQuality：" + "、".join(conflicts))
    return {"kind": "media-unlock", "state": "failed" if not rows else "partial" if issues else "ok",
            "diagnostic": "。".join(issues), **({"services": rows} if rows else {}),
            **({"mediaEvidence": evidence} if evidence else {})}


def home_diagnostics(kind, family):
    if kind not in HOME_DIAGNOSTIC_OPERATIONS or family not in ("4", "6"):
        raise ValueError("主页检测类型或地址族无效")
    failed = {"kind": kind, "state": "failed"}
    if not home_diagnostics_supported():
        return {**failed, "diagnostic": "测量端缺少 bash、curl、jq、Python 3、bc 或 dig"}
    try:
        with tempfile.TemporaryDirectory(prefix="aster-home-") as directory:
            root = Path(directory)
            env = {"PATH": "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", "HOME": directory, "TMPDIR": directory,
                   "LC_ALL": "C", "TERM": "dumb"}
            report, diagnostic = run_ip_checks(root, kind, family, env)
            if kind == "ip-quality":
                return ip_result(report, diagnostic)
            issues = [diagnostic] if diagnostic else []
            output = ""
            if not cancelled():
                script = root / "region.sh"
                if not download(MEDIA_SCRIPT, script, env):
                    issues.append("RegionRestrictionCheck 下载或校验失败")
                elif not select_media_checks(script, family):
                    issues.append("RegionRestrictionCheck 入口不兼容")
                else:
                    code, output, _ = execute(["bash", str(script), "-E", "-M", family, "-S", "force6"], timeout=95, env=env,
                                              cwd=directory, input_text="")
                    if code:
                        issues.append("RegionRestrictionCheck 执行超时" if code == 124 else "RegionRestrictionCheck 未正常结束")
            return media_result(report, output, issues)
    except (OSError, ValueError):
        return {**failed, "diagnostic": "主页检测执行失败"}


def measure(job):
    if not isinstance(job, dict) or job.get("operation") not in {"route", "benchmark", "latency", "http-speed", "iperf-speed", "public-speed", "tcp-quality", *HOME_DIAGNOSTIC_OPERATIONS}:
        raise ValueError("原生测量任务无效")
    options = job.get("options") or {}
    if not isinstance(options, dict):
        raise ValueError("测量参数无效")
    if job["operation"] in HOME_DIAGNOSTIC_OPERATIONS:
        return home_diagnostics(job["operation"], options.get("family"))
    if options.get("reportVersion") == 3 and job["operation"] in {"benchmark", "iperf-speed", "route"}:
        address = resolve_ip(job["target"], options)
        ip = ipaddress.ip_address(address)
        if not ip.is_global or ip.is_multicast:
            raise ValueError("新版测量端点必须解析为公网地址；未对私网或代理保留地址测量")
        options = {**options, "pinnedIp": address}
    if job["operation"] == "public-speed":
        import public_speed
        return public_speed.measure(options, sys.modules[__name__])
    if job["operation"] == "tcp-quality":
        import tcp_quality
        return tcp_quality.measure(job["target"], options, sys.modules[__name__])
    if job["operation"] == "latency":
        return latency(job["target"], options)
    if job["operation"] == "route":
        return route(job["target"], options)
    if job["operation"] == "http-speed":
        return http_speed(job["target"], options, job.get("credentials"))
    if job["operation"] == "iperf-speed":
        options = {**options, "vpsRole": "client"}
    return benchmark(job["target"], options, job.get("credentials"))
