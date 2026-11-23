import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent
import native


class HomeDiagnosticsTests(unittest.TestCase):
    def test_agent_flag_overrides_and_short_month_cycle(self):
        with tempfile.TemporaryDirectory() as root:
            proc = Path(root)
            process = proc / "208"
            process.mkdir()
            (process / "comm").write_text("komari-agent\n")
            command = process / "cmdline"
            command.write_bytes(b"\0".join([b"komari-agent", b"--token", b"private", b"--month-rotate", b"31", b""]))
            self.assertEqual(agent.reset_day(proc), 31)
            command.write_bytes(b"komari-agent\0--month-rotate=15\0")
            self.assertEqual(agent.reset_day(proc), 15)
            (process / "environ").write_bytes(b"TOKEN=private\0AGENT_MONTH_ROTATE=28\0")
            self.assertEqual(agent.reset_day(proc), 28)
            command.write_bytes(b"komari-agent\0--config=/path\0--month-rotate=15\0")
            self.assertIsNone(agent.reset_day(proc))
            command.write_bytes(b"komari-agent\0--month-rotate=0\0")
            (process / "environ").unlink()
            self.assertIsNone(agent.reset_day(proc))
        self.assertEqual(agent.cycle(31, date(2026, 2, 27))["elapsed"], 27)
        self.assertEqual(agent.cycle(31, date(2026, 2, 27))["total"], 29)
        self.assertEqual(agent.cycle(31, date(2026, 3, 1))["elapsed"], 0)
        self.assertEqual(agent.cycle(31, date(2026, 3, 1))["total"], 30)

    def test_check_uses_pinned_sources_requested_family_and_safe_result(self):
        payload = b"pinned script fixture\nRunScript\n"
        digest = hashlib.sha256(payload).hexdigest()
        report = {
            "Type": {"Usage": {"IP2LOCATION": "Hosting", "IPinfo": "ISP", "AbuseIPDB": "Mobile ISP"}, "Company": {"ipapi": "Line ISP"}},
            "Score": {"ipapi": "3.52%", "IP2LOCATION": 3, "AbuseIPDB": 0},
            "IP": "192.0.2.13",
            "Media": {
                "Netflix": {"Status": "Yes", "Region": "US", "Type": "DNS"},
                "ChatGPT": {"Status": "Yes", "Region": "US", "Type": "Native"},
                "Reddit": {"Status": "Block"},
            },
        }
        seen = []

        def execute(args, **kwargs):
            self.assertNotIn("ASTER_TOKEN", kwargs["env"])
            seen.append(args)
            if args[0] == "curl":
                Path(args[args.index("-o") + 1]).write_bytes(payload)
                return 0, "", ""
            self.assertEqual(kwargs["input_text"], "")
            self.assertEqual(Path(args[1]).parent, Path(kwargs["cwd"]))
            if args[1].endswith("region.sh"):
                self.assertEqual(args[2:], ["-E", "-M", "6", "-S", "force6"])
                script = Path(args[1]).read_text()
                self.assertIn("Global_UnlockTest 6", script)
                self.assertIn("AI_UnlockTest 6", script)
                self.assertNotIn("RunScript", script)
                return 124, "\x1b[32mNetflix: Yes (Region: US)\x1b[0m\nChatGPT: Yes (Region: JP)\nTikTok: Failed (Network Connection)", ""
            self.assertEqual(args[2:6], ["-6", "-n", "-p", "-E"])
            Path(args[-1]).write_text(json.dumps(report))
            return 1, "", ""

        with patch.object(native, "home_diagnostics_supported", return_value=True), patch.object(native, "execute", side_effect=execute), \
                patch.object(native, "MEDIA_SCRIPT", (native.MEDIA_SCRIPT[0], digest)), \
                patch.object(native, "IP_SCRIPT", (native.IP_SCRIPT[0], digest)):
            ip = native.measure({"operation": "ip-quality", "options": {"family": "6"}})
            unlock = native.measure({"operation": "media-unlock", "options": {"family": "6"}})
        self.assertEqual(len(seen), 6)
        self.assertEqual(ip["providers"]["IP2Location"], {"usage": "hosting", "score": "3"})
        self.assertEqual(ip["providers"]["ipapi"], {"company": "line-isp", "score": "3.52%"})
        self.assertEqual(ip["providers"]["AbuseIPDB"], {"usage": "mobile-isp", "score": "0"})
        self.assertNotIn("192.0.2.13", json.dumps(ip))
        self.assertEqual(unlock["services"], {
            "Netflix": {"status": "unlocked", "mode": "dns", "region": "US"},
            "ChatGPT": {"status": "unlocked", "region": "JP"},
            "Reddit": {"status": "blocked"},
        })

    def test_modified_download_is_never_executed(self):
        def execute(args, **_kwargs):
            self.assertEqual(args[0], "curl")
            Path(args[args.index("-o") + 1]).write_bytes(b"modified content")
            return 0, "", ""

        with patch.object(native, "home_diagnostics_supported", return_value=True), patch.object(native, "execute", side_effect=execute) as run:
            result = native.home_diagnostics("ip-quality", "4")
        run.assert_called_once()
        self.assertEqual(result["state"], "failed")
