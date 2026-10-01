#!/usr/bin/env python3
"""Optional authenticated HTTPS counterpart for a user-owned speed endpoint."""
import argparse
import hmac
import json
import secrets
import shutil
import subprocess
import pwd
import os
import socket
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Receiver(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    slots = threading.BoundedSemaphore(1)

    def log_message(self, *_):
        pass  # Never record Authorization or arbitrary request paths.

    def authorize(self):
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + self.server.token):
            self.send_error(401)
            return False
        if not self.slots.acquire(blocking=False):
            self.send_error(503, "Endpoint is busy")
            return False
        self.connection.settimeout(3)
        return True

    def do_GET(self):
        if self.path != "/download":
            self.send_error(404)
            return
        if not self.authorize():
            return
        try:
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            deadline, block = time.monotonic() + 35, b"\0" * 65536
            while time.monotonic() < deadline:
                self.wfile.write(b"10000\r\n" + block + b"\r\n")
            self.wfile.write(b"0\r\n\r\n")
        except OSError:
            pass
        finally:
            self.slots.release()
            self.close_connection = True

    def do_POST(self):
        if self.path != "/upload":
            self.send_error(404)
            return
        if not self.authorize():
            return
        try:
            if self.headers.get("Transfer-Encoding", "").lower() != "chunked":
                self.send_error(400)
                return
            warmup = int(self.headers.get("X-Aster-Warmup", "2"))
            if warmup not in {0, 2}:
                self.send_error(400)
                return
            start, last, effective, total, omitted, bucket, intervals = None, None, 0, 0, 0, 0, []
            deadline = time.monotonic() + 35
            while time.monotonic() < deadline:
                line = self.rfile.readline(32)
                length = int(line.strip(), 16)
                if length == 0:
                    if self.rfile.read(2) != b"\r\n":
                        raise ValueError("chunk terminator")
                    break
                if not 0 < length <= 1048576 or total + omitted > 100 * 1024**3:
                    raise ValueError("chunk/traffic budget")
                block = self.rfile.read(length)
                if len(block) != length or self.rfile.read(2) != b"\r\n":
                    raise ValueError("truncated chunk")
                now = time.monotonic()
                if start is None:
                    start, last = now, now + warmup
                if now < start + warmup:
                    omitted += length
                else:
                    total += length
                    bucket += length
                    effective = now - start - warmup
                    if now - last >= 1:
                        duration = now - last
                        intervals.append({"start": last - start - warmup, "end": effective, "seconds": duration, "bytes": bucket})
                        last, bucket = now, 0
            else:
                raise ValueError("receiver deadline")
            if bucket and start is not None and effective > last - start - warmup:
                intervals.append({"start": last - start - warmup, "end": effective, "seconds": effective - (last - start - warmup), "bytes": bucket})
            payload = json.dumps({"schema": "aster-http-receiver-v1", "bytes": total, "seconds": effective, "warmupBytes": omitted, "intervals": intervals}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except (OSError, ValueError):
            self.close_connection = True
        finally:
            self.slots.release()
            self.close_connection = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--configure", action="store_true")
    parser.add_argument("--config", default="/etc/aster-network-observatory/http-receiver.json")
    args = parser.parse_args()
    path = Path(args.config)
    if args.configure:
        if os.geteuid() != 0:
            raise PermissionError("请使用 sudo 运行接收器配置向导")
        account = pwd.getpwnam("aster-netobs")
        cert = Path(input("可信 TLS 证书完整链路径: ").strip()).resolve(strict=True)
        key = Path(input("TLS 私钥路径: ").strip()).resolve(strict=True)
        port = int(input("接收器端口 [8443]: ").strip() or "8443")
        if not 1024 <= port <= 65535:
            raise ValueError("端口需为 1024–65535")
        folder = path.parent
        folder.mkdir(parents=True, exist_ok=True)
        token = secrets.token_hex(32)
        for source, target in [(cert, folder / "receiver-certificate.pem"), (key, folder / "receiver-private.pem")]:
            shutil.copyfile(source, target)
            os.chmod(target, 0o600); os.chown(target, account.pw_uid, account.pw_gid)
        path.write_text(json.dumps({"port": port, "token": token, "certificate": str(folder / "receiver-certificate.pem"), "privateKey": str(folder / "receiver-private.pem")}))
        os.chmod(path, 0o600); os.chown(path, account.pw_uid, account.pw_gid)
        subprocess.run(["systemctl", "enable", "--now", "aster-network-observatory-http.service"], check=True)
        subprocess.run(["systemctl", "restart", "aster-network-observatory-http.service"], check=True)
        print("已启用 HTTPS 接收器。请放行端口", port, "；下载 /download，上传 /upload。证书续期后需重新配置复制证书。")
        print("在集中资源界面填写密钥（只显示一次）：", token)
        return
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("Receiver configuration must have mode 0600")
    config = json.loads(path.read_text())
    if len(config.get("token", "")) < 32:
        raise ValueError("Receiver token must contain at least 32 characters")
    server = ThreadingHTTPServer((config.get("bind", "0.0.0.0"), int(config.get("port", 8443))), Receiver)
    server.daemon_threads = True
    server.token = config["token"]
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(config["certificate"], config["privateKey"])
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
