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
    def test_accepts_allowlisted_modes_hosts_and_tcpquality_default(self):
        self.assertEqual(AGENT.validate_task(TASK)["target"], "example.net")
        self.assertEqual(AGENT.validate_task({**TASK, "target": "2001:db8::1"})["target"], "2001:db8::1")
        quality = {**TASK, "mode": "tcpquality-route", "target": "default"}
        self.assertEqual(AGENT.validate_task(quality)["mode"], "tcpquality-route")

    def test_rejects_shell_text_unknown_modes_and_bad_tcpquality_targets(self):
        for value in (
            {**TASK, "target": "example.net; touch /tmp/pwned"},
            {**TASK, "mode": "shell"},
            {**TASK, "mode": "tcpquality-intl", "target": "attacker.example"},
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                AGENT.validate_task(value)

    def test_validates_ports_and_tls_endpoint_before_sending_credentials(self):
        with self.assertRaises(ValueError):
            AGENT.validate_task({**TASK, "mode": "throughput", "port": 70000})
        with self.assertRaises(ValueError):
            AGENT.validate_base_url("http://komari.example.com")
        self.assertEqual(AGENT.validate_base_url("http://127.0.0.1:25774/"), "http://127.0.0.1:25774")
        self.assertEqual(AGENT.validate_base_url("https://komari.example.com/komari/"), "https://komari.example.com/komari")

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

    def test_capabilities_reflect_installed_commands_and_tcpquality_pair(self):
        with tempfile.TemporaryDirectory() as temp:
            entry = Path(temp) / "runTcpQuality.sh"
            core = Path(temp) / "runTcpQuality-core.sh"
            entry.write_text("#!/bin/sh\n", encoding="utf-8")
            core.write_text("# core\n", encoding="utf-8")
            entry.chmod(0o755)
            with patch.object(AGENT.shutil, "which", side_effect=lambda name: f"/bin/{name}" if name in {"curl", "timeout"} else None):
                reported = AGENT.capabilities({"tcpqualityBin": str(entry)})
            self.assertEqual(set(reported["capabilities"]), {"curl", "timeout", "tcpquality"})
            self.assertEqual(reported["runnerVersion"], AGENT.RUNNER_VERSION)

    def test_runs_only_the_fixed_probe_script_with_separate_arguments(self):
        with tempfile.TemporaryDirectory() as temp:
            probe = Path(temp) / "probe.sh"
            probe.write_text("printf 'ASTER_NETWORK_RESULT_V1\\t%s\\t%s\\t0\\t\\n' \"$1\" \"$2\"\n", encoding="utf-8")
            output = AGENT.run_probe(TASK, probe_path=probe)
            self.assertEqual(output, "ASTER_NETWORK_RESULT_V1\troute\texample.net\t0\t\n")


if __name__ == "__main__":
    unittest.main()
