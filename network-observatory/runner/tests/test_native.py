import sys
import json
import unittest
import socket
import threading
import time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import native

class NativeMeasurements(unittest.TestCase):
    def test_http_credentials_require_tls_before_any_network_call(self):
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            native.http_speed("example.net", {"endpoint": {"https": False}}, {"token": "x" * 32})

    def test_tcp_quality_measures_real_handshakes_and_refusals(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0)); server.listen(10)
        port = server.getsockname()[1]
        def accept():
            for _ in range(3):
                connection, _ = server.accept(); connection.close()
        worker = threading.Thread(target=accept, daemon=True); worker.start()
        try:
            result = native.tcp_connect_quality("127.0.0.1", port, 3)
            worker.join(timeout=2)
            self.assertEqual(result["received"], 3)
            self.assertEqual(result["failurePercent"], 0)
            self.assertGreater(result["avgMs"], 0)
            self.assertLessEqual(result["minMs"], result["avgMs"])
            self.assertGreaterEqual(result["maxMs"], result["avgMs"])
            self.assertEqual(len(result["samples"]), 3)
            self.assertEqual([x["state"] for x in result["samples"]], ["ok"] * 3)
            self.assertGreater(result["medianMs"], 0)
        finally:
            server.close()
        failed = native.tcp_connect_quality("127.0.0.1", port, 2)
        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["failurePercent"], 100)
        self.assertIsNone(failed["avgMs"])
        self.assertEqual(len(failed["samples"]), 2)
        self.assertEqual([x["state"] for x in failed["samples"]], ["refused"] * 2)
        self.assertTrue(all(x["rttMs"] is None for x in failed["samples"]))
        unavailable = native.tcp_connect_quality("", port, 2)
        self.assertIsNone(unavailable["failurePercent"])
        self.assertEqual(unavailable["sent"], 0)
    def test_website_tcp_sampling_uses_connected_ip_and_static_resource_path(self):
        metrics={"httpStatus":403,"dns":.01,"connect":.03,"tls":.06,"ttfb":.1,"total":.11,"remoteIp":"192.0.2.1","tlsVerify":0}
        with patch.object(native,"execute",return_value=(0,json.dumps(metrics),"")) as execute, patch.object(native,"tcp_connect_quality",return_value={"received":9}) as quality:
            r=native.website("cdnjs.cloudflare.com",{"family":"4","path":"/ajax/libs/jquery/3.7.1/jquery.min.js","tcpSamples":10})
            self.assertEqual(r["state"],"application")
            quality.assert_called_once_with("192.0.2.1",443,10)
            self.assertTrue(execute.call_args.args[0][-1].endswith("/ajax/libs/jquery/3.7.1/jquery.min.js"))
            self.assertEqual(r["tcpQuality"]["received"],9)
    def test_nexttrace_geo_preserves_asn_network_location_and_provider_timeout(self):
        payload={"Hops":[[{"TTL":1,"Success":True,"Address":{"IP":"192.168.1.1"},"RTT":1000000,"Geo":None}],[{"TTL":2,"Success":True,"Address":{"IP":"202.97.1.1"},"RTT":24000000,"Geo":{"asnumber":"AS4134","owner":"CHINANET","country":"中国","prov":"北京","prefix":"202.97.0.0/16","source":"NextTrace-API"}}],[{"TTL":3,"Success":True,"Address":{"IP":"8.8.8.8"},"RTT":25000000,"Geo":{"source":"timeout"}}]],"StopReason":{"reason":"destination_reached"}}
        with patch.object(native.shutil,"which",side_effect=lambda tool:tool if tool=="nexttrace" else None),patch.object(native,"execute",return_value=(0,json.dumps(payload),"")):
            r=native.route("example.net",{"quality":False})
            self.assertTrue(r["complete"])
            self.assertEqual(r["hops"][1]["asn"],"4134")
            self.assertEqual(r["hops"][1]["network"],"CHINANET")
            self.assertEqual(r["hops"][1]["location"],"中国 · 北京")
            self.assertEqual(r["hops"][1]["rttMs"],24)
            self.assertEqual(r["hops"][2]["asnStatus"],"lookup-failed")
    def test_website_application_response_and_405_fallback(self):
        metrics={"httpStatus":403,"dns":.01,"connect":.03,"tls":.06,"ttfb":.1,"total":.11,"remoteIp":"192.0.2.1","tlsVerify":0}
        with patch.object(native,"execute",return_value=(0,json.dumps(metrics),"")) as execute:
            result=native.website("example.net",{"family":"4"})
            self.assertEqual(result["state"],"application")
            self.assertAlmostEqual(result["timingsMs"]["connect"],20)
            self.assertTrue(result["tlsVerified"])
            self.assertNotIn("--fail",execute.call_args.args[0])
        with patch.object(native,"execute",side_effect=[(0,json.dumps({**metrics,"httpStatus":405}),""),(0,json.dumps({**metrics,"httpStatus":200}),"")]) as execute:
            self.assertEqual(native.website("example.net",{})["state"],"ok")
            self.assertIn("--range",execute.call_args.args[0])
    def test_website_failure_stage_and_target_validation(self):
        with patch.object(native,"execute",return_value=(6,'{"httpStatus":0}',"cannot resolve")):
            self.assertEqual(native.website("example.net",{})["errorStage"],"dns")
        for target in ["example.net; rm x","https://example.net","999.1.1.1"]:
            with self.assertRaises(ValueError):native.website(target,{})
    def test_route_preserves_protocol_in_fallback_and_confirms_actual_terminal(self):
        with patch.object(native.shutil,"which",side_effect=lambda tool:tool if tool=="nexttrace" else None),patch.object(native,"execute",side_effect=[(139,"","segfault"),(0,"1  192.0.2.1  25.0 ms\n","")]) as execute,patch.object(native.socket,"getaddrinfo",return_value=[(0,0,0,"",("192.0.2.1",0))]):
            result=native.route("example.net",{"protocol":"tcp","quality":False})
            self.assertTrue(result["complete"])
            self.assertEqual(result["method"],"traceroute")
            self.assertIn("-T",execute.call_args.args[0])
            self.assertIn("32",execute.call_args.args[0])
    def test_benchmark_uncapped_serial_directions_and_partial_failure(self):
        payload=json.dumps({"end":{"sum_received":{"bits_per_second":800000000,"bytes":1000000000,"seconds":10},"sum_sent":{"retransmits":2}}})
        with patch.object(native,"execute",side_effect=[(0,payload,""),(1,'{"error":"busy"}',""),(0,payload,""),(0,payload,"")]) as execute:
            result=native.benchmark("example.net",{"streams":[1,4]})
            self.assertEqual(result["state"],"partial")
            self.assertEqual(len(result["runs"]),4)
            self.assertEqual(result["runs"][1]["direction"],"target-to-source")
            for call in execute.call_args_list:
                self.assertNotIn("-b",call.args[0]);self.assertNotIn("--bitrate",call.args[0]);self.assertNotIn("-O",call.args[0])
        with self.assertRaises(ValueError):native.benchmark("example.net",{"streams":[True]})
    def test_v3_job_rejects_private_data_plane_target_before_invoking_tools(self):
        with patch.object(native, "resolve_ip", return_value="198.19.1.1"), patch.object(native, "benchmark") as tool:
            with self.assertRaises(ValueError):
                native.measure({"operation": "iperf-speed", "target": "example.net", "options": {"reportVersion": 3}})
            tool.assert_not_called()
        with patch.object(native, "resolve_ip", return_value="127.0.0.1"):
            with self.assertRaises(ValueError):
                native.http_speed("example.net", {"streams": [1]})

    def test_structured_speed_uses_receiver_intervals_and_sender_tcp_info_for_each_direction(self):
        receiver = {"intervals": [{"sum": {"start": 0, "end": 2, "seconds": 2, "bytes": 99, "omitted": True}}, {"sum": {"start": 2, "end": 3, "seconds": 1, "bytes": 1000000, "sender": False}}, {"sum": {"start": 3, "end": 3.5, "seconds": .5, "bytes": 1000000, "sender": False}}]}
        local_sender = {"end": {"sum_received": {"bits_per_second": 12000000, "bytes": 2000000, "seconds": 1.5}, "sum_sent": {"retransmits": 3}, "streams": [{"sender": {"mean_rtt": 50000}}]}, "intervals": [{"sum": {"start": 0, "end": 1, "seconds": 1, "bytes": 99999999, "sender": True}}], "server_output_json": receiver}
        remote_sender = {"end": {"sum_sent": {"retransmits": 7}, "streams": [{"sender": {"mean_rtt": 80000}}]}}
        local_receiver = {**receiver, "end": local_sender["end"], "server_output_json": remote_sender}
        with patch.object(native, "resolve_ip", return_value="1.1.1.1"), patch.object(native, "execute", side_effect=[(0, "iperf 3.17", ""), (0, json.dumps(local_sender), ""), (0, json.dumps(local_receiver), "")]) as execute:
            data = native.benchmark("example.net", {"reportVersion": 3, "streams": [1], "warmupSeconds": 2, "vpsRole": "server"})
        download, upload = data["runs"]
        self.assertAlmostEqual(download["bitsPerSecond"], 2000000 * 8 / 1.5)
        self.assertEqual(download["intervalSource"], "server-receiver")
        self.assertEqual(download["intervals"][0]["start"], 0)
        self.assertEqual(download["intervals"][0]["bitsPerSecond"], 8000000)
        self.assertEqual(download["maxBitsPerSecond"], 8000000)  # half-second spike excluded
        self.assertEqual(download["tcpRttMs"], 50)
        self.assertEqual(upload["tcpRttMs"], 80)
        self.assertEqual(upload["retransmits"], 7)
        self.assertEqual(download["vpsDirection"], "download")
        self.assertEqual(upload["vpsDirection"], "upload")
        for call in execute.call_args_list[1:]:
            self.assertIn("--get-server-output", call.args[0])
            self.assertIn("-O", call.args[0])
            self.assertNotIn("-b", call.args[0])
            self.assertEqual(call.args[0][call.args[0].index("-P") + 1], "1")
        missing, source = native.receiver_intervals({"intervals": local_sender["intervals"]}, False)
        self.assertEqual(missing, [])
        self.assertEqual(source, "unavailable")
        self.assertIsNone(native.sender_tcp_metrics({}, True)["tcpRttMs"])
    def test_rejects_supplied_commands(self):
        with self.assertRaises(ValueError):native.measure({"operation":"shell","target":"id"})
    def test_cancel_terminates_the_actual_measurement_subprocess(self):
        started = time.monotonic()
        with native.task_context("cancel-test"):
            timer = threading.Timer(0.15, lambda: native.reconcile_tasks(set()))
            timer.start()
            try:
                code, _, error = native.execute([sys.executable, "-c", "import time; time.sleep(30)"], 35)
            finally:
                timer.cancel()
        self.assertEqual(code, 130)
        self.assertIn("取消", error)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(native.active_tasks(), [])
    def test_mtr_preserves_every_hop_and_silence_has_null_delays(self):
        payload = {"report": {"hubs": [
            {"count": 1, "host": "192.168.1.1", "Snt": 20, "Loss%": 0, "Last": 1.5, "Avg": 2, "Best": 1, "Wrst": 5, "StDev": 1},
            {"count": 2, "host": "???", "Snt": 20, "Loss%": 100, "Last": 0, "Avg": 0, "Best": 0, "Wrst": 0, "StDev": 0},
            {"count": 3, "host": "8.8.8.8", "Snt": 20, "Loss%": 10, "Last": 30, "Avg": 25, "Best": 20, "Wrst": 50, "StDev": 7},
        ]}}
        with patch.object(native, "resolve_ip", return_value="8.8.8.8"), patch.object(native.shutil, "which", return_value="mtr"), patch.object(native, "execute", return_value=(0, json.dumps(payload), "")) as execute:
            data = native.route("example.net", {"fullMtr": True, "protocol": "tcp", "family": "4", "port": 80})
            self.assertEqual(data["method"], "MTR")
            self.assertTrue(data["complete"])
            self.assertEqual(len(data["hops"]), 3)
            self.assertEqual(data["hops"][2]["received"], 18)
            self.assertEqual(data["hops"][2]["lastMs"], 30)
            self.assertIsNone(data["hops"][1]["avgMs"])
            self.assertEqual(data["hops"][1]["address"], "")
            self.assertEqual(execute.call_args.args[0][-1], "8.8.8.8")
            self.assertIn("--tcp", execute.call_args.args[0])
            self.assertEqual(execute.call_count, 1)  # no unrelated traceroute joined by TTL
    def test_latency_dns_failure_never_fabricates_ten_network_samples(self):
        with patch.object(native, "resolve_ip", side_effect=ValueError("DNS timeout")):
            data = native.latency("example.net", {"family": "6"})
        self.assertEqual(data["state"], "failed")
        self.assertEqual(data["tcpQuality"]["sent"], 0)
        self.assertEqual(data["tcpQuality"]["samples"], [])
    def test_latency_refuses_private_dns_and_pins_https_to_the_tcp_endpoint(self):
        with patch.object(native, "resolve_ip", return_value="127.0.0.1"), patch.object(native, "tcp_connect_quality") as tcp:
            self.assertEqual(native.latency("example.net", {})["state"], "failed")
            self.assertNotIn("127.0.0.1", str(tcp.call_args_list))
        with patch.object(native, "resolve_ip", return_value="1.1.1.1"), patch.object(native, "tcp_connect_quality", return_value={"state": "ok", "samples": []}), patch.object(native, "website", return_value={"state": "application", "httpStatus": 403}) as website, patch.object(native.shutil, "which", return_value="curl"):
            data = native.latency("example.net", {"https": True})
            self.assertEqual(data["state"], "ok")
            self.assertEqual(data["https"]["httpStatus"], 403)
            self.assertEqual(website.call_args.args[1]["pinnedIp"], "1.1.1.1")
            self.assertNotIn("tcpSamples", website.call_args.args[1])

if __name__=='__main__':unittest.main()
