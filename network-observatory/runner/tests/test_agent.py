import tempfile
import unittest
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

    def test_runs_only_the_fixed_probe_script_with_separate_arguments(self):
        with tempfile.TemporaryDirectory() as temp:
            probe = Path(temp) / "probe.sh"
            probe.write_text("printf 'ASTER_NETWORK_RESULT_V1\\t%s\\t%s\\t0\\t\\n' \"$1\" \"$2\"\n", encoding="utf-8")
            output = AGENT.run_probe(TASK, probe_path=probe)
            self.assertEqual(output, "ASTER_NETWORK_RESULT_V1\troute\texample.net\t0\t\n")


if __name__ == "__main__":
    unittest.main()
