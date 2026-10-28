"""Native TCP connection quality and optional bounded SYN payload comparison."""
import ipaddress
import re
import shutil
from datetime import datetime, timezone


def syn_probe(address, port, count, payload, native):
    result = {"method": "raw TCP SYN", "payloadBytes": payload, "state": "unavailable", "sent": 0,
              "received": 0, "unansweredPercent": None, "minMs": None, "avgMs": None, "maxMs": None}
    if not shutil.which("nping"):
        result["diagnostic"] = "未安装 nping；未执行原始 SYN 探测。完整 TCP 建连结果独立保留"
        return result
    # Nping otherwise refuses raw mode based only on UID, despite the worker
    # retaining CAP_NET_RAW. This flag does not grant a capability; without
    # the necessary socket permission nping still returns a real failure.
    command = ["nping", "--privileged", "--tcp", "--flags", "syn", "--dest-port", str(port), "--count", str(count),
               "--delay", "200ms", "--data-length", str(payload)]
    if ipaddress.ip_address(address).version == 6:
        command.append("-6")
    code, output, error = native.execute([*command, address], 15)
    result["rawOutput"] = output[:8000]
    # nping's matched response count; this is NOT application packet loss.
    counts = re.search(r"Raw packets sent:\s*(\d+).*?Rcvd:\s*(\d+)", output, re.S | re.I)
    if code or not counts:
        result["diagnostic"] = (error or output or "nping 未返回有效统计；需要 CAP_NET_RAW")[:500]
        return result
    sent, received = map(int, counts.groups())
    if sent != count or not 0 <= received <= sent:
        result["diagnostic"] = "nping 计数与请求不一致；未采用响应率"
        return result
    result.update(state="ok" if received == sent else "partial" if received else "failed", sent=sent,
                  received=received, unansweredPercent=100 * (sent - received) / sent)
    for label, key in (("Min", "minMs"), ("Avg", "avgMs"), ("Max", "maxMs")):
        match = re.search(label + r"\s+rtt:\s*([\d.]+)\s*(ms|us|s)", output, re.I)
        if match and received:
            result[key] = float(match[1]) * {"ms": 1, "us": 0.001, "s": 1000}[match[2].lower()]
    result["conditions"] = "SYN 未取得响应的比例；可能包含过滤/限速，不等同于业务丢包或 MTU 认证"
    return result


def measure(target, options, native):
    target = native.host(target)
    port = native.integer(options.get("port", 443), 1, 65535, "TCP 端口")
    count = native.integer(options.get("samples", 10), 3, 10, "TCP 样本数")
    sizes = options.get("packetSizes", [])
    if not isinstance(sizes, list) or len(sizes) > 3 or any(type(n) is not int or n not in {0, 512, 1200} for n in sizes):
        raise ValueError("SYN 载荷比较参数无效")
    address = native.resolve_ip(target, options)
    ip = ipaddress.ip_address(address)
    if not ip.is_global or ip.is_multicast:
        raise ValueError("TCP 质量目标必须是公网地址")
    quality = native.tcp_connect_quality(address, port, count)
    probes = []
    for size in dict.fromkeys(sizes):
        if native.cancelled():
            break
        probes.append(syn_probe(address, port, count, size, native))
    return {"kind": "tcp-quality", "method": "TCP connect + optional SYN", "state": quality["state"] if not probes or all(p["state"] == "ok" for p in probes) else "partial" if quality["received"] else "failed",
            "target": target, "resolvedIp": address, "family": str(ip.version), "port": port,
            "tcpQuality": quality, "synProbes": probes, "completedAt": datetime.now(timezone.utc).isoformat(),
            "conditions": "建连耗时为完整 TCP connect，不除以二；SYN 响应率与连接失败率独立。包长比较不等同于 PMTU 测量；未修改系统 TCP 参数"}
