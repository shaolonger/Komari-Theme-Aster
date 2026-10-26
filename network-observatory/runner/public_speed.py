"""Aster's bounded public speed provider. No upstream script/binary is invoked.

Wire interoperability reference: taierspeedtest ed67e6e (protocol documentation
in docs/network-native-measurements.md). Measurement and result design is Aster's.
"""
import hashlib
import copy
import errno
import functools
import http.client
import ipaddress
import json
import os
import select
import socket
import ssl
import statistics
import threading
import time
import urllib.parse
import uuid
from collections import OrderedDict

DIRECTORY = "https://dlcv2.cnspeedtest.cn:8443"
VERSION = "aster-public-speed/2"
CONNECT_TIMEOUT = 8
TLS_TIMEOUT = 12
HEADER_TIMEOUT = 12
READ_TIMEOUT = 5
REQUEST_TIMEOUT = 25
MEASUREMENT_TIMEOUT = 240
CACHE_TTL = 120
_directory_cache = OrderedDict()
_cache_lock = threading.Lock()
TRANSFER_BLOCK_SIZE = 128 * 1024
DOWNLOAD_AGENT = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.60 Safari/537.36"
UPLOAD_AGENT = "Dalvik/1.6.0 (Linux; U; Android 4.2.2; Aster)"
CITIES = {"北京": "北京", "上海": "上海", "广州": "广东"}
CARRIERS = ("电信", "联通", "移动")
STAGE_LABELS = {"directory-location": "公共目录出口查询", "directory-match": "公共目录节点匹配",
                "session": "测速会话申请", "session-cleanup": "测速会话释放", "request": "网络请求",
                "connect": "TCP 连接", "tls-handshake": "TLS 握手", "request-write": "HTTP 请求发送",
                "response-headers": "HTTP 响应头", "response-body": "HTTP 响应读取", "cancelled": "取消或总时限"}


class ControlFailure(OSError):
    def __init__(self, message, stage, retryable=False, status=None):
        super().__init__(message)
        self.stage, self.retryable, self.status = stage, retryable, status


def transient(error):
    if isinstance(error, ControlFailure):
        return error.retryable
    if isinstance(error, ssl.SSLCertVerificationError):
        return False
    if isinstance(error, ValueError):
        return "繁忙" in str(error)
    reason = getattr(error, "reason", error)
    return isinstance(reason, (TimeoutError, ConnectionError, ssl.SSLEOFError, ssl.SSLZeroReturnError,
                               http.client.RemoteDisconnected, http.client.IncompleteRead)) or getattr(reason, "errno", None) in {
        errno.ETIMEDOUT, errno.ECONNRESET, errno.ECONNREFUSED, errno.ENETUNREACH, errno.EHOSTUNREACH,
        errno.EAGAIN,
        getattr(socket, "EAI_AGAIN", -3),
    } or "timed out" in str(reason).lower() or "繁忙" in str(reason)


@functools.lru_cache(maxsize=1)
def tls_context():
    # Load the CA store once per worker, without sharing sockets or sessions.
    return ssl.create_default_context()


