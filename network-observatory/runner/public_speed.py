"""Aster's bounded public speed provider. No upstream script/binary is invoked.

Wire interoperability reference: taierspeedtest ed67e6e (protocol documentation
in docs/network-native-measurements.md). Measurement and result design is Aster's.
"""
import hashlib
import http.client
import ipaddress
import json
import os
import select
import socket
import statistics
import threading
import time
import urllib.parse
import urllib.request
import uuid

DIRECTORY = "https://dlcv2.cnspeedtest.cn:8443"
VERSION = "aster-public-speed/1"
TRANSFER_BLOCK_SIZE = 128 * 1024
DOWNLOAD_AGENT = "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.60 Safari/537.36"
UPLOAD_AGENT = "Dalvik/1.6.0 (Linux; U; Android 4.2.2; Aster)"
CITIES = {"北京": "北京", "上海": "上海", "广州": "广东"}
CARRIERS = ("电信", "联通", "移动")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, method="GET"):
    req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None,
                                 headers={"User-Agent": "Aster-Network-Observatory/1.9"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect()).open(req, timeout=6) as response:
        raw = response.read(1048577)
        if len(raw) > 1048576:
            raise ValueError("公共服务响应过大")
        return raw.decode("utf-8")


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


def discover(city, carrier, family, fetch=request):
    location = fetch(DIRECTORY + "/dataServer/getIpLocSP.php").strip().split("|", 1)[0]
    source = ipaddress.ip_address(location)
    if not source.is_global or source.is_multicast:
        raise ValueError("公共目录未返回有效公网出口")
    query = urllib.parse.urlencode({"ip": str(source), "network": "4", "province": CITIES[city],
                                   "city": city, "wifioper": carrier, "mobileoperid": "",
                                   "ipv6": "1" if family == "6" else "0", "model": "Android",
                                   "pkg": "com.cnspeedtest.globalspeed"})
    rows = json.loads(fetch(DIRECTORY + "/dataServer/mobilematch_many.php?" + query))
    return select_server(rows, city, carrier, family)


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
    if not reply or reply[0] in "02-" or len(reply) <= 2:
        raise ValueError("公共测速节点繁忙或拒绝会话")
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


def transfer_phase(server, session, direction, streams, seconds, warmup, budget, native):
    stop = threading.Event()
    counters = [{"bytes": 0, "measured": 0, "socket": None, "ready": False, "error": "",
                 "invalidResponse": False, "transferEndedAt": 0, "endedAt": 0, "tcpRttMs": None, "retransmits": None,
                 "telemetryLock": threading.Lock(), "basis": "receiver-read" if direction == "download" else "sender-write"} for _ in range(streams)]
    beginning = time.monotonic()
    deadline = beginning + warmup + seconds
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
            metrics = native.tcp_info(connection)
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
            connection = socket.create_connection((server["ip"], server["port"]), timeout=5)
            connection.settimeout(1)
            counter["socket"] = connection
            host = authority(server)
            if direction == "download":
                path = "/speed/File(1G).dl?" + urllib.parse.urlencode({"r": int(time.time()), "key": session})
                # This legacy service accepts a narrow HTTP wire profile. Do not
                # add library-generated compression/host headers to the request.
                connection.sendall((f"GET {path} HTTP/1.1\r\nAccept: */*\r\nConnection: close\r\nUser-Agent: {DOWNLOAD_AGENT}\r\nHost:{host}\r\n\r\n").encode("ascii"))
                response = http.client.HTTPResponse(connection)
                response.begin()
                if response.status not in {200, 206} or response.getheader("Content-Encoding", "identity") != "identity":
                    raise ValueError(f"下载接口 HTTP {response.status}，Content-Encoding={response.getheader('Content-Encoding', 'identity')}；未计作有效下载")
            else:
                boundary = "aster-public-measurement"
                body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"upload\"; filename=\"aster.bin\"\r\n\r\n").encode()
                headers = (f"POST /speed/doAnalsLoad.do HTTP/1.1\r\nUser-Agent: {UPLOAD_AGENT}\r\nCache-Control: no-cache\r\nCharset: UTF-8\r\nHost: {host}\r\nKey: {session}\r\nConnection: close\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: 900000000\r\n\r\n").encode()
                connection.sendall(headers + body)
                header_size = len(headers) + len(body)
                counter["headerBytes"] = header_size
            counter["ready"] = True
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
                counter["error"] = str(error)[:200]
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
    for thread in threads:
        thread.start()
    intervals, baseline, omitted, previous, last = [], None, 0, 0, beginning + warmup
    next_tcp_sample = beginning
    try:
        while time.monotonic() < deadline and not native.cancelled():
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
        for thread in threads:
            thread.join(6)
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
    try:
        servers = discover(city, carrier, family, fetch)
        if not servers:
            result.update(state="failed", diagnostic="公共目录没有严格匹配城市、运营商和地址族的可用节点；未改选其他地区", missingCoverage=True)
            return result
        server = servers[0]
        result["actualEndpoint"] = server
        session = open_session(server, fetch)
        budget = Budget(maximum * 1048576)
        for count in dict.fromkeys(streams):
            for direction in ("download", "upload"):
                if native.cancelled():
                    break
                if budget.remaining <= 0:
                    result["runs"].append({"direction": "target-to-source" if direction == "download" else "source-to-target", "vpsDirection": direction,
                                           "streams": count, "state": "missing", "intervals": [], "diagnostic": "已达到此测量点应用载荷上限；未再建立连接"})
                    continue
                result["runs"].append(transfer_phase(server, session, direction, count, seconds, warmup, budget, native))
        result["state"] = "ok" if result["runs"] and all(r["state"] == "ok" for r in result["runs"]) else "partial" if any(r["state"] in {"ok", "partial"} for r in result["runs"]) else "failed"
    except (OSError, ValueError, KeyError) as error:
        result["diagnostic"] = str(error)[:500]
        result["retryable"] = "繁忙" in str(error)
    finally:
        if server and session:
            try:
                fetch("http://" + authority(server) + "/speed/dovalid?" + urllib.parse.urlencode({"key": session}), "POST")
            except (OSError, ValueError):
                result["cleanup"] = "会话释放请求失败，等待服务端过期"
    return result
