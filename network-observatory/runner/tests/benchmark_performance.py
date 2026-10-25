#!/usr/bin/env python3
"""Compare two local runner trees using offline loopback / filesystem fixtures.

This developer tool is intentionally not named test_*.py. It never starts a
runner daemon, loads credentials, installs packages or contacts real endpoints.
Supply a trusted baseline runner directory explicitly. The HTTP sender has its
own process so its GIL and CPU time cannot distort client process CPU accounting.
"""
import argparse
from contextlib import contextmanager
import hashlib
import http.client
import http.server
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import platform
import socket
import socketserver
import statistics
import sys
import tempfile
import time
from types import SimpleNamespace

RUNNER = Path(__file__).resolve().parents[1]
NODE = "c388e74d-a922-4ae1-bd10-1fb30e2e53de"


@contextmanager
def loopback_only():
    """Reject non-loopback TCP and DNS destinations, including accidental ones."""
    connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo
    def allowed(sock, address):
        if sock.family != socket.AF_UNIX and (sock.family != socket.AF_INET or not isinstance(address, tuple) or address[0] != "127.0.0.1"):
            raise PermissionError("Benchmark networking is restricted to IPv4 127.0.0.1")
    def local_connect(sock, address):
        allowed(sock, address)
        return connect(sock, address)
    def local_connect_ex(sock, address):
        allowed(sock, address)
        return connect_ex(sock, address)
    def local_getaddrinfo(host, *args, **kwargs):
        if host != "127.0.0.1":
            raise PermissionError("Benchmark DNS / external destinations are disabled")
        return getaddrinfo(host, *args, **kwargs)
    socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = local_connect, local_connect_ex, local_getaddrinfo
    try:
        yield
    finally:
        socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = connect, connect_ex, getaddrinfo


def serve_local(pipe, payload_bytes):
    class Server(http.server.HTTPServer):
        def server_bind(self):
            socketserver.TCPServer.server_bind(self)
            self.server_name, self.server_port = "127.0.0.1", self.server_address[1]
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(payload_bytes))
            self.end_headers()
            block = b"x" * 65536
            remaining = payload_bytes
            try:
                while remaining:
                    size = min(remaining, len(block))
                    self.wfile.write(block[:size])
                    remaining -= size
            except OSError:
                pass  # Parent cancellation / an intentionally bounded phase.
        def log_message(self, *_):
            pass
    with loopback_only(), Server(("127.0.0.1", 0), Handler) as server:
        pipe.send(server.server_port)
        pipe.close()
        server.serve_forever()


@contextmanager
def local_sender(payload_bytes):
    # spawn also works on macOS, without inheriting partially imported runner
    # modules, threads or monkey patches from the benchmark client.
    context = multiprocessing.get_context("spawn")
    reader, writer = context.Pipe(duplex=False)
    process = context.Process(target=serve_local, args=(writer, payload_bytes), daemon=True)
    process.start()
    writer.close()
    try:
        if not reader.poll(15):
            raise TimeoutError("Local benchmark HTTP sender did not start")
        yield reader.recv()
    finally:
        reader.close()
        if process.is_alive():
            process.terminate()
        process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)


def load_runner(directory, label):
    modules, digests = {}, {}
    for name in ("native", "public_speed", "agent"):
        file = directory / (name + ".py")
        alias = "aster_benchmark_" + label + "_" + name
        spec = importlib.util.spec_from_file_location(alias, file)
        module = importlib.util.module_from_spec(spec)
        sys.modules[alias] = module
        search_path, old_native = sys.path[:], sys.modules.get("native")
        try:
            sys.path.insert(0, str(directory))
            if "native" in modules:
                sys.modules["native"] = modules["native"]
            spec.loader.exec_module(module)
        finally:
            sys.path[:] = search_path
            if old_native is None:
                sys.modules.pop("native", None)
            else:
                sys.modules["native"] = old_native
        modules[name] = module
        digests[file.name] = hashlib.sha256(file.read_bytes()).hexdigest()
    return modules, {"directory": str(directory), "version": modules["agent"].RUNNER_VERSION, "sha256": digests}


def ordered_rounds(iterations, warmup):
    for index in range(iterations + warmup):
        yield index >= warmup, ("baseline", "candidate") if index % 2 == 0 else ("candidate", "baseline")


