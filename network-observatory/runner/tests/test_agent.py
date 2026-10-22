import tempfile
import unittest
from unittest.mock import patch, call
from types import SimpleNamespace
from pathlib import Path

from importlib.util import module_from_spec, spec_from_file_location


AGENT_PATH = Path(__file__).resolve().parents[1] / "agent.py"
SPEC = spec_from_file_location("aster_network_agent", AGENT_PATH)
AGENT = module_from_spec(SPEC)
SPEC.loader.exec_module(AGENT)

TASK = {
    "taskId": "c388e74d-a922-4ae1-bd10-1fb30e2e53de",
    "scheduleId": "daily_route_1",
    "mode": "route",
    "target": "example.net",
    "port": 0,
}


class AgentValidationTests(unittest.TestCase):
    def test_syn_capture_service_allows_packet_sockets_without_network_admin(self):
        for filename in ['aster-network-observatory-agent.service', 'aster-network-observatory-probe@.service']:
            unit = (AGENT_PATH.parent / filename).read_text()
            self.assertIn('RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_PACKET', unit)
            self.assertIn('CapabilityBoundingSet=CAP_NET_RAW', unit)
            self.assertNotIn('CAP_NET_ADMIN', unit)

    def test_tcp_quality_preflight_error_is_a_valid_zero_sample_failure(self):
        config = {"serverUrl": "https://panel.example.net", "nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "operation": "tcp-quality", "target": "example.net", "options": {}}
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT.native, "measure", side_effect=ValueError("DNS failed")), patch.object(AGENT, "api_request") as api:
            AGENT.native_task(config, task, {})
        data = api.call_args.kwargs["body"]["data"]
        self.assertEqual(data["kind"], "tcp-quality")
        self.assertEqual(data["state"], "failed")
        self.assertEqual(data["tcpQuality"]["sent"], 0)
        self.assertEqual(data["tcpQuality"]["samples"], [])
        self.assertIsNone(data["tcpQuality"]["medianMs"])

    def test_result_outbox_survives_failed_upload_and_never_repeats_measurement(self):
        import json
        config = {"serverUrl": "https://panel.example.net", "nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "operation": "latency", "target": "example.net", "options": {}}
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT.native, "measure", return_value={"kind": "latency", "state": "failed"}) as measure, patch.object(AGENT, "api_request", side_effect=OSError("offline")), patch.object(AGENT.time, "sleep"):
            with self.assertRaises(OSError):
                AGENT.native_task(config, task, {})
            measure.assert_called_once()
            cached = list((Path(temp) / ("node-" + TASK["taskId"])).glob("*.json"))
            self.assertEqual(len(cached), 1)
            self.assertNotIn("token", cached[0].read_text())
            self.assertEqual(cached[0].stat().st_mode & 0o777, 0o600)
            with patch.object(AGENT, "api_request", return_value={"ok": True}) as request:
                AGENT.flush_results(config)
                self.assertEqual(request.call_args.kwargs["body"]["id"], task["id"])
            self.assertFalse(cached[0].exists())
            measure.assert_called_once()
        with self.assertRaises(ValueError):
            AGENT.persist_result(config, "../../state", {})
    def test_rejects_insecure_credential_transport(self):
        with self.assertRaises(ValueError):
            AGENT.validate_base_url("http://komari.example.com")
        self.assertEqual(AGENT.validate_base_url("http://127.0.0.1:25774/"), "http://127.0.0.1:25774")

    def test_prefilled_upgrade_keeps_only_matching_existing_credential_and_restarts_service(self):
        existing = {"serverUrl": "https://panel.example.net", "nodeUuid": TASK["taskId"], "token": "a" * 64, "tcpqualityBin": ""}
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "agent.json"
            target.write_text(__import__("json").dumps(existing), encoding="utf-8")
            target.chmod(0o600)
            with patch.object(AGENT, "CONFIG_PATH", target), patch.object(AGENT.os, "geteuid", return_value=0), patch.object(AGENT.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=0)), patch.object(AGENT.os, "chown"), patch.object(AGENT.getpass, "getpass", return_value=""), patch("builtins.input", return_value=""), patch.object(AGENT, "api_request", return_value={}) as request, patch.object(AGENT.subprocess, "run") as service:
                AGENT.configure(existing["serverUrl"], existing["nodeUuid"])
                self.assertEqual(AGENT.load_config(target)["token"], existing["token"])
                request.assert_called_once()
                self.assertEqual(service.call_args_list, [call(["systemctl", "enable", AGENT.SERVICE_NAME], check=True), call(["systemctl", "restart", AGENT.SERVICE_NAME], check=True)])
                with self.assertRaises(ValueError):
                    AGENT.configure("https://other.example.net", existing["nodeUuid"])
                self.assertEqual(AGENT.load_config(target)["serverUrl"], existing["serverUrl"])

    def test_mainland_probe_keeps_existing_node_config_and_uses_separate_service(self):
        import json
        with tempfile.TemporaryDirectory() as temp:
            target=Path(temp)/"agent.json"
            original={"serverUrl":"https://panel.example.net","nodeUuid":TASK["taskId"],"token":"a"*64,"tcpqualityBin":""}
            target.write_text(json.dumps(original));target.chmod(0o600)
            with patch.object(AGENT,"CONFIG_PATH",target),patch.object(AGENT.os,"geteuid",return_value=0),patch.object(AGENT.grp,"getgrnam",return_value=SimpleNamespace(gr_gid=0)),patch.object(AGENT.os,"chown"),patch.object(AGENT.getpass,"getpass",return_value="b"*64),patch("builtins.input",return_value=""),patch.object(AGENT,"api_request",return_value={}) as request,patch.object(AGENT.subprocess,"run") as service:
                AGENT.configure(original["serverUrl"],probe_id=TASK["taskId"])
                self.assertEqual(json.loads(target.read_text()),original)
                probe=target.with_name("probe-"+TASK["taskId"]+".json")
                self.assertEqual(AGENT.load_config(probe)["role"],"probe")
                self.assertEqual(request.call_args.args[1], "verify")
                self.assertIn("probe@"+TASK["taskId"],service.call_args.args[0][-1])



if __name__ == "__main__":
    unittest.main()