def request(url, method="GET", *, deadline=None, observation=None, runtime=None):
    """Direct, verified TLS; separate phase timeouts, no redirects or proxies.

    Diagnostics contain only the authority, never the session-bearing URL.
    DNS uses the system resolver; the budget is checked between blocking calls.
    """
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("公共服务地址无效")
    host, port = parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host:
        raise ValueError("公共服务地址缺少主机")
    if host != urllib.parse.urlsplit(DIRECTORY).hostname:
        address = ipaddress.ip_address(host)
        if not address.is_global or address.is_multicast or getattr(address, "ipv4_mapped", None):
            raise ValueError("公共服务节点必须是公网地址")
    end = min(deadline or float("inf"), time.monotonic() + REQUEST_TIMEOUT)
    stage, connection, response = "connect", None, None
    observed = observation if observation is not None else {}

    def timeout(limit):
        if runtime and runtime.cancelled():
            raise ControlFailure("测量已取消", "cancelled")
        remaining = end - time.monotonic()
        if remaining <= 0:
            raise ControlFailure("公共服务请求达到总时限", stage, True)
        return max(.01, min(limit, remaining))

    try:
        connection = http.client.HTTPConnection(host, port, timeout=timeout(CONNECT_TIMEOUT))
        connection.connect()
        observed["addressFamily"] = "6" if connection.sock.family == socket.AF_INET6 else "4"
        if parsed.scheme == "https":
            stage = "tls-handshake"
            connection.sock.settimeout(timeout(TLS_TIMEOUT))
            connection.sock = tls_context().wrap_socket(connection.sock, server_hostname=host)
        transport = connection.sock
        stage = "request-write"
        connection.sock.settimeout(timeout(HEADER_TIMEOUT))
        headers = {"User-Agent": "Aster-Network-Observatory/1.12", "Connection": "close"}
        if method == "POST":
            headers.update({"Content-Type": "application/x-www-form-urlencoded", "Charset": "utf-8"})
        connection.request(method, urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, "")),
                           body=b"" if method == "POST" else None, headers=headers)
        stage = "response-headers"
        connection.sock.settimeout(timeout(HEADER_TIMEOUT))
        response = connection.getresponse()
        observed["httpStatus"] = response.status
        if not 200 <= response.status < 300:
            raise ControlFailure(f"公共服务 HTTP {response.status}", stage, response.status in {408, 429, 500, 502, 503, 504}, response.status)
        stage = "response-body"
        chunks, size = [], 0
        while not response.isclosed():
            transport.settimeout(timeout(READ_TIMEOUT))
            chunk = response.read1(min(65536, 1048577 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > 1048576:
                raise ValueError("公共服务响应过大")
            chunks.append(chunk)
        if response.length not in (None, 0):
            raise ControlFailure("公共服务响应提前结束", "response-body", True)
        return b"".join(chunks).decode("utf-8")
    except ControlFailure:
        raise
    except (OSError, http.client.HTTPException) as error:
        # Error strings from a URL opener can contain the ephemeral session.
        message = "TLS 证书校验失败" if isinstance(error, ssl.SSLCertVerificationError) else "请求超时" if isinstance(getattr(error, "reason", error), TimeoutError) else type(error).__name__
        raise ControlFailure(message, stage, transient(error)) from error
    except ValueError as error:
        raise ControlFailure("公共服务响应无效或过大", stage) from error
    finally:
        if response:
            response.close()
        if connection:
            connection.close()


def pause(seconds, native, deadline):
    end = min(deadline, time.monotonic() + seconds)
    while time.monotonic() < end:
        if native.cancelled():
            raise ControlFailure("测量已取消", "cancelled")
        time.sleep(max(0, min(.1, end - time.monotonic())))


class ControlClient:
    def __init__(self, fetch, native, deadline):
        self.fetch, self.native, self.deadline, self.events = fetch, native, deadline, []
        self.cache_hits = 0

    def call(self, url, method="GET", step="session", retry=False):
        for attempt in range(1, 3 if retry else 2):
            if self.native.cancelled() or time.monotonic() >= self.deadline:
                raise ControlFailure("测量已取消或达到总时限", "cancelled")
            started, observed = time.monotonic(), {}
            event = {"stage": step, "attempt": attempt, "authority": urllib.parse.urlsplit(url).netloc}
            try:
                value = request(url, method, deadline=self.deadline, observation=observed, runtime=self.native) if self.fetch is request else self.fetch(url, method) if method != "GET" else self.fetch(url)
                event.update(state="ok", **observed)
                return value
            except (OSError, ValueError, http.client.HTTPException) as error:
                failure = error if isinstance(error, ControlFailure) else ControlFailure("请求超时" if transient(error) else type(error).__name__, "request", transient(error))
                event.update(state="failed", phase=failure.stage, retryable=failure.retryable, **observed)
                if not retry or attempt >= 2 or not failure.retryable:
                    raise ControlFailure(f"{STAGE_LABELS.get(step, step)} / {STAGE_LABELS.get(failure.stage, failure.stage)}：{failure}", step + "." + failure.stage, failure.retryable, failure.status) from error
                event["durationMs"] = round((time.monotonic() - started) * 1000)
                event["backoffMs"] = (1 + attempt) * 1000
                pause(1 + attempt, self.native, self.deadline)
            finally:
                event.setdefault("durationMs", round((time.monotonic() - started) * 1000))
                self.events.append(event)


def cache_get(key):
    with _cache_lock:
        item = _directory_cache.get(key)
        if item and item[0] > time.monotonic():
            _directory_cache.move_to_end(key)
            return copy.deepcopy(item[1])
        _directory_cache.pop(key, None)
    return None


def cache_put(key, value):
    with _cache_lock:
        _directory_cache[key] = (time.monotonic() + CACHE_TTL, copy.deepcopy(value))
        _directory_cache.move_to_end(key)
        while len(_directory_cache) > 32:
            _directory_cache.popitem(last=False)


def normalize_name(value):
    return str(value or "").strip().replace("中国", "").replace("有限公司", "")


def select_server(rows, city, carrier, family):
    """Never substitute a different city/operator or trust requested labels."""
    matches = []
    for row in rows[:200] if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        try:
            address = ipaddress.ip_address(str(row.get("hostip", "")))
            port = int(row.get("port", 0))
        except (ValueError, TypeError):
            continue
        if not address.is_global or address.is_multicast or getattr(address, "ipv4_mapped", None) is not None or str(address.version) != family or not 1 <= port <= 65535:
            continue
        actual_city = normalize_name(row.get("city"))
        name = normalize_name(row.get("hostname"))
        # A province-only match is insufficient for a city-labelled result.
        city_name = actual_city[:-1] if actual_city.endswith("市") else actual_city
        city_ok = city_name == city or (not actual_city and city in name)
        operator = normalize_name(row.get("oper") or row.get("operator") or "")
        operator_evidence = operator or name
        if not city_ok or carrier not in operator_evidence:
            continue
        if any(other in operator_evidence for other in CARRIERS if other != carrier):
            continue
        matches.append({"id": str(row.get("hostid", ""))[:80], "name": str(row.get("hostname", ""))[:160],
                        "ip": str(address), "port": port, "city": actual_city or city,
                        "province": str(row.get("pname", ""))[:40], "carrier": carrier,
                        "carrierEvidence": operator_evidence[:160], "family": family})
    return matches


def discover(city, carrier, family, fetch=request, context=None):
    def get(url, stage):
        return context.call(url, step=stage, retry=True) if context else fetch(url)

    source_key = (fetch, DIRECTORY, "source")
    location = cache_get(source_key)
    fresh_source = location is None
    if location is None:
        location = get(DIRECTORY + "/dataServer/getIpLocSP.php", "directory-location").strip().split("|", 1)[0]
    elif context:
        context.cache_hits += 1
    try:
        source = ipaddress.ip_address(location)
    except ValueError as error:
        raise ControlFailure("公共目录出口地址格式无效", "directory-location.response-format") from error
    if not source.is_global or source.is_multicast:
        raise ValueError("公共目录未返回有效公网出口")
    if fresh_source:
        cache_put(source_key, str(source))
    matches_key = (fetch, DIRECTORY, str(source), city, carrier, family)
    matches = cache_get(matches_key)
    if matches is not None:
        if context:
            context.cache_hits += 1
        return matches
    query = urllib.parse.urlencode({"ip": str(source), "network": "4", "province": CITIES[city],
                                   "city": city, "wifioper": carrier, "mobileoperid": "",
                                   "ipv6": "1" if family == "6" else "0", "model": "Android",
                                   "pkg": "com.cnspeedtest.globalspeed"})
    try:
        rows = json.loads(get(DIRECTORY + "/dataServer/mobilematch_many.php?" + query, "directory-match"))
    except json.JSONDecodeError as error:
        raise ControlFailure("公共目录节点清单 JSON 无效", "directory-match.response-format") from error
    if not isinstance(rows, list):
        raise ValueError("公共目录节点清单格式无效")
    matches, seen = [], set()
    for server in select_server(rows, city, carrier, family):
        key = (server["ip"], server["port"])
        if key not in seen:
            seen.add(key)
            matches.append(server)
        if len(matches) >= 8:
            break
    if matches:
        cache_put(matches_key, matches)
    return matches


def authority(server):
    ip = server["ip"]
    return ("[" + ip + "]" if ":" in ip else ip) + ":" + str(server["port"])


def open_session(server, fetch=request):
    identity, stamp, bandwidth = "AS" + uuid.uuid4().hex[:16].upper(), str(int(time.time())), 200
    digest = lambda value: hashlib.md5(value.encode()).hexdigest()
    # Protocol checksum, not a credential issued to or stored by Aster.
    token = digest(digest("model=Android&imei=" + identity) + digest(f"stime={stamp}&band={bandwidth}&rand=12345555"))
    query = urllib.parse.urlencode({"key": "", "flag": "true", "bandwidth": bandwidth, "model": "Android",
                                   "imei": identity, "time": stamp, "app": "globalspeed", "token": token,
                                   "pkg": "com.cnspeedtest.globalspeed"})
    reply = fetch("http://" + authority(server) + "/speed/dovalid?" + query).strip()
    if reply and reply[0] in "02":
        raise ControlFailure("公共测速节点繁忙", "session-admission", True)
    if not reply or reply[0] == "-" or len(reply) <= 2:
        raise ControlFailure("公共测速节点拒绝会话或响应无效", "session-admission")
    session = reply[2:]
    if len(session) > 256 or any(ord(c) < 33 or ord(c) > 126 for c in session):
        raise ValueError("公共测速会话格式无效")
    return session


class Budget:
    def __init__(self, maximum):
        self.remaining, self.used = maximum, 0
        self.lock = threading.Lock()

    def reserve(self, size):
        with self.lock:
            size = min(size, self.remaining)
            self.remaining -= size
            return size

    def account(self, reserved, actual):
        with self.lock:
            self.remaining += reserved - actual
            self.used += actual


def transfer_phase(server, session, direction, streams, seconds, warmup, budget, native, deadline_limit=float("inf")):
    stop = threading.Event()
    measurement_start = threading.Event()
    counters = [{"bytes": 0, "measured": 0, "socket": None, "ready": False, "error": "",
                 "stage": "connect", "retryable": False,
                 "invalidResponse": False, "transferEndedAt": 0, "endedAt": 0, "tcpRttMs": None, "retransmits": None,
                 "telemetryLock": threading.Lock(), "basis": "receiver-read" if direction == "download" else "sender-write"} for _ in range(streams)]
    beginning = time.monotonic()
    setup_started = beginning
    deadline = min(deadline_limit, beginning + CONNECT_TIMEOUT + HEADER_TIMEOUT)
    # Reuse one bounded immutable upload block across streams. The byte budget
    # still limits each reservation, including a smaller final block.
    payload = os.urandom(TRANSFER_BLOCK_SIZE) if direction == "upload" else None

    def sample_tcp(counter, connection, finish=False):
        # Socket telemetry is independent of payload chunks. At gigabit rates,
        # per-32KiB TCP_INFO calls add thousands of syscalls / dict parses per
        # second without adding useful temporal resolution to 1s intervals.
        with counter["telemetryLock"]:
            if counter["transferEndedAt"]:
                return  # A monitor sample must never replace the final snapshot.
            try:
                metrics = native.tcp_info(connection)
            except OSError:
                metrics = {}
            for key in ("tcpRttMs", "retransmits"):
                if metrics.get(key) is not None:
                    counter[key] = metrics[key]
            if direction == "upload" and metrics.get("bytesAcked") is not None:
                counter["basis"] = "sender-tcp-acked"
                counter["measured"] = min(counter["bytes"], max(0, metrics["bytesAcked"] - counter.get("headerBytes", 0)))
            if finish:
                counter["transferEndedAt"] = time.monotonic()

    def measured_bytes(counter):
        # A small monitor-only lock gives a coherent basis + ACK snapshot.
        # Payload workers update byte counts without a lock in their hot loop.
        with counter["telemetryLock"]:
            return counter["measured"] if counter["basis"] == "sender-tcp-acked" else counter["bytes"]

    def worker(counter):
        connection = None
        header_size = 0
        try:
            connection = socket.create_connection((server["ip"], server["port"]), timeout=max(.01, min(CONNECT_TIMEOUT, deadline - time.monotonic())))
            counter["socket"] = connection
            if stop.is_set():
                return
            connection.settimeout(max(.01, min(HEADER_TIMEOUT, deadline - time.monotonic())))
            counter["stage"] = "response-headers" if direction == "download" else "request-write"
            host = authority(server)
            if direction == "download":
                path = "/speed/File(1G).dl?" + urllib.parse.urlencode({"r": int(time.time()), "key": session})
                # This legacy service accepts a narrow HTTP wire profile. Do not
                # add library-generated compression/host headers to the request.
                connection.sendall((f"GET {path} HTTP/1.1\r\nAccept: */*\r\nConnection: close\r\nUser-Agent: {DOWNLOAD_AGENT}\r\nHost:{host}\r\n\r\n").encode("ascii"))
                response = http.client.HTTPResponse(connection)
                response.begin()
                if response.status not in {200, 206} or response.getheader("Content-Encoding", "identity") != "identity":
                    raise ControlFailure(f"下载接口 HTTP {response.status}；未计作有效下载", "response-headers", response.status in {408, 429, 500, 502, 503, 504}, response.status)
            else:
                boundary = "aster-public-measurement"
                body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"aster.bin\"\r\n\r\n").encode()
                headers = (f"POST /speed/doAnalsLoad.do HTTP/1.1\r\nUser-Agent: {UPLOAD_AGENT}\r\nCache-Control: no-cache\r\nCharset: UTF-8\r\nHost: {host}\r\nKey: {session}\r\nConnection: close\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: 900000000\r\n\r\n").encode()
                connection.sendall(headers + body)
                header_size = len(headers) + len(body)
                counter["headerBytes"] = header_size
            counter["ready"] = True
            while not measurement_start.wait(.05):
                if stop.is_set():
                    return
            if stop.is_set():
                return
            connection.settimeout(max(.01, min(READ_TIMEOUT, deadline - time.monotonic())))
            counter["stage"] = "transfer"
            response_seen = False
            while not stop.is_set() and time.monotonic() < deadline:
                reserved = budget.reserve(min(TRANSFER_BLOCK_SIZE, 899000000 - counter["bytes"]))
                if not reserved:
                    break
                try:
                    if direction == "download":
                        data = response.read1(reserved)
                        actual = len(data)
                    else:
                        if not response_seen and select.select([connection], [], [], 0)[0]:
                            peek = connection.recv(1024, socket.MSG_PEEK)
                            if peek.startswith(b"HTTP/") and len(peek.split(b" ")) > 1:
                                status = int(peek.split(b" ")[1])
                                if not 200 <= status < 300:
                                    counter["invalidResponse"] = True
                                    raise ValueError(f"上传接口 HTTP {status}；未计作有效速率")
                                response_seen = True
                            elif not peek:
                                raise ValueError("上传端提前关闭连接")
                        actual = connection.send(payload[:reserved])
                except BaseException:
                    budget.account(reserved, 0)
                    raise
                budget.account(reserved, actual)
                counter["bytes"] += actual
                if not actual:
                    break
            sample_tcp(counter, connection, finish=True)
            # A small payload can fill the socket buffer before an HTTP reject
            # arrives. Inspect a bounded late response without counting this wait
            # as transfer time or inventing a successful upload receipt.
            wait = min(0.75, max(0, deadline - time.monotonic()))
            if direction == "upload" and wait and select.select([connection], [], [], wait)[0]:
                peek = connection.recv(1024, socket.MSG_PEEK)
                if peek.startswith(b"HTTP/") and len(peek.split(b" ")) > 1:
                    status = int(peek.split(b" ")[1])
                    if not 200 <= status < 300:
                        counter["invalidResponse"] = True
                        raise ValueError(f"HTTP {status}: upload was rejected")
        except (OSError, ValueError, http.client.HTTPException) as error:
            if not (stop.is_set() and time.monotonic() >= deadline - 0.2):
                counter["error"] = str(error).replace(session, "[session]")[:200] if session else str(error)[:200]
                counter["stage"] = getattr(error, "stage", counter["stage"])
                counter["retryable"] = transient(error)
        finally:
            if not counter["transferEndedAt"]:
                if connection:
                    sample_tcp(counter, connection, finish=True)
                else:
                    counter["transferEndedAt"] = time.monotonic()
            if connection:
                connection.close()
            counter["socket"] = None
            counter["endedAt"] = time.monotonic()

    threads = [threading.Thread(target=worker, args=(counter,), daemon=True) for counter in counters]
    try:
        for thread in threads:
            thread.start()
    except RuntimeError as error:
        stop.set()
        measurement_start.set()
        for counter in counters:
            if counter["socket"]:
                try:
                    counter["socket"].shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        join_until = time.monotonic() + CONNECT_TIMEOUT + HEADER_TIMEOUT + 1
        for thread in threads:
            if thread.ident is not None:
                thread.join(max(0, join_until - time.monotonic()))
        raise OSError(errno.EAGAIN, "无法创建测速线程，请检查容器进程/线程配额") from error
    while time.monotonic() < deadline and not native.cancelled() and not all(c["ready"] or c["endedAt"] for c in counters):
        time.sleep(.05)
    if native.cancelled() or time.monotonic() >= deadline:
        stop.set()
    beginning = time.monotonic()
    setup_seconds = beginning - setup_started
    deadline = min(deadline_limit, beginning + warmup + seconds)
    measurement_start.set()
    intervals, baseline, omitted, previous, last = [], None, 0, 0, beginning + warmup
    next_tcp_sample = beginning
    try:
        while time.monotonic() < deadline and not native.cancelled() and not stop.is_set():
            time.sleep(0.05)
            now = time.monotonic()
            # Refresh the warmup boundary even if the regular 250ms sample is
            # not due, so pre-warmup ACKs cannot leak into measured intervals.
            if now >= next_tcp_sample or (baseline is None and now >= beginning + warmup):
                for counter in counters:
                    connection = counter["socket"]
                    if connection and not counter["transferEndedAt"]:
                        sample_tcp(counter, connection)
                next_tcp_sample = now + 0.25
            if all(c["transferEndedAt"] for c in counters):
                now = min(now, max(c["transferEndedAt"] for c in counters))
            total = sum(measured_bytes(c) for c in counters)
            if now < beginning + warmup:
                omitted = sum(c["bytes"] for c in counters)
                continue
            if baseline is None:
                baseline, previous = (total if warmup else 0), (total if warmup else 0)
                if warmup:
                    omitted = sum(c["bytes"] for c in counters)
            finished = not any(t.is_alive() for t in threads)
            if now - last >= 1 or finished or now >= deadline:
                duration = now - last
                if duration > 0:
                    size = max(0, total - previous)
                    intervals.append({"start": max(0, last - beginning - warmup), "end": now - beginning - warmup,
                                      "seconds": duration, "bytes": size, "bitsPerSecond": size * 8 / duration,
                                      "completeSecond": 0.95 <= duration <= 1.1})
                previous, last = total, now
            if finished:
                break
    finally:
        measured_end = min(time.monotonic(), deadline)
        if all(c["transferEndedAt"] for c in counters):
            measured_end = min(measured_end, max(c["transferEndedAt"] for c in counters))
        stop.set()
        # Closing sockets releases blocked workers; no measurement thread survives the job.
        for counter in counters:
            connection = counter["socket"]
            if connection:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
        join_until = time.monotonic() + CONNECT_TIMEOUT + HEADER_TIMEOUT + 1
        for thread in threads:
            thread.join(max(0, join_until - time.monotonic()))
    elapsed = max(0, measured_end - beginning - warmup)
    measured = sum(i["bytes"] for i in intervals)
    basis = "receiver-read" if direction == "download" else "sender-tcp-acked" if all(c["basis"] == "sender-tcp-acked" for c in counters) else "sender-write"
    valid = measured > 0 and elapsed > 0 and not any(c["invalidResponse"] for c in counters)
    full = valid and elapsed >= seconds - 0.2 and all(c["ready"] and not c["error"] and c["endedAt"] >= deadline - 0.2 for c in counters) and not native.cancelled()
    rtts = [c["tcpRttMs"] for c in counters if c["tcpRttMs"] is not None]
    retrans = [c["retransmits"] for c in counters if c["retransmits"] is not None]
    return {"direction": "target-to-source" if direction == "download" else "source-to-target", "vpsDirection": direction,
            "streams": streams, "state": "ok" if full and basis != "sender-write" else "partial" if valid else "failed",
            "bitsPerSecond": measured * 8 / elapsed if valid else None, "bytes": measured if valid else None,
            "seconds": elapsed, "intervals": intervals if valid else [], "intervalSource": basis, "measurementBasis": basis,
            "setupSeconds": setup_seconds,
            "failureStage": next((c["stage"] for c in counters if c["error"]), ""),
            "retryable": not valid and not any(c["bytes"] for c in counters) and any(c["retryable"] for c in counters) and not any(c["invalidResponse"] for c in counters) and not native.cancelled(),
            "maxBitsPerSecond": max((i["bitsPerSecond"] for i in intervals if i["completeSecond"]), default=None),
            "medianBitsPerSecond": statistics.median(i["bitsPerSecond"] for i in intervals) if intervals else None,
            "trafficBytesObserved": sum(c["bytes"] for c in counters), "warmupBytesObserved": omitted,
            "tcpRttMs": statistics.mean(rtts) if rtts else None,
            "retransmits": sum(retrans) if direction == "upload" and len(retrans) == streams else None,
            "tcpRttMethod": "test socket TCP_INFO" if rtts else "unavailable",
            "tcpSampleSide": "VPS receiver" if direction == "download" else "VPS sender",
            "remoteIp": server["ip"], "diagnostic": "；".join(c["error"] for c in counters if c["error"]) or ("达到公共测速应用载荷上限" if budget.remaining <= 0 else ""),
            "receiverConfirmed": direction == "download"}


def measure(options, native, fetch=request):
    city, carrier, family = options.get("city"), options.get("carrier"), options.get("family")
    if city not in CITIES or carrier not in CARRIERS or family not in {"4", "6"}:
        raise ValueError("公共测速地区、运营商或地址族无效")
    seconds = native.integer(options.get("seconds", 10), 5, 20, "测速时长")
    warmup = native.integer(options.get("warmupSeconds", 2), 0, 2, "预热")
    maximum = native.integer(options.get("maxTrafficMiB", 1024), 16, 4096, "公共测速流量上限")
    streams = options.get("streams", [1])
    if not isinstance(streams, list) or not streams or len(streams) > 2 or 1 not in streams or any(type(n) is not int or n not in {1, 4, 8} for n in streams):
        raise ValueError("公共测速连接数无效")
    result = {"kind": "speed", "method": "Aster public speed", "toolVersion": VERSION, "family": family,
              "provider": "泰尔公共测速（实验）", "state": "failed", "runs": [], "requested": {"city": city, "carrier": carrier},
              "maxTrafficMiB": maximum, "discoveredAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    server, session = None, None
    deadline = time.monotonic() + MEASUREMENT_TIMEOUT
    control = ControlClient(fetch, native, deadline)
    budget = Budget(maximum * 1048576)
    def session_fetch(url, method="GET"):
        return control.call(url, method, "session" if method == "GET" else "session-cleanup")

    def attempt(direction, count):
        if native.cancelled() or time.monotonic() >= deadline:
            raise ControlFailure("测量已取消或达到总时限", "cancelled")
        return transfer_phase(server, session, direction, count, seconds, warmup, budget, native, deadline_limit=deadline)

    def attempt_summary(run):
        return {key: run.get(key) for key in ("state", "failureStage", "diagnostic", "trafficBytesObserved", "seconds")}

    try:
        servers = discover(city, carrier, family, fetch, context=control)
        if not servers:
            result.update(state="failed", diagnostic="公共目录没有严格匹配城市、运营商和地址族的可用节点；未改选其他地区", missingCoverage=True)
            return result
        # Fail over before payload only. Once selected, both directions and
        # their retries stay pinned to this exact endpoint, never a mixed result.
        for candidate_index, candidate in enumerate(servers[:3]):
            server = candidate
            result["candidateAttempts"] = candidate_index + 1
            result["actualEndpoint"] = server
            try:
                session = open_session(server, session_fetch)
                break
            except (OSError, ValueError) as error:
                result.setdefault("candidateFailures", []).append({
                    "ip": server["ip"], "port": server["port"], "stage": getattr(error, "stage", "session"),
                    "retryable": transient(error), "diagnostic": str(error)[:300],
                })
                if candidate_index >= min(3, len(servers)) - 1 or not transient(error):
                    raise
                pause(2, native, deadline)
        for count in dict.fromkeys(streams):
            for direction in ("download", "upload"):
                if native.cancelled():
                    break
                if budget.remaining <= 0:
                    result["runs"].append({"direction": "target-to-source" if direction == "download" else "source-to-target", "vpsDirection": direction,
                                           "streams": count, "state": "missing", "intervals": [], "diagnostic": "已达到此测量点应用载荷上限；未再建立连接"})
                    continue
                result["runs"].append(attempt(direction, count))
        # Finish the other direction first; an already successful upload is
        # never repeated because its download peer timed out. Only retry a
        # failed zero-payload direction, once, against the same shared budget.
        for index, run in enumerate(result["runs"]):
            if native.cancelled() or time.monotonic() + 3 >= deadline:
                break
            if run.get("state") != "failed" or not run.get("retryable") or run.get("trafficBytesObserved", 0) or budget.remaining <= 0:
                continue
            pause(2, native, deadline)
            retry = attempt(run["vpsDirection"], run["streams"])
            retry["attempts"] = [attempt_summary(run), attempt_summary(retry)]
            result["runs"][index] = retry
        result["state"] = "ok" if result["runs"] and all(r["state"] == "ok" for r in result["runs"]) else "partial" if any(r["state"] in {"ok", "partial"} for r in result["runs"]) else "failed"
        result["failureStage"] = next((r.get("failureStage", "transfer") for r in result["runs"] if r.get("state") == "failed"), "")
        result["diagnostic"] = "；".join(f"{r.get('vpsDirection', '')} P{r.get('streams', 1)} / {r.get('failureStage') or 'transfer'}：{r['diagnostic']}" for r in result["runs"] if r.get("diagnostic"))[:700]
        result["retryable"] = result["state"] == "failed" and budget.used == 0 and any(r.get("retryable") for r in result["runs"])
    except (OSError, ValueError, KeyError, http.client.HTTPException) as error:
        result["diagnostic"] = str(error)[:500]
        result["failureStage"] = getattr(error, "stage", "measurement")
        result["retryable"] = transient(error) and budget.used == 0 and not native.cancelled()
        if any(r.get("state") in {"ok", "partial"} for r in result["runs"]):
            result["state"] = "partial"
    finally:
        if server and session:
            try:
                session_fetch("http://" + authority(server) + "/speed/dovalid?" + urllib.parse.urlencode({"key": session}), "POST")
            except (OSError, ValueError):
                result["cleanup"] = "会话释放请求失败，等待服务端过期"
        result["controlRequests"] = control.events[-16:]
        result["directoryCacheHits"] = control.cache_hits
        result["trafficBytesObserved"] = budget.used
        result["remainingTrafficBytes"] = budget.remaining
    return result
