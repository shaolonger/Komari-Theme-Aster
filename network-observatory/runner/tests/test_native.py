import sys
import json
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import native

class NativeMeasurements(unittest.TestCase):
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
