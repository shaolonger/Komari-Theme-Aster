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
from pathlib import Path

HOST = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", re.I)


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
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, env=env, check=False)
        return result.returncode, result.stdout, result.stderr[:4000]
    except subprocess.TimeoutExpired as error:
        return 124, (error.stdout or b"").decode("utf8", "replace") if isinstance(error.stdout, bytes) else (error.stdout or ""), "测量超时"


def family_args(options):
    value = options.get("family", "auto")
    if value not in {"auto", "4", "6"}:
        raise ValueError("地址族无效")
    return [] if value == "auto" else ["-" + value]


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
    return {
        "kind": "website", "target": target, "family": options.get("family", "auto"),
        "state": "ok" if responded and 200 <= status < 400 else "application" if responded else "failed",
        "errorStage": "" if responded else stage, "exitCode": code,
        "httpStatus": status, "resolvedIp": data.get("remoteIp", ""), "localIp": data.get("localIp", ""),
        "timingsMs": {"dns": 1000 * data.get("dns", 0), "connect": 1000 * max(0, data.get("connect", 0) - data.get("dns", 0)), "tls": 1000 * max(0, data.get("tls", 0) - data.get("connect", 0)), "ttfb": 1000 * data.get("ttfb", 0), "total": 1000 * data.get("total", 0)},
        "tlsVerified": data.get("tlsVerify") == 0 and data.get("tls", 0) > 0,
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
                hops.append({"ttl": value.get("TTL", index + 1), "address": address.get("IP", "") if isinstance(address, dict) else address, "asn": str(geo.get("asnumber", "")), "rttMs": value.get("RTT", 0) / 1e6 if value.get("Success") else None})
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


def benchmark(target, options, credentials=None):
    target = host(target)
    port = integer(options.get("port", 5201), 1, 65535, "端口")
    seconds = integer(options.get("seconds", 10), 5, 20, "测速时长")
    streams = options.get("streams", [1, 4])
    if not isinstance(streams, list) or not streams or len(streams) > 2 or any(isinstance(x, bool) or x not in {1, 4, 8} for x in streams):
        raise ValueError("测速连接数无效")
    env = os.environ.copy()
    runs = []
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
                command = ["iperf3", *family_args(options), "-c", target, "-p", str(port), "-t", str(seconds), "-P", str(count), "-J", "--connect-timeout", "5000"]
                if reverse:
                    command += ["-R"]
                if credentials:
                    command += ["--username", "aster", "--rsa-public-key-path", str(key)]
                    if credentials.get("scheme") == "pkcs1" and auth_scheme() == "oaep":
                        command += ["--use-pkcs1-padding"]
                code, output, error = execute(command, seconds + 10, env)
                try:
                    payload = json.loads(output)
                except ValueError:
                    payload = {"error": error or output[:500] or "iperf3 未返回数据"}
                received = payload.get("end", {}).get("sum_received", {})
                sent = payload.get("end", {}).get("sum_sent", {})
                valid = code == 0 and not payload.get("error") and isinstance(received.get("bits_per_second"), (int, float))
                connected = payload.get("start", {}).get("connected") or [{}]
                runs.append({"direction": "target-to-source" if reverse else "source-to-target", "streams": count, "state": "ok" if valid else "failed", "bitsPerSecond": received.get("bits_per_second") if valid else None, "bytes": received.get("bytes") if valid else None, "seconds": received.get("seconds") if valid else None, "retransmits": sent.get("retransmits") if valid else None, "remoteIp": connected[0].get("remote_host", ""), "intervals": [{"seconds": x.get("sum", {}).get("end", 0), "bitsPerSecond": x.get("sum", {}).get("bits_per_second", 0)} for x in payload.get("intervals", [])[:25]], "diagnostic": str(payload.get("error") or error)[:1000]})
    return {"kind": "speed", "target": target, "port": port, "family": options.get("family", "auto"), "protocol": "TCP", "rateLimited": False, "warmupSeconds": 0, "state": "ok" if all(x["state"] == "ok" for x in runs) else "partial" if any(x["state"] == "ok" for x in runs) else "failed", "runs": runs}


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
        command = ["iperf3", "-s", "-p", str(port), "--rsa-private-key-path", str(private), "--authorized-users-path", str(users)]
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
    if not isinstance(job, dict) or job.get("operation") not in {"website", "route", "benchmark"}:
        raise ValueError("原生测量任务无效")
    options = job.get("options") or {}
    if not isinstance(options, dict):
        raise ValueError("测量参数无效")
    if job["operation"] == "website":
        return website(job["target"], options)
    if job["operation"] == "route":
        return route(job["target"], options)
    return benchmark(job["target"], options, job.get("credentials"))
