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
    def tearDown(self):
        AGENT.close_outbox_scans()

    def test_prepare_rejects_root_or_mismatched_service_identity_before_filesystem_changes(self):
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        for uid, gid, expected in [(0, 123, 123), (123, 0, 0), (123, 123, 456)]:
            with self.subTest(uid=uid, gid=gid, expected=expected), patch.object(AGENT.os, "geteuid", return_value=0), patch.object(AGENT.pwd, "getpwnam", return_value=SimpleNamespace(pw_uid=uid, pw_gid=gid)), patch.object(AGENT.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=expected)), patch.object(AGENT.os, "open") as opened:
                with self.assertRaises(ValueError): AGENT.prepare_outbox(config)
                opened.assert_not_called()

    def test_openrc_registers_separate_probe_service_and_restarts_existing_node(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            init = folder / "init.d"
            init.mkdir()
            (folder / "service-manager").write_text("openrc\n")
            with patch.object(AGENT, "CONFIG_PATH", folder / "agent.json"), patch.object(AGENT, "INIT_DIR", init), patch.object(AGENT, "SERVICE_DIR", AGENT_PATH.parent), patch.object(AGENT.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as service:
                name = AGENT.enable_service(TASK["taskId"])
                self.assertEqual((init / name).read_bytes(), (AGENT_PATH.parent / "aster-network-observatory.openrc").read_bytes())
                self.assertEqual((init / name).stat().st_mode & 0o777, 0o755)
                self.assertEqual(service.call_args_list[0], call(["rc-update", "add", name, "default"], check=True))
                self.assertEqual(service.call_args_list[-1], call(["rc-service", name, "restart"], check=True))
                service.return_value.returncode = 3
                self.assertEqual(AGENT.enable_service(), "aster-network-observatory")
                self.assertEqual(service.call_args_list[-1], call(["rc-service", "aster-network-observatory", "start"], check=True))
                with self.assertRaises(ValueError):
                    AGENT.enable_service("../../invalid")

    def test_lite_limits_latency_concurrency_and_pre_stopped_daemon_does_not_poll(self):
        import threading
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "CONFIG_PATH", Path(temp) / "agent.json"):
            self.assertEqual(AGENT.worker_capacity(), 4)
            (Path(temp) / "install-profile").write_text("lite\n")
            self.assertEqual(AGENT.worker_capacity(), 1)
            stop = threading.Event()
            stop.set()
            with patch.object(AGENT, "load_config", return_value={"nodeUuid": TASK["taskId"]}), patch.object(AGENT, "heartbeat"), patch.object(AGENT, "api_request") as request:
                AGENT.run_daemon("unused", stop)
                request.assert_not_called()

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
            # The service group must read it for rollback to the legacy worker;
            # the file and its directory remain inaccessible to other users.
            self.assertEqual(cached[0].stat().st_mode & 0o777, 0o640)
            with patch.object(AGENT, "api_request", return_value={"ok": True}) as request:
                AGENT.flush_results(config)
                self.assertEqual(request.call_args.kwargs["body"]["id"], task["id"])
            self.assertFalse(cached[0].exists())
            measure.assert_called_once()
        with self.assertRaises(ValueError):
            AGENT.persist_result(config, "../../state", {})

    def test_long_task_restart_reconnects_without_restarting_measurement(self):
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task_id = TASK["taskId"]
        result = {"kind": "tcpquality-full", "state": "ok", "cleanLog": "result"}
        calls = []
        def helper(action, **kwargs):
            calls.append((action, kwargs))
            if action == "list": return {"tasks": [{"id": task_id, "nodeUuid": task_id, "state": "complete"}]}
            if action == "status": return {"state": "complete", "data": result, "revision": 1}
            if action == "ack": return {"ok": True}
            raise AssertionError("must not start the task again")
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT, "tcpquality_request", side_effect=helper), patch.object(AGENT, "api_request", return_value={"ok": True}) as request:
            AGENT.collect_helper_results(config)
            AGENT.flush_results(config)
            self.assertEqual(request.call_args.kwargs["body"], {"id": task_id, "data": result})
            self.assertEqual([name for name, _ in calls], ["list", "status", "ack"])
            self.assertEqual(calls[-1][1]["revision"], 1)
            self.assertEqual(list(Path(temp).rglob("*.json")), [])

    def test_long_task_pending_start_is_idempotent_and_requires_confirmed_lease(self):
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "options": {"profile": "LOWMEM", "timeoutMinutes": 120}}
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT, "tcpquality_request", side_effect=[OSError("response lost"), {"state": "running"}]) as helper:
            AGENT._helper_allowed = None
            AGENT.persist_helper_start(config, task)
            AGENT.flush_helper_starts(config)
            helper.assert_not_called()
            AGENT._helper_allowed = {task["id"]}
            with self.assertRaises(OSError): AGENT.flush_helper_starts(config)
            self.assertEqual(len(list(Path(temp).rglob("*.start.json"))), 1)
            AGENT.flush_helper_starts(config)
            self.assertEqual(helper.call_count, 2)
            self.assertEqual(helper.call_args_list[0], helper.call_args_list[1])
            self.assertFalse(list(Path(temp).rglob("*.start.json")))

    def test_unreachable_helper_before_first_send_records_terminal_failure(self):
        import json
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "options": {"profile": "AUTO", "timeoutMinutes": 120}}
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT, "tcpquality_request", side_effect=AGENT.TcpQualityNotConnected("socket absent")):
            AGENT.persist_helper_start(config, task)
            AGENT._helper_allowed = {task["id"]}
            AGENT.flush_helper_starts(config)
            folder = Path(temp) / ("node-" + task["id"])
            data = json.loads((folder / (task["id"] + ".json")).read_text())["data"]
            self.assertEqual(data["kind"], "tcpquality-full")
            self.assertEqual(data["state"], "failed")
            self.assertIn("执行器未连接", data["diagnostic"])
            self.assertFalse((folder / (task["id"] + ".start.json")).exists())

    def test_missing_unix_socket_is_distinguished_from_an_ambiguous_response(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "TCPQUALITY_SOCKET", Path(temp) / "missing.sock"):
            with self.assertRaises(AGENT.TcpQualityNotConnected):
                AGENT.tcpquality_request("start", id=TASK["taskId"])

    def test_ambiguous_helper_start_never_records_false_failure(self):
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "options": {"profile": "AUTO", "timeoutMinutes": 120}}
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT, "tcpquality_request", side_effect=[OSError("response lost"), AGENT.TcpQualityNotConnected("restarting"), {"state": "running"}]) as helper:
            AGENT.persist_helper_start(config, task)
            AGENT._helper_allowed = {task["id"]}
            with self.assertRaises(OSError): AGENT.flush_helper_starts(config)
            with self.assertRaises(AGENT.TcpQualityNotConnected): AGENT.flush_helper_starts(config)
            self.assertFalse(list(Path(temp).rglob(task["id"] + ".json")))
            AGENT.flush_helper_starts(config)
            self.assertEqual(helper.call_count, 3)
            self.assertFalse(list(Path(temp).rglob("*.start.json")))

    def test_saved_terminal_result_wins_over_unremoved_start_intent(self):
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "options": {}}
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT, "tcpquality_request") as helper:
            AGENT.persist_helper_start(config, task)
            AGENT.persist_result(config, task["id"], {"kind": "tcpquality-full", "state": "failed"})
            AGENT._helper_allowed = {task["id"]}
            AGENT.flush_helper_starts(config)
            helper.assert_not_called()
            self.assertFalse(list(Path(temp).rglob("*.start.json")))
            self.assertTrue(list(Path(temp).rglob(task["id"] + ".json")))

    def test_long_task_conflict_retains_orphan_instead_of_deleting_it(self):
        import urllib.error
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        data = {"kind": "tcpquality-full", "state": "partial", "cleanLog": "report"}
        conflict = urllib.error.HTTPError("https://panel", 409, "expired", {}, None)
        with tempfile.TemporaryDirectory() as temp, patch.object(AGENT, "STATE_DIR", Path(temp)), patch.object(AGENT, "api_request", side_effect=conflict), patch.object(AGENT, "tcpquality_request") as helper:
            AGENT.persist_result(config, TASK["taskId"], data)
            AGENT.flush_results(config)
            orphan = list(Path(temp).rglob("*.orphan.json"))
            self.assertEqual(len(orphan), 1)
            self.assertIn("report", orphan[0].read_text())
            helper.assert_not_called()

    def test_old_outbox_ack_cannot_ack_newer_helper_report(self):
        import json
        import tcpquality_helper
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task_id = TASK["taskId"]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "helper" / task_id
            artifacts = directory / "artifacts"
            artifacts.mkdir(parents=True)
            for path in (root / "helper", directory, artifacts):
                path.chmod(0o700)
            (artifacts / "zstatic_nping_test.csv").write_text("csv")
            data = {"kind": "tcpquality-full", "state": "partial", "csv": "csv", "cleanLog": "log", "reportUrl": ""}
            (directory / "task.json").write_text(json.dumps({"id": task_id, "nodeUuid": task_id, "state": "complete", "revision": 1, "reportPending": True, "acknowledged": False, "data": data}))
            manager = tcpquality_helper.Manager(root / "helper")
            def helper(action, **values): return manager.request({"action": action, **values})
            sent = []
            def send(*args, **kwargs):
                sent.append(kwargs["body"]["data"].copy())
                if len(sent) == 1:
                    with patch.object(tcpquality_helper.tcpquality_full, "recover_report", return_value="https://tcpquality.ibsgss.uk/r/new"):
                        manager.retry_pending()
                return {"ok": True}
            with patch.object(AGENT, "STATE_DIR", root / "agent"), patch.object(AGENT, "tcpquality_request", side_effect=helper), patch.object(AGENT, "api_request", side_effect=send):
                AGENT.collect_helper_results(config)
                AGENT.flush_results(config)
                self.assertTrue(artifacts.exists())
                self.assertEqual(len(manager.request({"action": "list"})["tasks"]), 1)
                AGENT.collect_helper_results(config)
                AGENT.flush_results(config)
                self.assertEqual(sent[0]["reportUrl"], "")
                self.assertEqual(sent[1]["reportUrl"], "https://tcpquality.ibsgss.uk/r/new")
                self.assertFalse(artifacts.exists())
                self.assertEqual(manager.request({"action": "list"})["tasks"], [])

    def test_long_task_heartbeat_cancels_only_after_authoritative_removal(self):
        config = {"nodeUuid": TASK["taskId"], "role": "node"}
        task = {"id": TASK["taskId"], "nodeUuid": TASK["taskId"], "state": "running"}
        stop = SimpleNamespace(is_set=lambda: False, wait=lambda _: None)
        for response, expected in [({"activeJobIds": []}, True), (OSError("offline"), False)]:
            stop.is_set = unittest.mock.Mock(side_effect=[False, True])
            with patch.object(AGENT, "tcpquality_tasks", return_value=[task]), patch.object(AGENT, "tcpquality_request") as helper, patch.object(AGENT, "api_request", side_effect=response if isinstance(response, Exception) else None, return_value=response), patch.object(AGENT.native, "active_tasks", return_value=[]), patch.object(AGENT.native, "reconcile_tasks"):
                AGENT.heartbeat(config, stop)
                self.assertEqual(helper.called, expected)
                if expected: self.assertEqual(helper.call_args.args[0], "cancel")
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
