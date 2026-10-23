import hashlib
import json
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import zipfile

RUNNER = Path(__file__).resolve().parents[1]
SPEC = spec_from_file_location("aster_updater", RUNNER / "updater.py")
U = module_from_spec(SPEC)
SPEC.loader.exec_module(U)
RELEASE = json.loads((RUNNER.parent / "plugin/src/runner-release.json").read_text())
NODE = "c388e74d-a922-4ae1-bd10-1fb30e2e53de"


class UpdaterTests(unittest.TestCase):
    def bundle(self, folder, bad_checksum=False):
        archive = folder / RELEASE["archive"]
        with zipfile.ZipFile(archive, "w") as z:
            for name in [*U.PY_FILES, *U.SERVICE_FILES]:
                z.writestr("runner/" + name, (RUNNER / name).read_bytes())
            z.writestr("runner/release.json", json.dumps(RELEASE))
            z.writestr("komari-plugin.json", (RUNNER.parent / "plugin/komari-plugin.json").read_bytes())
        checksum = folder / "sha256"
        checksum.write_text(("0" * 64 if bad_checksum else hashlib.sha256(archive.read_bytes()).hexdigest()) + "  " + RELEASE["archive"] + "\n")
        return archive, checksum

    def test_release_urls_cannot_select_remote_commands_or_arbitrary_download_hosts(self):
        self.assertTrue(U.release_url(RELEASE).startswith(U.RELEASE_BASE))
        for change in [{"archive": "../../agent.py"}, {"releaseTag": "https://evil.invalid"}, {"protocol": 99}, {"version": "1.2;sh"}]:
            with self.assertRaises(ValueError):
                U.release_url({**RELEASE, **change})

    def test_archive_integrity_is_checked_before_any_executable_is_staged(self):
        with tempfile.TemporaryDirectory() as temp:
            archive, checksum = self.bundle(Path(temp), bad_checksum=True)
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                U.bundle_files(archive, checksum, RELEASE)
            archive, checksum = self.bundle(Path(temp))
            self.assertIn("runner/updater.py", U.bundle_files(archive, checksum, RELEASE))

    def exercise(self, *, automatic=False, enabled=True, busy=False, fail_start=False, preflight_fail=False):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            root, config, state = [folder / name for name in ["runner", "config", "state"]]
            for path in [root, config, state]:
                path.mkdir()
            original = b'RUNNER_VERSION = "1.9.2"\n'
            (root / "agent.py").write_bytes(original)
            credential = {"nodeUuid": NODE, "role": "node", "serverUrl": "https://panel.example.net", "token": "a" * 64}
            config_bytes = json.dumps(credential).encode()
            (config / "agent.json").write_bytes(config_bytes)
            (config / "install-profile").write_text("lite\n")
            archive, checksum = self.bundle(folder)
            def download(url, dest, _limit):
                shutil.copyfile(checksum if url.endswith(".sha256") else archive, dest)
            def api(_config, suffix, **kwargs):
                if suffix == "update-policy":
                    return {"release": RELEASE, "enabled": enabled, "busy": busy, "version": RELEASE["version"], "instanceId": ("a" if starts else "b") * 32}
                return {"lease": "b" * 32}
            fake_agent = SimpleNamespace(load_config=lambda _: credential, validate_base_url=lambda s: s, api_request=Mock(side_effect=api))
            starts = []
            def service(_name, action, check=True):
                if action == "start":
                    starts.append(action)
                    if fail_start and len(starts) == 1:
                        raise RuntimeError("simulated start failure")
                return SimpleNamespace(returncode=0)
            args = SimpleNamespace(command="auto" if automatic else "manual", server_url="", node_uuid=NODE, probe_id="", profile="preserve")
            with patch.object(U, "ROOT", root), patch.object(U, "CONFIG", config), patch.object(U, "STATE", state), patch.object(U, "journal_files", return_value={str(root / n) for n in [*U.PY_FILES, *U.SERVICE_FILES, "release.json"]}), patch.object(U, "download", side_effect=download) as fetch, patch.object(U, "service", side_effect=service) as services, patch.object(U, "install_services"), patch.object(U, "enable_scheduler"), patch.object(U.subprocess, "run", side_effect=RuntimeError("preflight failed") if preflight_fail else None), patch.dict(sys.modules, {"agent": fake_agent}):
                failed = fail_start or preflight_fail
                if failed:
                    with self.assertRaises(RuntimeError):
                        U.perform(args)
                    self.assertEqual((root / "agent.py").read_bytes(), original)
                else:
                    U.perform(args)
                if automatic and (not enabled or busy):
                    fetch.assert_not_called()
                    self.assertEqual((root / "agent.py").read_bytes(), original)
                elif not failed:
                    self.assertEqual((root / "agent.py").read_bytes(), (RUNNER / "agent.py").read_bytes())
                if preflight_fail:
                    self.assertFalse(any(c.args[1] == "stop" for c in services.call_args_list))
                self.assertEqual((config / "agent.json").read_bytes(), config_bytes)
                self.assertEqual((config / "install-profile").read_text(), "lite\n")
                self.assertFalse((state / U.JOURNAL).exists())
                requests = fake_agent.api_request.call_args_list
                if preflight_fail:
                    self.assertFalse(any(c.args[1] == "maintenance" and c.kwargs.get("body", {}).get("action") == "claim" for c in requests))
                if fail_start:
                    self.assertGreaterEqual(len(starts), 2)

    def test_manual_upgrade_preserves_credentials_and_profile(self):
        self.exercise()

    def test_opted_in_automatic_upgrade_uses_the_same_transaction(self):
        self.exercise(automatic=True)

    def test_automatic_upgrade_is_off_by_default_and_waits_for_measurements(self):
        self.exercise(automatic=True, enabled=False)
        self.exercise(automatic=True, busy=True)

    def test_failed_new_service_restores_previous_files_and_service(self):
        self.exercise(fail_start=True)

    def test_failed_preflight_does_not_stop_existing_service(self):
        self.exercise(preflight_fail=True)


if __name__ == "__main__":
    unittest.main()
