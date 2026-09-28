import hashlib
import json
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
    "komari-plugin.json": json.dumps({
        "short": "aster-network-observatory",
        "version": "1.1.3",
    }).encode(),
    "runner/agent.py": b"agent",
    "runner/install.sh": b"installer",
    "runner/probe.sh": b"probe",
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
                    if symlink and name == "runner/probe.sh":
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
        result = subprocess.run(["sh", "-n", str(INSTALLER)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)

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
