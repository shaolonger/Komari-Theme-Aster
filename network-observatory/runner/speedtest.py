#!/usr/bin/env python3
"""Summarize two uncapped iperf3 TCP runs from the VPS point of view."""

import json
import subprocess
import sys

SECONDS = 10
OMIT_SECONDS = 2
STREAMS = 4


def measure(host, port, reverse=False):
    command = [
        "iperf3", "--client", host, "--port", str(port),
        "--time", str(SECONDS), "--omit", str(OMIT_SECONDS),
        "--parallel", str(STREAMS), "--json",
    ]
    if reverse:
        command.append("--reverse")
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=22, check=False)
    except subprocess.TimeoutExpired as error:
        raise ValueError("iperf3 测试超时") from error
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ValueError((completed.stderr or completed.stdout or "iperf3 未返回 JSON")[:300]) from error
    if completed.returncode or payload.get("error"):
        raise ValueError(str(payload.get("error") or completed.stderr or "iperf3 执行失败")[:300])
    received = payload.get("end", {}).get("sum_received", {})
    sent = payload.get("end", {}).get("sum_sent", {})
    rate = received.get("bits_per_second")
    if not isinstance(rate, (int, float)) or not 0 <= rate < float("inf"):
        raise ValueError("iperf3 未返回有效的接收端速率")
    return {
        "bitsPerSecond": rate,
        "bytes": received.get("bytes", 0),
        "seconds": received.get("seconds", 0),
        "retransmits": sent.get("retransmits", 0),
    }


def main():
    if len(sys.argv) != 3:
        raise ValueError("测速目标或端口无效")
    host, port_text = sys.argv[1:]
    port = int(port_text)
    if not 1 <= port <= 65535:
        raise ValueError("测速端口无效")
    upload = measure(host, port)
    download = measure(host, port, reverse=True)
    print(json.dumps({
        "schema": "aster-speedtest-v1",
        "protocol": "TCP",
        "streams": STREAMS,
        "testSeconds": SECONDS,
        "omitSeconds": OMIT_SECONDS,
        "upload": upload,
        "download": download,
    }, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"全速双向测速失败：{error}", file=sys.stderr)
        sys.exit(1)
