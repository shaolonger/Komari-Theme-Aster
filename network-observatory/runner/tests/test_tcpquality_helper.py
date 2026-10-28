import json
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tcpquality_helper as helper

TASK = 'dc480061-61dc-4267-a063-f5e11a6d337b'
NODE = '4e8f558e-85b3-4c0d-b77d-a56104b0d994'

class HelperTests(unittest.TestCase):
    def test_serve_rejects_root_or_mismatched_worker_before_opening_socket(self):
        for uid, gid, expected in [(0, 123, 123), (123, 0, 0), (123, 123, 456)]:
            with self.subTest(uid=uid, gid=gid, expected=expected), patch.object(helper.os, 'geteuid', return_value=0), patch.object(helper.socket, 'SO_PEERCRED', 17, create=True), patch.object(helper.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=uid, pw_gid=gid)), patch.object(helper.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=expected)), patch.object(helper.socket, 'socket') as sock:
                with self.assertRaises(SystemExit): helper.serve()
                sock.assert_not_called()

    def test_rejects_preexisting_untrusted_state_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            state, external = root / 'state', root / 'external'
            state.mkdir(mode=0o700)
            external.mkdir(mode=0o700)
            outside = external / 'task.json'
            outside.write_text('untouched')
            (state / TASK).symlink_to(external, target_is_directory=True)
            with self.assertRaises(ValueError):
                helper.Manager(state)
            self.assertEqual(outside.read_text(), 'untouched')
            (state / TASK).unlink()
            directory = state / TASK
            directory.mkdir(mode=0o700)
            artifacts = directory / 'artifacts'
            artifacts.mkdir(mode=0o700)
            entry = artifacts / 'entry.sh'
            entry.write_text('#!/bin/sh\n')
            os.chmod(entry, 0o660)
            with self.assertRaises(ValueError):
                helper.Manager(state)
            os.chmod(entry, 0o600)
            os.link(entry, artifacts / 'linked')
            with self.assertRaises(ValueError):
                helper.Manager(state)
            (artifacts / 'linked').unlink()
            os.chmod(artifacts, 0o770)
            with self.assertRaises(ValueError):
                helper.Manager(state)

    def test_idempotency_and_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = str(Path(tmp) / 'state')
            Path(tmp).mkdir(mode=0o700)
            manager = helper.Manager(tmp)
            with patch.object(helper.tcpquality_full, 'run', return_value={'state': 'partial', 'csv': 'x'}) as run:
                self.assertEqual(manager.request({'action': 'start', 'id': TASK, 'nodeUuid': NODE})['state'], 'running')
                for _ in range(100):
                    response = manager.request({'action': 'status', 'id': TASK, 'nodeUuid': NODE})
                    if response['state'] == 'complete':
                        break
                    time.sleep(.01)
                self.assertEqual(response['data']['csv'], 'x')
                self.assertEqual(manager.request({'action': 'start', 'id': TASK, 'nodeUuid': NODE})['state'], 'complete')
                self.assertEqual(run.call_count, 1)
                self.assertEqual(len(manager.request({'action': 'list'})['tasks']), 1)
                manager.request({'action': 'ack', 'id': TASK, 'nodeUuid': NODE, 'revision': response['revision']})
                self.assertEqual(manager.request({'action': 'list'})['tasks'], [])
                self.assertTrue((Path(tmp) / TASK / 'task.json').exists())
            with self.assertRaises(ValueError):
                manager.request({'action': 'start', 'id': TASK, 'nodeUuid': NODE, 'options': {'profile': 'LOWMEM'}})

    def test_restart_interrupted_not_repeated(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = str(Path(tmp) / 'state')
            Path(tmp).mkdir(mode=0o700)
            directory = Path(tmp) / TASK
            directory.mkdir()
            (directory / 'task.json').write_text(json.dumps({'id': TASK, 'nodeUuid': NODE, 'options': {'profile': 'AUTO', 'timeoutMinutes': 120}, 'state': 'running'}))
            manager = helper.Manager(tmp)
            response = manager.request({'action': 'status', 'id': TASK, 'nodeUuid': NODE})
            self.assertEqual(response['state'], 'complete')
            self.assertEqual(response['data']['state'], 'failed')
            self.assertEqual(manager.request({'action': 'start', 'id': TASK, 'nodeUuid': NODE})['state'], 'complete')

    def test_pending_report_survives_restart_and_resubmits_after_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = str(Path(tmp) / 'state')
            Path(tmp).mkdir(mode=0o700)
            directory = Path(tmp) / TASK
            artifacts = directory / 'artifacts'
            artifacts.mkdir(parents=True)
            (artifacts / 'zstatic_nping_1.csv').write_text('test csv')
            (directory / 'task.json').write_text(json.dumps({'id': TASK, 'nodeUuid': NODE, 'options': {'profile': 'AUTO', 'timeoutMinutes': 120}, 'state': 'complete', 'acknowledged': True, 'reportPending': True, 'data': {'state':'partial','exitCode':0,'csv':'test csv','cleanLog':'log','reportUrl':''}}))
            manager = helper.Manager(tmp)
            self.assertEqual(manager.request({'action':'list'})['tasks'], [])
            with patch.object(helper.tcpquality_full, 'recover_report', return_value='https://tcpquality.ibsgss.uk/r/example'):
                manager.retry_pending()
            self.assertEqual(len(manager.request({'action':'list'})['tasks']), 1)
            result = manager.request({'action':'status', 'id':TASK, 'nodeUuid':NODE})['data']
            self.assertEqual(result['reportUrl'], 'https://tcpquality.ibsgss.uk/r/example')
            self.assertEqual(result['state'], 'partial')
            manager.request({'action':'ack', 'id':TASK, 'nodeUuid':NODE, 'revision':2})
            self.assertFalse(artifacts.exists())
            self.assertTrue((directory / 'task.json').exists())

    def test_pending_or_truncated_originals_are_never_deleted_on_ack(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = str(Path(tmp) / 'state')
            Path(tmp).mkdir(mode=0o700)
            directory = Path(tmp) / TASK
            artifacts = directory / 'artifacts'
            artifacts.mkdir(parents=True)
            (artifacts / 'zstatic_nping_1.csv').write_text('test csv')
            for pending, truncated in [(True, False), (False, True)]:
                (directory / 'task.json').write_text(json.dumps({'id': TASK, 'nodeUuid': NODE, 'options': {'profile': 'AUTO', 'timeoutMinutes': 120}, 'state': 'complete', 'acknowledged': False, 'reportPending': pending, 'data': {'csv':'test csv','cleanLog':'log','csvTruncated':truncated}}))
                manager = helper.Manager(tmp)
                manager.request({'action':'ack', 'id':TASK, 'nodeUuid':NODE, 'revision':1})
                self.assertTrue(artifacts.exists())

    def test_stale_ack_does_not_delete_newly_recovered_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = str(Path(tmp) / 'state')
            Path(tmp).mkdir(mode=0o700)
            directory = Path(tmp) / TASK
            artifacts = directory / 'artifacts'
            artifacts.mkdir(parents=True)
            (artifacts / 'zstatic_nping_1.csv').write_text('test csv')
            (directory / 'task.json').write_text(json.dumps({'id': TASK, 'nodeUuid': NODE, 'state': 'complete', 'revision': 1, 'acknowledged': False, 'reportPending': True, 'data': {'kind':'tcpquality-full','state':'partial','csv':'test csv','cleanLog':'log','reportUrl':''}}))
            manager = helper.Manager(tmp)
            old = manager.request({'action':'status', 'id':TASK, 'nodeUuid':NODE})
            with patch.object(helper.tcpquality_full, 'recover_report', return_value='https://tcpquality.ibsgss.uk/r/new'):
                manager.retry_pending()
            with self.assertRaisesRegex(ValueError, '版本已变化'):
                manager.request({'action':'ack', 'id':TASK, 'nodeUuid':NODE, 'revision':old['revision']})
            self.assertTrue(artifacts.exists())
            self.assertEqual(len(manager.request({'action':'list'})['tasks']), 1)
            latest = manager.request({'action':'status', 'id':TASK, 'nodeUuid':NODE})
            self.assertEqual(latest['revision'], 2)
            self.assertEqual(latest['data']['reportUrl'], 'https://tcpquality.ibsgss.uk/r/new')
            manager.request({'action':'ack', 'id':TASK, 'nodeUuid':NODE, 'revision':latest['revision']})
            self.assertEqual(manager.request({'action':'list'})['tasks'], [])

    def test_rejects_untrusted_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = str(Path(tmp) / 'state')
            Path(tmp).mkdir(mode=0o700)
            manager = helper.Manager(tmp)
            with self.assertRaises(ValueError):
                manager.request({'action': 'start', 'id': '../../etc', 'nodeUuid': NODE})
            with self.assertRaises(ValueError):
                manager.request({'action': 'start', 'id': TASK, 'nodeUuid': NODE, 'options': {'profile': 'invalid'}})

if __name__ == '__main__':
    unittest.main()
