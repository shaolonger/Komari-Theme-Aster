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

IP_ENTRY_FIXTURE = b'''db_maxmind(){
local RESPONSE=$(curl $CurlARG -Ls -$1 -m 10 "https://ipinfo.check.place/$IP?lang=$YY")
}

db_others(){
curl $CurlARG -sL -$1 -m 10 "https://ipinfo.check.place/$IP?db=scamalytics"
curl $CurlARG -sL -$1 -m 10 "https://ipinfo.check.place/$IP?db=abuseipdb"
[[ -n ${ipapi[scorenum]} ]]&&ipapi[score]=0
}

db_dbip(){
local tmpcurlarg="$CurlARG"
if [[ $IP == *:* ]];then
tmpcurlarg=""
fi
}

save_json(){
local head_updates=""
ipjson=$(echo "$ipjson"|jq "$head_updates$basic_updates$type_updates$score_updates$factor_updates$media_updates$mail_updates.")
}

clean_ansi(){
printf '%s' "$1"
}
factor_bool(){
printf ''
}

check_IP(){
countRunTimes
db_maxmind $2
db_dbip
MediaUnlockTest_TikTok $2
OpenAITest $2
check_mail
[[ $2 -eq 4 ]]&&check_dnsbl "$IP" 50
if [[ $mode_lite -eq 0 ]];then
local ip_report=$(show_head
)
fi
local report_link=""
}

get_ipv4
get_ipv6
is_valid_ipv4 $IPV4
is_valid_ipv6 $IPV6
get_opts "$@"
show_ad
[[ $IPV4work -ne 0 ]]&&check_IP "$IPV4" 4
'''