def summarize(samples, fields):
    return {"samples": samples, **{"median" + name[0].upper() + name[1:]: statistics.median(sample[name] for sample in samples) for name in fields}}


def measure_speed(runners, arguments):
    payload_bytes = arguments.payload_mib * 1024 * 1024
    samples = {"baseline": [], "candidate": []}
    original_response = http.client.HTTPResponse
    counter = {"reads": 0}
    class Response(original_response):
        def read1(self, *args):
            counter["reads"] += 1
            return super().read1(*args)
    # Both variants use the same actual socket telemetry reader. No mocked RTT,
    # ACK or retransmit values enter the measured data path.
    telemetry = runners["candidate"]["native"]
    with local_sender(payload_bytes) as port:
        http.client.HTTPResponse = Response
        try:
            for retain, order in ordered_rounds(arguments.iterations, arguments.warmup):
                for label in order:
                    module, calls = runners[label]["public_speed"], [0]
                    counter["reads"] = 0
                    def tcp_info(connection):
                        calls[0] += 1
                        return telemetry.tcp_info(connection)
                    before_cpu, before_wall = time.process_time(), time.perf_counter()
                    result = module.transfer_phase(
                        {"ip": "127.0.0.1", "port": port}, "local-fixture", "download", 1,
                        arguments.phase_timeout, 0, module.Budget(payload_bytes),
                        SimpleNamespace(cancelled=lambda: False, tcp_info=tcp_info),
                    )
                    sample = {"clientCpuMs": (time.process_time() - before_cpu) * 1000,
                              "wallMs": (time.perf_counter() - before_wall) * 1000,
                              "tcpInfoCalls": calls[0], "payloadReads": counter["reads"]}
                    if result.get("bytes") != payload_bytes or result.get("measurementBasis") != "receiver-read":
                        raise RuntimeError(f"{label} did not receive the full fixture payload; increase --phase-timeout")
                    if retain:
                        samples[label].append(sample)
        finally:
            http.client.HTTPResponse = original_response
    output = {label: summarize(values, ("clientCpuMs", "wallMs", "tcpInfoCalls", "payloadReads")) for label, values in samples.items()}
    output["clientCpuReductionPercent"] = 100 * (1 - output["candidate"]["medianClientCpuMs"] / output["baseline"]["medianClientCpuMs"])
    return output


class CountedScan:
    def __init__(self, scan, counter):
        self.scan, self.counter = scan, counter
    def __iter__(self):
        return self
    def __next__(self):
        entry = next(self.scan)
        self.counter["entries"] += 1
        return entry
    def close(self):
        self.scan.close()
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.close()


