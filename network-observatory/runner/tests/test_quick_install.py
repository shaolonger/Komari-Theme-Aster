import hashlib
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path


RUNNER_DIR = Path(__file__).resolve().parents[1]
INSTALLER = RUNNER_DIR / "quick-install.sh"
ARCHIVE_NAME = "Aster-Network-Observatory-latest.zip"
PLUGIN_FILES = {
    "runner/updater.py": b"updater",
    "runner/release.json": b"{}",
    "runner/aster-network-observatory-update.service": b"update-service",
    "runner/aster-network-observatory-update.timer": b"update-timer",
    "runner/aster-network-observatory-update.openrc": b"update-openrc",
    "runner/aster-network-observatory.openrc": b"openrc",
    "runner/aster-network-observatory-http.openrc": b"openrc-http",
    "komari-plugin.json": json.dumps({
        "short": "aster-network-observatory",
        "version": "1.2.0",
    }).encode(),
    "runner/agent.py": b"agent",
    "runner/install.sh": b"installer",
    "runner/native.py": b"native",
    "runner/public_speed.py": b"public-speed",
    "runner/tcp_quality.py": b"tcp-quality",
    "runner/http_receiver.py": b"receiver",
    "runner/aster-network-observatory-http.service": b"http-service",
    "runner/aster-network-observatory-probe@.service": b"probe service",
    "runner/aster-network-observatory-agent.service": b"service",
}


class QuickInstallTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = INSTALLER.read_text(encoding="utf-8")
        cls.verifier_source = script.split("<<'PY'\n", 1)[1].split("\nPY\n", 1)[0]

    def run_verifier(self, *, files=None, tamper_checksum=False, symlink=False):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            archive_path = temp_path / ARCHIVE_NAME
            checksum_path = temp_path / f"{ARCHIVE_NAME}.sha256"
            output_dir = temp_path / "runner"
            with zipfile.ZipFile(archive_path, "w") as bundle:
                for name, payload in (files or PLUGIN_FILES).items():
                    info = zipfile.ZipInfo(name)
                    if symlink and name == "runner/agent.py":
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    bundle.writestr(info, payload)

            digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
            if tamper_checksum:
                digest = "0" * 64
            checksum_path.write_text(f"{digest}  {ARCHIVE_NAME}\n", encoding="ascii")
            verifier_path = temp_path / "verify.py"
            verifier_path.write_text(self.verifier_source, encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(verifier_path), str(archive_path), str(checksum_path), str(output_dir)],
                capture_output=True,
                text=True,
                check=False,
            )
            extracted_agent = output_dir / "agent.py"
            agent_bytes = extracted_agent.read_bytes() if extracted_agent.exists() else None
            escaped_path = temp_path / "outside.txt"
            escaped_exists = escaped_path.exists()
            return result, agent_bytes, escaped_exists

    def test_quick_installer_has_valid_posix_shell_syntax(self):
        for name in ["quick-install.sh", "install.sh", "aster-network-observatory.openrc", "aster-network-observatory-http.openrc"]:
            result = subprocess.run(["sh", "-n", str(RUNNER_DIR / name)], capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_help_and_invalid_profile_stop_before_installing_anything(self):
        help_result = subprocess.run(["sh", str(INSTALLER), "--help"], capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("auto|lite|full", help_result.stdout)
        for args in [["--profile", "unknown"], ["--profile"], ["--unexpected"]]:
            result = subprocess.run(["sh", str(INSTALLER), *args], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("安装失败", result.stderr)

    def run_resource_preflight(self, *, cgroups="0::/\n", budgets=None):
        # No external commands are available. Even a diagnostic must work when
        # the container cannot fork id/cat/awk to inspect its own PID limit.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            proc = root / "proc"
            proc.mkdir()
            (proc / "cgroup").write_text(cgroups)
            controller = root / "cgroup"
            controller.mkdir()
            for name, (current, maximum) in (budgets or {}).items():
                directory = controller / name
                directory.mkdir(parents=True, exist_ok=True)
                (directory / "pids.current").write_text(str(current) + "\n")
                (directory / "pids.max").write_text(str(maximum) + "\n")
            prefix = INSTALLER.read_text().split('\nwhile [ "$#" -gt 0 ]; do', 1)[0]
            prefix = prefix.replace("/proc/self/cgroup", str(proc / "cgroup"))
            prefix = prefix.replace("/sys/fs/cgroup", str(controller))
            result = subprocess.run(
                ["/bin/sh", "-c", prefix + "\nresource_preflight\nprintf 'preflight passed\\n'\n"],
                env={**os.environ, "PATH": "/no-external-commands"},
                capture_output=True, text=True, check=False,
            )
            return result

    def test_pid_exhaustion_reports_actual_limit_without_forking(self):
        result = self.run_resource_preflight(budgets={"": (16, 16)})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pids.current=16，pids.max=16", result.stderr)
        self.assertIn("LXC 宿主机", result.stderr)
        self.assertNotIn("not found", result.stderr)

    def test_limited_pid_headroom_stops_before_package_installation(self):
        result = self.run_resource_preflight(budgets={"": (28, 32)})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("至少预留 8", result.stderr)

    def test_nested_v2_checks_parent_even_when_leaf_is_unlimited(self):
        result = self.run_resource_preflight(
            cgroups="0::/lxc/services\n",
            budgets={"lxc/services": (2, "max"), "lxc": (64, 64), "": (64, "max")},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pids.current=64，pids.max=64", result.stderr)

    def test_nested_v1_controller_limit_is_detected(self):
        result = self.run_resource_preflight(
            cgroups="7:cpu,cpuacct:/lxc\n8:pids:/lxc\n9:memory:/lxc\n",
            budgets={"pids/lxc": (31, 32), "pids": (31, "max")},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pids.current=31，pids.max=32", result.stderr)

    def test_sufficient_unlimited_or_missing_limits_allow_installation(self):
        for budgets in ({"": (1, 32)}, {"": (64, "max")}, {}):
            result = self.run_resource_preflight(budgets=budgets)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("preflight passed", result.stdout)

    def test_non_namespaced_parent_path_does_not_escape_controller(self):
        result = self.run_resource_preflight(
            cgroups="0::/../../host/container\n", budgets={"": (32, 32)},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("pids.current=32，pids.max=32", result.stderr)

    def test_verifies_checksum_and_extracts_only_required_runner_files(self):
        result, agent_bytes, escaped_exists = self.run_verifier(files={
            **PLUGIN_FILES,
            "../../outside.txt": b"must not escape",
            "README.md": b"ignored by bootstrap",
        })
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(agent_bytes, b"agent")
        self.assertFalse(escaped_exists)

    def test_rejects_checksum_mismatch_and_symlink_entries(self):
        result, _, _ = self.run_verifier(tamper_checksum=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("SHA-256", result.stderr)

        result, _, _ = self.run_verifier(symlink=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("不安全", result.stderr)

    def test_rejects_archives_missing_required_files(self):
        result, _, _ = self.run_verifier(files={key: value for key, value in PLUGIN_FILES.items() if key != "runner/agent.py"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("缺少必要文件", result.stderr)


if __name__ == "__main__":
    unittest.main()
