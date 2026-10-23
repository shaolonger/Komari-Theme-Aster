import copy
import json
import unittest
from unittest.mock import patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import native


def probe(address, geo, ttl=5, rtt=120000000):
    return {"TTL": ttl, "Address": {"IP": address}, "Success": True, "RTT": rtt, "Geo": geo}


class RouteMetadataTests(unittest.TestCase):
    def setUp(self):
        self.mtr = {"kind": "route", "method": "MTR", "state": "partial", "complete": False,
                    "resolvedIp": "106.37.71.253", "rawOutput": "MTR original",
                    "hops": [{"ttl": 5, "address": "59.43.246.117", "asn": "", "rttMs": 699.75,
                              "lastMs": 3195.1, "avgMs": 699.75, "bestMs": 120.4, "lossPercent": 20, "sent": 20, "received": 16}]}

    def measure(self, payload, code=0, stderr="", options=None):
        output = json.dumps(payload, ensure_ascii=False) if isinstance(payload, dict) else payload
        with patch.object(native, "mtr_route", return_value=copy.deepcopy(self.mtr)), \
                patch.object(native.shutil, "which", return_value="/usr/bin/tool"), \
                patch.object(native, "execute", return_value=(code, output, stderr)) as execute:
            result = native.route("example.net", {"fullMtr": True, "protocol": "tcp", "port": 443, **(options or {})})
        return result, execute

    def test_geo_without_asn_preserves_identity_sources_and_mtr_statistics(self):
        payload = {"Hops": [[probe("59.43.246.117", {"country": "中国", "prov": "上海", "city": "上海",
                    "owner": "中国电信", "isp": "CN2", "domain": "chinatelecom.com.cn", "whois": "CN2-BackBone",
                    "source": "NextTrace-API"})]], "StopReason": {"reason": "destination_reached"}}
        result, execute = self.measure(payload)
        hop = result["hops"][0]
        self.assertEqual(hop["asn"], "")
        self.assertEqual(hop["location"], "中国 · 上海")
        self.assertEqual(hop["network"], "中国电信 · CN2")
        self.assertEqual(hop["domain"], "chinatelecom.com.cn")
        self.assertEqual(hop["whois"], "CN2-BackBone")
        self.assertEqual(hop["geoSource"], "NextTrace / NextTrace-API")
        self.assertTrue(hop["geoQueriedAt"])
        for key in ("rttMs", "lastMs", "avgMs", "bestMs", "lossPercent", "sent", "received"):
            self.assertEqual(hop[key], self.mtr["hops"][0][key])
        self.assertFalse(result["complete"])  # Reaching a target in another trace cannot complete MTR.
        observation = result["metadataObservation"]
        self.assertEqual(observation["matchedIps"], ["59.43.246.117"])
        self.assertEqual(observation["hops"][0]["rttMs"], 120)
        self.assertEqual(observation["hops"][0]["domain"], "chinatelecom.com.cn")
        self.assertEqual(observation["exitCode"], 0)
        self.assertIn("--map", execute.call_args.args[0])  # No map upload dependency before JSON output.
        self.assertEqual(execute.call_args.args[0][-1], self.mtr["resolvedIp"])

    def test_ecmp_metadata_is_matched_by_ip_never_by_ttl(self):
        payload = {"Hops": [[probe("59.43.246.117", {"city": "上海"}),
                                probe("59.43.246.118", {"asnumber": "4809", "city": "北京"})]]}
        result, _ = self.measure(payload)
        self.assertEqual(result["hops"][0]["asn"], "")
        self.assertEqual(result["hops"][0]["location"], "上海")
        payload["Hops"][0] = [probe("59.43.246.118", {"asnumber": "4809", "city": "北京"})]
        result, _ = self.measure(payload)
        self.assertNotIn("location", result["hops"][0])
        self.assertEqual(result["metadataObservation"]["matchedIps"], [])
        self.assertEqual(result["metadataObservation"]["hops"][0]["location"], "北京")

    def test_failures_are_observable_and_do_not_destroy_mtr(self):
        result, _ = self.measure("API unavailable", code=1, stderr="provider connection refused")
        self.assertEqual(result["state"], "partial")
        self.assertEqual(result["hops"], self.mtr["hops"])
        observation = result["metadataObservation"]
        self.assertEqual(observation["state"], "failed")
        self.assertEqual(observation["stdout"], "API unavailable")
        self.assertEqual(observation["stderr"], "provider connection refused")
        self.assertEqual(observation["exitCode"], 1)
        self.assertIn("Hops", observation["parseError"])
        self.assertGreaterEqual(observation["durationMs"], 0)

    def test_prefixed_json_logs_do_not_hide_valid_trace(self):
        payload = '{"error":"progress"}\n' + json.dumps({"Hops": [[probe("59.43.246.117", {"asnumber": "4809"})]]})
        result, _ = self.measure(payload)
        self.assertEqual(result["hops"][0]["asn"], "4809")
        self.assertEqual(result["metadataObservation"]["parseError"], "")

    def test_supplementary_process_failure_cannot_erase_mtr(self):
        result = copy.deepcopy(self.mtr)
        with patch.object(native.shutil, "which", return_value="nexttrace"), patch.object(native, "execute", side_effect=PermissionError("denied")):
            native.route_metadata(result, "example.net", {})
        self.assertEqual(result["hops"], self.mtr["hops"])
        self.assertEqual(result["metadataObservation"]["state"], "failed")
        self.assertIn("denied", result["metadataObservation"]["diagnostic"])

    def test_successful_same_ip_metadata_replaces_an_earlier_lookup_timeout(self):
        payload = {"Hops": [[probe("59.43.246.117", {"source": "timeout"}),
                                probe("59.43.246.117", {"asnumber": "4809", "city": "上海", "source": "NextTrace-API"})]]}
        result, _ = self.measure(payload)
        self.assertEqual(result["hops"][0]["asnSource"], "NextTrace / NextTrace-API")
        self.assertEqual(result["hops"][0]["geoSource"], "NextTrace / NextTrace-API")

    def test_missing_or_disabled_tools_have_explicit_diagnostics(self):
        for options, tool, expected in (({}, None, "missing"), ({"routeMetadata": False}, "nexttrace", "disabled")):
            result = copy.deepcopy(self.mtr)
            with patch.object(native.shutil, "which", return_value=tool), patch.object(native, "execute") as execute:
                native.route_metadata(result, "example.net", options)
            self.assertEqual(result["metadataObservation"]["state"], expected)
            execute.assert_not_called()

    def test_long_output_stays_compatible_with_existing_result_limit(self):
        self.mtr["rawOutput"] = "MTR" * 6000
        self.mtr["hops"] = [dict(self.mtr["hops"][0], ttl=i + 1, address=f"59.43.1.{i + 1}") for i in range(32)]
        geo = {key: "元数据" * 120 for key in ("owner", "isp", "country", "prov", "city", "domain", "whois", "prefix")}
        payload = {"Hops": [[probe(h["address"], geo, h["ttl"])] for h in self.mtr["hops"]]}
        result, _ = self.measure(payload, stderr="provider warning" * 300)
        self.assertLess(len(json.dumps(result, ensure_ascii=False, separators=(",", ":"))), 48000)
        self.assertEqual(len(result["hops"]), 32)
        self.assertEqual(len(result["metadataObservation"]["hops"]), 32)
        self.assertTrue(result["metadataObservation"]["stdoutTruncated"])
        self.assertEqual(result["hops"][0]["avgMs"], 699.75)


if __name__ == "__main__":
    unittest.main()