def measure_outbox(runners, arguments):
    if not arguments.outbox_records:
        return None
    samples = {"baseline": [], "candidate": []}
    enumeration = {"baseline": [], "candidate": []}
    counter, original_scan = {"entries": 0}, os.scandir
    config = {"role": "node", "nodeUuid": NODE, "serverUrl": "http://127.0.0.1"}
    with tempfile.TemporaryDirectory(prefix="aster-runner-outbox-benchmark-") as temporary:
        folders, delivered, saved = {}, [], {}
        try:
            for label in samples:
                module = runners[label]["agent"]
                saved[label] = (module.STATE_DIR, module.api_request)
                module.STATE_DIR = Path(temporary) / label
                folders[label] = module.outbox_dir(config)
                for i in range(arguments.outbox_records):
                    identity = f"{i:08x}-0000-4000-8000-000000000000"
                    data = json.dumps({"id": identity, "data": {}, "createdAt": time.time()})
                    (folders[label] / (identity + ".json")).write_text(data)
                def receive(_config, _suffix, **kwargs):
                    delivered.append(kwargs["body"]["id"])
                    return {"ok": True}
                module.api_request = receive
            os.scandir = lambda path: CountedScan(original_scan(path), counter)
            for retain, order in ordered_rounds(arguments.iterations, arguments.warmup):
                for label in order:
                    module = runners[label]["agent"]
                    counter["entries"], delivered[:] = 0, []
                    before = time.perf_counter()
                    # A completed persistent cursor can require one empty pass
                    # before restarting. Compare the same 16 delivered records.
                    for _ in range(3):
                        module.flush_results(config)
                        if len(delivered) >= 16:
                            break
                    sample = {"wallMs": (time.perf_counter() - before) * 1000,
                              "entriesVisited": counter["entries"], "delivered": len(delivered)}
                    if len(delivered) != 16:
                        raise RuntimeError("Outbox fixture did not deliver one complete batch")
                    for identity in delivered:
                        data = json.dumps({"id": identity, "data": {}, "createdAt": time.time()})
                        (folders[label] / (identity + ".json")).write_text(data)
                    if retain:
                        samples[label].append(sample)
            # Also isolate enumeration from 16 JSON reads / acknowledgements.
            # This reproduces the original sorted-glob vs bounded-cursor audit.
            for retain, order in ordered_rounds(arguments.iterations, arguments.warmup):
                for label in order:
                    module = runners[label]["agent"]
                    close = getattr(module, "close_outbox_scans", None)
                    if close:
                        close()
                    counter["entries"] = 0
                    before = time.perf_counter()
                    batch = getattr(module, "outbox_batch", None)
                    selected = list(batch(folders[label])) if batch else sorted(folders[label].glob("*.json"))[:16]
                    sample = {"wallMs": (time.perf_counter() - before) * 1000,
                              "entriesVisited": counter["entries"]}
                    if len(selected) != 16:
                        raise RuntimeError("Outbox enumeration fixture did not select one complete batch")
                    if retain:
                        enumeration[label].append(sample)
        finally:
            os.scandir = original_scan
            for label, (state, api) in saved.items():
                module = runners[label]["agent"]
                close = getattr(module, "close_outbox_scans", None)
                if close:
                    close()
                module.STATE_DIR, module.api_request = state, api
    return {"delivery": {label: summarize(values, ("wallMs", "entriesVisited")) for label, values in samples.items()},
            "enumeration": {label: summarize(values, ("wallMs", "entriesVisited")) for label, values in enumeration.items()}}


def local_limits():
    limits = {}
    for label, file in (("cpuMax", "/sys/fs/cgroup/cpu.max"), ("memoryMax", "/sys/fs/cgroup/memory.max")):
        try:
            limits[label] = Path(file).read_text().strip()
        except OSError:
            limits[label] = None
    return limits


def positive_integer(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True, help="explicit trusted baseline runner directory")
    parser.add_argument("--candidate", type=Path, default=RUNNER, help="candidate runner directory (default: this runner tree)")
    parser.add_argument("--iterations", type=positive_integer, default=14, help="retained AB/BA rounds per variant (default: 14)")
    parser.add_argument("--warmup", type=int, default=2, help="discarded warmup rounds (default: 2)")
    parser.add_argument("--payload-mib", type=positive_integer, default=64, help="streamed payload per speed phase (default: 64 MiB)")
    parser.add_argument("--phase-timeout", type=positive_integer, default=10, help="maximum seconds per local transfer (default: 10)")
    parser.add_argument("--outbox-records", type=int, default=10000, help="multiple of 16; 0 skips the outbox fixture (default: 10000)")
    arguments = parser.parse_args()
    if arguments.warmup < 0 or arguments.outbox_records < 0 or arguments.outbox_records % 16:
        parser.error("warmup must be nonnegative; outbox-records must be 0 or a positive multiple of 16")
    with loopback_only():
        runners, metadata = {}, {}
        for label in ("baseline", "candidate"):
            directory = getattr(arguments, label).resolve()
            if any(not (directory / (name + ".py")).is_file() for name in ("native", "public_speed", "agent")):
                parser.error(label + " must contain native.py, public_speed.py and agent.py")
            runners[label], metadata[label] = load_runner(directory, label)
        output = {"environment": {"python": platform.python_version(), "system": platform.system(), "machine": platform.machine(),
                                  "network": "127.0.0.1 only; independent HTTP sender process", "telemetry": "real shared candidate TCP_INFO; no mocked values",
                                  "tcpInfoApiAvailable": sys.platform.startswith("linux") and hasattr(socket, "TCP_INFO"), "cgroupLimits": local_limits()},
                  "settings": {"iterations": arguments.iterations, "warmup": arguments.warmup, "payloadMiB": arguments.payload_mib,
                               "phaseTimeout": arguments.phase_timeout, "outboxRecords": arguments.outbox_records},
                  "sources": metadata, "speed": measure_speed(runners, arguments), "outbox": measure_outbox(runners, arguments)}
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
