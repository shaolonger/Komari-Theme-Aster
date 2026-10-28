import fcntl
import os
import subprocess
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import tcpquality_full as full


class FullTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.lock = str(self.root / 'lock')

    def tearDown(self):
        self.tmp.cleanup()

    def test_auto_profile_matches_upstream_thresholds(self):
        info = self.root / 'meminfo'
        for mem, swap, expected in [(131072, 0, 'LOWMEM'), (196607, 131072, 'LOWMEM'),
                                    (196608, 0, 'LOWMEM'), (196608, 131072, 'FULL'),
                                    (262143, 0, 'LOWMEM'), (262144, 0, 'FULL')]:
            info.write_text(f'MemTotal: {mem} kB\nSwapTotal: {swap} kB\n')
            self.assertEqual(full.profile_for('AUTO', str(info), self.root, self.root / 'absent'), expected)
        with self.assertRaises(ValueError):
            full.profile_for('BAD')

    def test_auto_profile_uses_strictest_v2_parent_memory_and_swap_limits(self):
        info, membership = self.root / 'meminfo', self.root / 'membership'
        info.write_text('MemTotal: 16777216 kB\nSwapTotal: 1048576 kB\n')
        membership.write_text('0::/tenant/service\n')
        parent, leaf = self.root / 'tenant', self.root / 'tenant/service'
        leaf.mkdir(parents=True)
        (leaf / 'memory.max').write_text('max')
        (parent / 'memory.max').write_text(str(128 * 1024 * 1024))
        self.assertEqual(full.profile_for('AUTO', info, self.root, membership), 'LOWMEM')
        (parent / 'memory.max').write_text(str(192 * 1024 * 1024))
        (parent / 'memory.swap.max').write_text('0')
        self.assertEqual(full.profile_for('AUTO', info, self.root, membership), 'LOWMEM')
        (parent / 'memory.swap.max').write_text(str(128 * 1024 * 1024))
        self.assertEqual(full.profile_for('AUTO', info, self.root, membership), 'FULL')
        (parent / 'memory.max').write_text(str(256 * 1024 * 1024))
        (parent / 'memory.swap.max').write_text('0')
        self.assertEqual(full.profile_for('AUTO', info, self.root, membership), 'FULL')

    def test_auto_profile_uses_v1_memory_memsw_and_unlimited_sentinel(self):
        info, membership = self.root / 'meminfo', self.root / 'membership'
        info.write_text('MemTotal: 16777216 kB\nSwapTotal: 1048576 kB\n')
        membership.write_text('5:memory:/tenant/service\n')
        parent, leaf = self.root / 'memory/tenant', self.root / 'memory/tenant/service'
        leaf.mkdir(parents=True)
        (leaf / 'memory.limit_in_bytes').write_text('9223372036854771712')
        (parent / 'memory.limit_in_bytes').write_text(str(192 * 1024 * 1024))
        (parent / 'memory.memsw.limit_in_bytes').write_text(str(192 * 1024 * 1024))
        self.assertEqual(full.profile_for('AUTO', info, self.root, membership), 'LOWMEM')
        (parent / 'memory.memsw.limit_in_bytes').write_text(str(320 * 1024 * 1024))
        self.assertEqual(full.profile_for('AUTO', info, self.root, membership), 'FULL')

    def test_pid_preflight_checks_v2_parent_and_v1_leaf(self):
        membership = self.root / 'membership'
        membership.write_text('0::/tenant/service\n')
        parent, leaf = self.root / 'tenant', self.root / 'tenant/service'
        leaf.mkdir(parents=True)
        (leaf / 'pids.max').write_text('max')
        (leaf / 'pids.current').write_text('5')
        (parent / 'pids.max').write_text('40')
        (parent / 'pids.current').write_text('38')
        self.assertIn('pids.current=38', full.resource_preflight(self.root, str(self.root), membership))
        membership.write_text('2:pids:/tenant/service\n')
        parent, leaf = self.root / 'pids/tenant', self.root / 'pids/tenant/service'
        leaf.mkdir(parents=True)
        (leaf / 'pids.max').write_text('20')
        (leaf / 'pids.current').write_text('13')
        self.assertIn('pids.current=13', full.resource_preflight(self.root, str(self.root), membership))

    def test_controller_path_rejects_parent_traversal(self):
        membership = self.root / 'membership'
        membership.write_text('0::/../../escape\n')
        self.assertEqual(full.controller_paths('memory', self.root, membership), [self.root, self.root / 'memory'])

    def test_full_execution_args_and_csv_retention(self):
        def entry(url, path, cancelled):
            path.write_text('#!/bin/bash\nprintf "%s\\n" "$*"\nprintf "网络,IP版本,状态\\n三网,IPv4,OK\\n三网,IPv6,OK\\n" > "$TCPQUALITY_OUTPUT_DIR/zstatic_nping_fixture.csv"\necho 检测到可用 IPv4\necho 检测到可用 IPv6\necho https://tcpquality.ibsgss.uk/r/test_ID\n')
            return True
        popen = subprocess.Popen
        def fake_unshare(command, **kwargs):
            return popen(command[command.index('bash'):], **kwargs)
        with patch.object(full, '_download', side_effect=entry), patch.object(full.shutil, 'which', return_value='/usr/bin/tool'), patch.object(full.subprocess, 'Popen', side_effect=fake_unshare):
            result = full.run({'profile': 'LOWMEM', 'timeoutMinutes': 120}, self.root / 'artifacts', lock_path=self.lock)
        self.assertEqual(result['state'], 'ok')
        self.assertIn('--all -p 1', result['cleanLog'])
        self.assertIn('三网,IPv6,OK', result['csv'])
        self.assertEqual(result['coverage']['state'], 'complete')
        self.assertEqual(result['coverage']['ok'], 2)
        self.assertEqual(result['reportUrl'], 'https://tcpquality.ibsgss.uk/r/test_ID')
        self.assertTrue((self.root / 'artifacts' / 'raw.log').is_file())

    def test_failed_upload_keeps_csv_and_is_partial(self):
        def entry(url, path, cancelled):
            path.write_text('#!/bin/bash\nprintf "hello" > "$TCPQUALITY_OUTPUT_DIR/zstatic_nping_test.csv"\nexit 0\n')
            return True
        popen = subprocess.Popen
        def fake_unshare(command, **kwargs):
            return popen(command[command.index('bash'):], **kwargs)
        with patch.object(full, '_download', side_effect=entry), patch.object(full, 'recover_report', return_value=''), patch.object(full.shutil, 'which', return_value='/usr/bin/tool'), patch.object(full.subprocess, 'Popen', side_effect=fake_unshare):
            result = full.run({'profile': 'FULL'}, self.root / 'artifacts', lock_path=self.lock)
        self.assertEqual(result['state'], 'partial')
        self.assertEqual(result['csv'], 'hello')
        self.assertTrue((self.root / 'artifacts' / 'zstatic_nping_test.csv').exists())

    def test_coverage_uses_real_csv_structure_without_counting_metadata(self):
        fixture = Path(__file__).parent / 'fixtures' / 'tcpquality-full-redacted.csv'
        result = full.coverage_from_csv(fixture.read_text(encoding='utf-8'),
                                         '[√] 检测到可用 IPv4\n[!] 未检测到可用 IPv6，已跳过 IPv6')
        self.assertEqual(result['state'], 'partial')
        self.assertEqual((result['total'], result['ok'], result['failed'], result['skipped'], result['unknown']), (5, 2, 1, 2, 0))
        self.assertEqual((result['ipv4'], result['ipv6']), ('available', 'unavailable'))
        self.assertEqual([(s['name'], s['total']) for s in result['sections']], [('三网', 1), ('IPv4大包', 1), ('国际互联', 2), ('三网单线程速度', 1)])

    def test_completed_report_with_missing_coverage_is_partial(self):
        fixture = (Path(__file__).parent / 'fixtures' / 'tcpquality-full-redacted.csv').read_text(encoding='utf-8')
        def entry(url, path, cancelled):
            path.write_text('#!/bin/bash\ncat > "$TCPQUALITY_OUTPUT_DIR/zstatic_nping_fixture.csv" <<\'END_CSV\'\n' + fixture +
                            '\nEND_CSV\necho 检测到可用 IPv4\necho 未检测到可用 IPv6\necho https://tcpquality.ibsgss.uk/r/test_ID\n')
            return True
        popen = subprocess.Popen
        def fake_unshare(command, **kwargs):
            return popen(command[command.index('bash'):], **kwargs)
        with patch.object(full, '_download', side_effect=entry), patch.object(full.shutil, 'which', return_value='/usr/bin/tool'), patch.object(full.subprocess, 'Popen', side_effect=fake_unshare):
            result = full.run({'profile': 'LOWMEM'}, self.root / 'artifacts', lock_path=self.lock)
        self.assertEqual(result['exitCode'], 0)
        self.assertEqual(result['state'], 'partial')
        self.assertEqual(result['coverage']['failed'], 1)
        self.assertEqual(result['coverage']['skipped'], 2)
        self.assertIn('报告已生成', result['diagnostic'])

    def test_coverage_never_converts_missing_unknown_or_truncated_data_to_success(self):
        both = '检测到可用 IPv4\n检测到可用 IPv6'
        valid = '网络,IP版本,状态\n三网,IPv4,OK\n三网,IPv6,OK\n'
        self.assertEqual(full.coverage_from_csv(valid, both)['state'], 'complete')
        self.assertEqual(full.coverage_from_csv(valid, both, truncated=True)['state'], 'unknown')
        self.assertEqual(full.coverage_from_csv('x,y\n1,2\n', both)['state'], 'unknown')
        self.assertEqual(full.coverage_from_csv('', both)['state'], 'unknown')
        self.assertEqual(full.coverage_from_csv(valid, '')['state'], 'unknown')
        unknown = full.coverage_from_csv(valid + '三网,IPv4,UNRECOGNIZED\n', both)
        self.assertEqual(unknown['unknown'], 1)
        self.assertEqual(unknown['state'], 'unknown')

    def test_cross_process_lock_refuses_overlap(self):
        with open(self.lock, 'a') as lock, patch.object(full.shutil, 'which', return_value='/usr/bin/tool'):
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = full.run({}, self.root / 'artifacts', lock_path=self.lock)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('正在运行', result['diagnostic'])

    def test_download_fallback_and_failure(self):
        with patch.object(full, '_download', return_value=False) as download, patch.object(full.shutil, 'which', return_value='/usr/bin/tool'):
            result = full.run({}, self.root / 'artifacts', lock_path=self.lock)
        self.assertEqual(download.call_count, 2)
        self.assertEqual(result['state'], 'failed')
        self.assertIn('备用入口', result['diagnostic'])

    def test_pid_preflight(self):
        (self.root / 'pids.max').write_text('40')
        (self.root / 'pids.current').write_text('38')
        self.assertIn('pids.current=38', full.resource_preflight(self.root, str(self.root)))
        (self.root / 'pids.current').write_text('20')
        self.assertEqual(full.resource_preflight(self.root, str(self.root)), '')

    def test_disk_preflight_accepts_either_upstream_temp_directory(self):
        sizes = {'/var/tmp': 512 * 1024 * 1024, '/tmp': 900 * 1024 * 1024}
        def statvfs(path):
            return SimpleNamespace(f_bavail=sizes[path], f_frsize=1)
        with patch.object(full.os.path, 'isdir', return_value=True), patch.object(full.os, 'access', return_value=True), patch.object(full.os, 'statvfs', side_effect=statvfs):
            self.assertEqual(full.resource_preflight(self.root, membership=self.root / 'absent'), '')
            sizes['/tmp'] = 400 * 1024 * 1024
            self.assertIn('最大 512 MiB', full.resource_preflight(self.root, membership=self.root / 'absent'))

    def test_limits(self):
        with self.assertRaises(ValueError):
            full.run({'timeoutMinutes': 151}, self.root / 'artifacts', lock_path=self.lock)
        text, truncated = full.trim('a' * (full.LIMIT + 1))
        self.assertTrue(truncated)
        self.assertIn('已截断', text)
        self.assertLessEqual(len(text), full.LIMIT)
        result = {'cleanLog': '测' * full.LIMIT, 'csv': '网' * full.LIMIT}
        full.fit_result(result)
        self.assertLessEqual(len(__import__('json').dumps({'id': '0' * 36, 'data': result}, separators=(',', ':')).encode('utf-8')), 950000)
        self.assertTrue(result['logTruncated'] or result['csvTruncated'])


if __name__ == '__main__':
    unittest.main()
