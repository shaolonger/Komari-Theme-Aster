import http.server
import json
import socket
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import native
import public_speed as speed
import tcp_quality


class PublicSpeedTests(unittest.TestCase):
    def server_row(self, **extra):
        return {"hostid": "node-1", "hostip": "8.8.8.8", "port": "8080", "hostname": "北京联通", "city": "北京市", "pname": "北京", **extra}

    def test_strict_match_never_substitutes_city_operator_family_or_private_address(self):
        rows = [self.server_row(), self.server_row(city="上海", hostname="上海联通"), self.server_row(hostip="127.0.0.1"), self.server_row(hostname="北京电信"), self.server_row(hostip="2001:4860:4860::8888")]
        matched = speed.select_server(rows, "北京", "联通", "4")
        self.assertEqual(len(matched), 1)
        self.assertEqual(matched[0]["city"], "北京市")
        self.assertEqual(len(speed.select_server(rows + [self.server_row(hostip="::ffff:8.8.8.8")], "北京", "联通", "6")), 1)
        self.assertEqual(speed.select_server(rows, "广州", "联通", "4"), [])
        self.assertEqual(speed.select_server([self.server_row(city="", hostname="北京电信联通移动")], "北京", "联通", "4"), [])
        self.assertEqual(speed.select_server([self.server_row(city="佛山", pname="广东")], "广州", "联通", "4"), [])

    def test_discovery_pins_family_and_preserves_actual_metadata(self):
        calls = []
        def fetch(url):
            calls.append(url)
            return "1.1.1.1|[]" if "getIpLoc" in url else json.dumps([self.server_row()])
        result = speed.discover("北京", "联通", "4", fetch)
        self.assertEqual(result[0]["ip"], "8.8.8.8")
        self.assertIn("ipv6=0", calls[1])
        with self.assertRaises(ValueError):
            speed.discover("北京", "联通", "4", lambda _: "127.0.0.1|[]")

    def test_absent_coverage_is_not_a_successful_zero_and_session_never_opens(self):
        with patch.object(speed, "discover", return_value=[]), patch.object(speed, "open_session") as session:
            result = speed.measure({"city": "北京", "carrier": "电信", "family": "4"}, native)
        self.assertTrue(result["missingCoverage"])
        self.assertEqual(result["runs"], [])
        self.assertEqual(result["state"], "failed")
        session.assert_not_called()

    def test_session_is_released_on_transfer_failure_without_persisting_key(self):
        calls = []
        with patch.object(speed, "discover", return_value=[{"ip": "8.8.8.8", "port": 8080}]), patch.object(speed, "open_session", return_value="PRIVATE_SESSION"), patch.object(speed, "transfer_phase", side_effect=ValueError("disconnected")):
            result = speed.measure({"city": "北京", "carrier": "电信", "family": "4"}, native, lambda *args: calls.append(args))
        self.assertEqual(result["state"], "failed")
        self.assertEqual(calls[-1][1], "POST")
        self.assertNotIn("PRIVATE_SESSION", json.dumps(result))

    def test_single_multi_and_directions_share_one_budget(self):
        budgets = []
        def phase(server, session, direction, streams, seconds, warmup, budget, runtime, deadline_limit):
            self.assertGreater(deadline_limit, 0)
            budgets.append(budget)
            self.assertEqual(budget.reserve(5), 5)
            budget.account(5, 5)
            return {"state": "ok", "streams": streams, "vpsDirection": direction}
        with patch.object(speed, "discover", return_value=[{"ip": "8.8.8.8", "port": 8080}]), patch.object(speed, "open_session", return_value="key"), patch.object(speed, "transfer_phase", side_effect=phase):
            result = speed.measure({"city": "北京", "carrier": "电信", "family": "4", "streams": [1, 4]}, native, lambda *args: "")
        self.assertEqual(result["state"], "ok")
        self.assertEqual(len(result["runs"]), 4)
        self.assertTrue(all(b is budgets[0] for b in budgets))
        for streams in [[True], [4], [1, 16]]:
            with self.assertRaises(ValueError):
                speed.measure({"city": "北京", "carrier": "电信", "family": "4", "streams": streams}, native)

    def test_local_http_transfer_has_a_real_payload_budget_and_does_not_claim_remote_sender_retransmits(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Length", "10485760")
                self.end_headers()
                try:
                    for _ in range(320):
                        self.wfile.write(b"x" * 32768)
                except OSError:
                    pass
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        budget = speed.Budget(131072)
        try:
            result = speed.transfer_phase({"ip": "127.0.0.1", "port": server.server_port}, "key", "download", 1, .3, 0, budget, native)
            self.assertGreater(result["bytes"], 0)
            self.assertEqual(result["trafficBytesObserved"], 131072)
            self.assertEqual(budget.used, 131072)
            self.assertEqual(result["measurementBasis"], "receiver-read")
            self.assertIsNone(result["retransmits"])
            self.assertAlmostEqual(result["bitsPerSecond"], result["bytes"] * 8 / result["seconds"])
            self.assertEqual(result["state"], "partial")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_syn_response_failure_is_not_business_packet_loss(self):
        output = "Max rtt: 30.0ms | Min rtt: 10.0ms | Avg rtt: 20.0ms\nRaw packets sent: 5 (200B) | Rcvd: 3 (120B) | Lost: 2 (40%)"
        with patch.object(tcp_quality.shutil, "which", return_value="nping"), patch.object(native, "execute", return_value=(0, output, "")) as run:
            result = tcp_quality.syn_probe("8.8.8.8", 443, 5, 1200, native)
            self.assertIn("--privileged", run.call_args.args[0])
        self.assertEqual(result["unansweredPercent"], 40)
        self.assertEqual(result["avgMs"], 20)
        self.assertNotIn("lossPercent", result)
        with patch.object(tcp_quality.shutil, "which", return_value=None):
            self.assertEqual(tcp_quality.syn_probe("8.8.8.8", 443, 5, 0, native)["state"], "unavailable")
        with patch.object(tcp_quality.shutil, "which", return_value="nping"), patch.object(native, "execute", return_value=(1, "", "Couldn't acquire raw socket")):
            unavailable = tcp_quality.syn_probe("8.8.8.8", 443, 5, 0, native)
            self.assertEqual(unavailable["state"], "unavailable")
            self.assertIn("raw socket", unavailable["diagnostic"])

    def test_upload_rejection_after_buffered_writes_is_never_valid_bandwidth(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = speed.transfer_phase({"ip": "127.0.0.1", "port": server.server_port}, "key", "upload", 1, 1, 0, speed.Budget(32768), native)
            self.assertEqual(result["state"], "failed")
            self.assertIsNone(result["bitsPerSecond"])
            self.assertEqual(result["intervals"], [])
            self.assertIn("403", result["diagnostic"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(2)

    def test_native_tcp_quality_rejects_nonpublic_and_unknown_payloads(self):
        with patch.object(native, "resolve_ip", return_value="127.0.0.1"):
            with self.assertRaises(ValueError):
                tcp_quality.measure("example.net", {}, native)
        with self.assertRaises(ValueError):
            tcp_quality.measure("example.net", {"packetSizes": [15000]}, native)
