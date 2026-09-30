import sys
import json
import unittest
import socket
import threading
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import native

class NativeMeasurements(unittest.TestCase):
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
        finally:
            server.close()
        failed = native.tcp_connect_quality("127.0.0.1", port, 2)
        self.assertEqual(failed["state"], "failed")
        self.assertEqual(failed["failurePercent"], 100)
        self.assertIsNone(failed["avgMs"])
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
    def test_rejects_supplied_commands(self):
        with self.assertRaises(ValueError):native.measure({"operation":"shell","target":"id"})

if __name__=='__main__':unittest.main()