class HomeDiagnosticsTests(unittest.TestCase):
    def test_official_agent_executable_and_custom_systemd_install(self):
        with tempfile.TemporaryDirectory() as root:
            proc = Path(root)
            process = proc / "208"
            process.mkdir()
            (process / "comm").write_text("agent\n")
            command = process / "cmdline"
            command.write_bytes(b"\0".join((b"/opt/komari/agent", b"--month-rotate", b"25", b"")))
            self.assertEqual(agent.reset_day(proc), 25)

            unrelated = proc / "209"
            unrelated.mkdir()
            (unrelated / "comm").write_text("agent\n")
            (unrelated / "cmdline").write_bytes(b"/usr/bin/agent\0--month-rotate=3\0")
            (unrelated / "cgroup").write_text("0::/system.slice/unrelated.service\n")
            self.assertEqual(agent.reset_day(proc), 25)

            command.write_bytes(b"/srv/vps-agent/agent\0--month-rotate=26\0")
            (process / "cgroup").write_text("0::/system.slice/komari-agent.service\n")
            self.assertEqual(agent.reset_day(proc), 26)

            command.write_bytes(b"/home/monitor/.local/share/komari/agent\0--month-rotate=27\0")
            self.assertEqual(agent.reset_day(proc), 27)
            (unrelated / "cmdline").write_bytes(b"/opt/komari/agent\0--month-rotate=3\0")
            self.assertIsNone(agent.reset_day(proc))

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
        region_payload = b"pinned script fixture\nRunScript\n"
        ip_digest = hashlib.sha256(IP_ENTRY_FIXTURE).hexdigest()
        region_digest = hashlib.sha256(region_payload).hexdigest()
        report = {
            "Type": {"Usage": {"IP2LOCATION": "Hosting", "IPinfo": "ISP", "AbuseIPDB": "Mobile ISP"}, "Company": {"ipapi": "Line ISP"}},
            "Score": {"ipapi": "3.52%", "IP2LOCATION": 3, "AbuseIPDB": 0, "SCAMALYTICS": 63},
            "IP": "192.0.2.13",
            "Media": {
                "Netflix": {"Status": "x1b[42mx1b[37m Yes x1b[0m", "Region": " US ", "Type": "x1b[43mx1b[37m ViaDNS x1b[0m"},
                "Youtube": {"Status": "Yes", "Region": "US", "Type": "Native"},
                "ChatGPT": {"Status": "Yes", "Region": "US", "Type": "Native"},
                "Reddit": {"Status": "Block"},
                "AmazonPrimeVideo": {"Status": "Block"},
                "TikTok": {"Status": "Failed"},
            },
        }
        seen = []

        def execute(args, **kwargs):
            self.assertNotIn("ASTER_TOKEN", kwargs["env"])
            seen.append(args)
            if args[0] == "curl":
                path = Path(args[args.index("-o") + 1])
                path.write_bytes(region_payload if path.name == "region.sh" else IP_ENTRY_FIXTURE)
                return 0, "", ""
            self.assertEqual(kwargs["input_text"], "")
            self.assertEqual(Path(args[1]).parent, Path(kwargs["cwd"]))
            if args[1].endswith("region.sh"):
                self.assertEqual(args[2:], ["-E", "-M", "6", "-S", "force6"])
                script = Path(args[1]).read_text()
                self.assertIn("Global_UnlockTest 6", script)
                self.assertIn("AI_UnlockTest 6", script)
                self.assertNotIn("RunScript", script)
                return 124, "\x1b[32mNetflix: Yes (Region: US)\x1b[0m\nYouTube Premium: Yes\nChatGPT: No\n" \
                    "Amazon Prime Video: Unsupported\nTikTok: IPv6 Not Support\nDisney+: Yes (Region: US)", ""
            self.assertEqual(args[2:6], ["-6", "-n", "-p", "-E"])
            script = Path(args[1]).read_text()
            self.assertNotIn("check_dnsbl", script)
            if len(seen) == 2:
                self.assertNotIn("OpenAITest $2", script)
                self.assertIn("aster_provider_json", script)
                self.assertIn("for timeout in 10 5", script)
                self.assertIn('local tmpcurlarg="-$1 $CurlARG"', script)
                self.assertIn("db_dbip $2", script)
            else:
                self.assertNotIn("db_maxmind $2", script)
                self.assertIn('command curl -q "-$aster_media_family"', script)
            Path(args[-1]).write_text(json.dumps(report))
            return 1, "", ""

        with patch.object(native, "home_diagnostics_supported", return_value=True), patch.object(native, "execute", side_effect=execute), \
                patch.object(native, "MEDIA_SCRIPT", (native.MEDIA_SCRIPT[0], region_digest)), \
                patch.object(native, "IP_SCRIPT", (native.IP_SCRIPT[0], ip_digest)):
            ip = native.measure({"operation": "ip-quality", "options": {"family": "6"}})
            unlock = native.measure({"operation": "media-unlock", "options": {"family": "6"}})
        self.assertEqual(len(seen), 6)
        self.assertEqual(ip["providers"]["IP2Location"], {"usage": "hosting", "score": "3"})
        self.assertEqual(ip["providers"]["ipapi"], {"company": "line-isp", "score": "3.52%"})
        self.assertEqual(ip["providers"]["AbuseIPDB"], {"usage": "mobile-isp", "score": "0"})
        self.assertEqual(ip["riskScores"], {"IP2Location": "3", "Scamalytics": "63", "ipapi": "3.52%", "AbuseIPDB": "0"})
        self.assertNotIn("192.0.2.13", json.dumps(ip))
        self.assertEqual(unlock["services"], {
            "TikTok": {"status": "unsupported"},
            "DisneyPlus": {"status": "unlocked", "region": "US"},
            "Netflix": {"status": "unlocked", "mode": "dns", "region": "US"},
            "Youtube": {"status": "unlocked", "mode": "native", "region": "US"},
            "ChatGPT": {"status": "unlocked", "mode": "native", "region": "US"},
            "AmazonPrimeVideo": {"status": "blocked"},
            "Reddit": {"status": "blocked"},
        })
        self.assertEqual(unlock["mediaEvidence"]["ChatGPT"]["regionRestriction"], {"status": "unknown"})
        self.assertEqual(unlock["mediaEvidence"]["TikTok"]["ipQuality"], {"status": "failed"})
        self.assertEqual(unlock["state"], "partial")
        self.assertIn("两套脚本判定不同", unlock["diagnostic"])
        self.assertIn("缺少地区或方式：DisneyPlus", unlock["diagnostic"])

    def test_source_vocabulary_and_missing_media_results(self):
        report = {"Media": {
            "Netflix": {"Status": "NF.Only", "Region": "US", "Type": "ViaDNS"},
            "ChatGPT": {"Status": "APPOnly", "Type": "Native"},
            "DisneyPlus": {"Status": "Pending"}, "TikTok": {"Status": "IDC"},
            "Youtube": {"Status": "NoPrem."}, "Reddit": {"Status": "Failed"},
        }}
        result = native.media_result(report, "ChatGPT: No (Blocked)", [])
        self.assertEqual(result["services"]["Netflix"], {"status": "partial", "region": "US", "mode": "dns"})
        self.assertEqual(result["services"]["ChatGPT"], {"status": "partial", "mode": "native"})
        self.assertEqual(result["services"]["DisneyPlus"], {"status": "partial"})
        self.assertEqual(result["services"]["TikTok"], {"status": "partial"})
        self.assertEqual(result["services"]["Youtube"], {"status": "blocked"})
        self.assertNotIn("Reddit", result["services"])
        self.assertEqual(result["mediaEvidence"]["Reddit"]["ipQuality"]["status"], "failed")
        self.assertEqual(native.media_result({}, "ChatGPT: No", [])["state"], "failed")

    def test_lite_partial_and_abuseipdb_placeholder(self):
        result = native.ip_result({"Head": {"Mode": "lite"}, "Score": {"DBIP": 0},
                                   "Type": {"Usage": {"IPinfo": "ISP", "AbuseIPDB": "Other"}}}, "")
        self.assertEqual(result["state"], "partial")
        self.assertEqual(result["dbIpScore"], "0")
        self.assertEqual(result["ipMode"], "lite")
        self.assertNotIn("AbuseIPDB", result["providers"])
        self.assertIn("Lite", result["diagnostic"])

    def test_modified_download_is_never_executed(self):
        def execute(args, **_kwargs):
            self.assertEqual(args[0], "curl")
            Path(args[args.index("-o") + 1]).write_bytes(b"modified content")
            return 0, "", ""

        with patch.object(native, "home_diagnostics_supported", return_value=True), patch.object(native, "execute", side_effect=execute) as run:
            result = native.home_diagnostics("ip-quality", "4")
        run.assert_called_once()
        self.assertEqual(result["state"], "failed")
