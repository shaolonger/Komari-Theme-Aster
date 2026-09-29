import contextlib
import io
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from importlib.util import module_from_spec, spec_from_file_location

HELPER_PATH = Path(__file__).resolve().parents[1] / "speedtest.py"
SPEC = spec_from_file_location("aster_speedtest", HELPER_PATH)
HELPER = module_from_spec(SPEC)
SPEC.loader.exec_module(HELPER)


class SpeedtestTests(unittest.TestCase):
    def test_two_uncapped_tcp_directions_use_receiver_rates(self):
        commands = []

        def fake_run(command, **kwargs):
            commands.append(command)
            rate = 800_000_000 if "--reverse" in command else 900_000_000
            return SimpleNamespace(returncode=0, stderr="", stdout=json.dumps({
                "end": {
                    "sum_received": {"bits_per_second": rate, "bytes": 1_000_000_000, "seconds": 10},
                    "sum_sent": {"retransmits": 2},
                },
            }))

        output = io.StringIO()
        with patch.object(HELPER.subprocess, "run", side_effect=fake_run), patch.object(HELPER.sys, "argv", ["speedtest.py", "speed.example.net", "5201"]), contextlib.redirect_stdout(output):
            HELPER.main()
        result = json.loads(output.getvalue())
        self.assertEqual(result["upload"]["bitsPerSecond"], 900_000_000)
        self.assertEqual(result["download"]["bitsPerSecond"], 800_000_000)
        self.assertEqual(len(commands), 2)
        self.assertNotIn("--reverse", commands[0])
        self.assertIn("--reverse", commands[1])
        self.assertTrue(all("--bitrate" not in command and "--parallel" in command for command in commands))

    def test_a_failed_direction_never_publishes_a_successful_summary(self):
        good = SimpleNamespace(returncode=0, stderr="", stdout=json.dumps({
            "end": {"sum_received": {"bits_per_second": 900_000_000}},
        }))
        failed = SimpleNamespace(returncode=1, stderr="server busy", stdout=json.dumps({"error": "server busy"}))
        with patch.object(HELPER.subprocess, "run", side_effect=[good, failed]), patch.object(HELPER.sys, "argv", ["speedtest.py", "speed.example.net", "5201"]), self.assertRaisesRegex(ValueError, "server busy"):
            HELPER.main()


if __name__ == "__main__":
    unittest.main()
