"""Deterministic work bounds and accounting checks; never contact real endpoints."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

RUNNER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNNER))
import agent
import native
import public_speed as speed

NODE = "c388e74d-a922-4ae1-bd10-1fb30e2e53de"


class CountingScan:
    def __init__(self, iterator, visits):
        self.iterator, self.visits = iterator, visits
    def __iter__(self):
        return self
    def __next__(self):
        value = next(self.iterator)
        self.visits.append(value.name)
        return value
    def close(self):
        self.iterator.close()
    def __enter__(self):
        return self
    def __exit__(self, *_):
        self.close()


class PerformanceTests(unittest.TestCase):
    def tearDown(self):
        agent.close_outbox_scans()

    def test_outbox_visits_only_a_batch_and_one_failure_cannot_pin_later_durable_results(self):
        config = {"role": "node", "nodeUuid": NODE}
        with tempfile.TemporaryDirectory() as temp, patch.object(agent, "STATE_DIR", Path(temp)):
            folder = agent.outbox_dir(config)
            for i in range(129):
                identity = f"{i:08x}-0000-4000-8000-000000000000"
                (folder / (identity + ".json")).write_text(json.dumps({"id": identity, "data": {"kind": "fixture"}, "createdAt": time.time()}))
            visits, original_scan = [], os.scandir
            def scan(path):
                return CountingScan(original_scan(path), visits)
            with patch.object(agent.os, "scandir", side_effect=scan), patch.object(agent, "api_request") as request:
                agent.flush_results(config)
                self.assertEqual(len(visits), 16)
                self.assertEqual(request.call_count, 16)
                self.assertEqual(len(list(folder.iterdir())), 113)
            blocked = next(folder.iterdir()).stem
            def deliver(_config, _suffix, **kwargs):
                if kwargs["body"]["id"] == blocked:
                    raise OSError("temporary delivery failure")
            with patch.object(agent, "api_request", side_effect=deliver):
                for _ in range(25):
                    try:
                        agent.flush_results(config)
                    except OSError:
                        pass
            self.assertEqual([p.stem for p in folder.iterdir()], [blocked])
            agent.close_outbox_scans()  # Restart loses cursor, never the result.
            with patch.object(agent, "api_request") as request:
                agent.flush_results(config)
                self.assertEqual(request.call_args.kwargs["body"]["id"], blocked)
            self.assertEqual(list(folder.iterdir()), [])

    def test_outbox_debris_also_has_a_per_call_scan_budget(self):
        config = {"role": "node", "nodeUuid": NODE}
        with tempfile.TemporaryDirectory() as temp, patch.object(agent, "STATE_DIR", Path(temp)):
            folder = agent.outbox_dir(config)
            for i in range(129):
                (folder / f"ignored-{i}.tmp").touch()
            visits, original_scan = [], os.scandir
            with patch.object(agent.os, "scandir", side_effect=lambda path: CountingScan(original_scan(path), visits)), patch.object(agent, "api_request") as request:
                agent.flush_results(config)
                self.assertEqual(len(visits), 64)
                request.assert_not_called()

    def test_iperf_capability_is_cached_until_binary_identity_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            executable = Path(temp) / "iperf3"
            executable.write_bytes(b"version-1")
            with patch.object(native, "_auth_scheme_cache", None), patch.object(native.shutil, "which", return_value=str(executable)), patch.object(native, "execute", return_value=(0, "--rsa-private-key-path --use-pkcs1-padding", "")) as execute:
                for _ in range(120):
                    self.assertEqual(native.auth_scheme(), "oaep")
                execute.assert_called_once()
                executable.write_bytes(b"version-2-with-changed-size")
                self.assertEqual(native.auth_scheme(), "oaep")
                self.assertEqual(execute.call_count, 2)
                with patch.object(native.shutil, "which", return_value=None):
                    self.assertEqual(native.auth_scheme(), "unavailable")
            with patch.object(native, "_auth_scheme_cache", None), patch.object(native.shutil, "which", return_value=str(executable)), patch.object(native, "execute", return_value=(124, "", "timeout")) as execute:
                native.auth_scheme(); native.auth_scheme()
                self.assertEqual(execute.call_count, 2)

    def phase(self, direction):
        class Connection:
            header_bytes, payload_bytes, closed = 0, 0, False
            def settimeout(self, _):
                pass
            def sendall(self, payload):
                self.header_bytes += len(payload)
            def send(self, payload):
                self.payload_bytes += len(payload)
                return len(payload)
            def close(self):
                self.closed = True
            def shutdown(self, _):
                pass
        connection = Connection()
        maximum = 16 * 1024 * 1024
        class Response:
            status, remaining = 200, maximum
            def begin(self):
                pass
            def getheader(self, _key, default):
                return default
            def read1(self, maximum):
                count = min(maximum, self.remaining)
                self.remaining -= count
                return b"x" * count
        def info(sock):
            self.assertFalse(sock.closed, "final counters must be read before socket close")
            return {"tcpRttMs": 17, "retransmits": 7, "bytesAcked": sock.header_bytes + sock.payload_bytes // 2}
        runtime = SimpleNamespace(cancelled=lambda: False, tcp_info=Mock(side_effect=info))
        with patch.object(speed.socket, "create_connection", return_value=connection), patch.object(speed.http.client, "HTTPResponse", return_value=Response()), patch.object(speed.select, "select", return_value=([], [], [])):
            result = speed.transfer_phase({"ip": "127.0.0.1", "port": 12345}, "fixture", direction, 1, 1, 0, speed.Budget(maximum), runtime)
        self.assertLessEqual(runtime.tcp_info.call_count, 2)
        self.assertEqual(result["trafficBytesObserved"], maximum)
        self.assertEqual(result["tcpRttMs"], 17)
        self.assertTrue(connection.closed)
        return result, maximum

    def test_download_telemetry_is_time_bounded_and_keeps_receiver_bytes(self):
        result, maximum = self.phase("download")
        self.assertEqual(result["bytes"], maximum)
        self.assertEqual(result["measurementBasis"], "receiver-read")
        self.assertIsNone(result["retransmits"])

    def test_final_upload_ack_is_refreshed_without_counting_unconfirmed_sender_writes(self):
        result, maximum = self.phase("upload")
        self.assertEqual(result["bytes"], maximum // 2)
        self.assertEqual(result["measurementBasis"], "sender-tcp-acked")
        self.assertEqual(result["retransmits"], 7)

    def test_openrc_maintenance_has_one_persisted_minute_and_randomness_fallback(self):
        source = (RUNNER / "aster-network-observatory-update.openrc").read_text()
        for random_output, minute in [("1789", "49"), ("", "17")]:
            with self.subTest(random_output=random_output), tempfile.TemporaryDirectory() as temp:
                folder = Path(temp)
                config, state = folder / "config", folder / "state"
                source_copy = source.replace("/etc/aster-network-observatory", str(config)).replace("/var/lib/aster-network-observatory", str(state))
                source_copy = source_copy.replace("/usr/bin/python3 -B /usr/local/libexec/aster-network-observatory/updater.py recover", ":")
                service = folder / "service.sh"
                service.write_text(source_copy)
                script = '''
checkpath() { for destination do :; done; mkdir -p "$destination"; }
od() { printf x >> "$COUNTER"; printf '%s\\n' "$RANDOM_OUTPUT"; }
. "$SERVICE"
start_pre
printf changed > "$CONFIG/agent.json"
printf probe > "$CONFIG/probe-first.json"
printf probe > "$CONFIG/probe-second.json"
start_pre
'''
                subprocess.run(["sh", "-eu", "-c", script], env={**os.environ, "COUNTER":str(folder / "random-calls"), "SERVICE":str(service), "CONFIG":str(config), "RANDOM_OUTPUT":random_output}, check=True)
                self.assertEqual((folder / "random-calls").read_text(), "x")
                self.assertEqual((state / "update-minute").read_text().strip(), minute)
                self.assertEqual((state / "update-minute").stat().st_mode & 0o777, 0o600)
                self.assertEqual((config / "cron/root").read_text(), minute + " * * * * /usr/bin/python3 -B /usr/local/libexec/aster-network-observatory/updater.py auto\n")
                self.assertEqual([p.name for p in (config / "cron").iterdir()], ["root"])


if __name__ == "__main__":
    unittest.main()
