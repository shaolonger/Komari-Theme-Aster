import base64
import io
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import nodequality_full as nq


class NodeQualityTests(unittest.TestCase):
    def test_archive_keeps_only_selected_safe_entries(self):
        with tempfile.TemporaryDirectory() as temp:
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, 'w') as archive:
                archive.writestr('ip_quality.json', '{"ok":true}')
                archive.writestr('header_info.log', 'header')
                archive.writestr('../untrusted', 'ignored')
                archive.writestr('net_quality.log', 'network')
            encoded = Path(temp) / 'result.b64'
            encoded.write_bytes(base64.b64encode(buffer.getvalue()))
            data, truncated = nq.read_archive(encoded, ['ip_quality'])
            self.assertEqual(data, {'ip_quality.json': '{"ok":true}', 'header_info.log': 'header'})
            self.assertFalse(truncated)
            self.assertTrue((Path(temp) / 'result.zip').exists())

    def test_input_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            for options in ({'checks': []}, {'checks': ['../../bad']}, {'family': 'bad'}, {'timeoutMinutes': 181}, {'hardwareMode': 'bad'}, {'networkMode': 'bad'}):
                with self.assertRaises(ValueError):
                    nq.run(options, temp)

    def test_full_execution_accepts_upstream_cleanup_exit_one(self):
        with tempfile.TemporaryDirectory() as temp:
            def entry(url, path, cancelled):
                path.write_text('#!/bin/bash\nread -r a; read -r b; read -r c; read -r d\n'
                    'printf "%s,%s,%s,%s\\n" "$a" "$b" "$c" "$d"\n'
                    'echo https://nodequality.com/r/example12345\nexit 1\n')
                return True
            popen = subprocess.Popen
            def no_unshare(command, **kwargs):
                offset = command.index('bash')
                return popen(command[offset:], **kwargs)
            def archive(path, flags):
                return {f'{name}.json': '{}' for name in flags}, False
            real_which = nq.shutil.which
            with patch.object(nq.common, '_download', side_effect=entry), patch.object(nq.common, 'resource_preflight', return_value=''), patch.object(nq.shutil, 'which', side_effect=lambda x: '/usr/bin/unshare' if x == 'unshare' else real_which(x)), patch.object(nq.subprocess, 'Popen', side_effect=no_unshare), patch.object(nq, 'read_archive', side_effect=archive):
                result = nq.run({'checks':['hardware_quality','net_quality'], 'hardwareMode':'fast', 'networkMode':'low-data', 'family':'4'}, temp)
            self.assertEqual(result['state'], 'ok')
            self.assertEqual(result['exitCode'], 1)
            self.assertEqual(result['reportUrl'], 'https://nodequality.com/r/example12345')
            self.assertIn('f,n,l,n', result['cleanLog'])

    def test_missing_section_is_partial(self):
        with tempfile.TemporaryDirectory() as temp:
            def entry(url, path, cancelled):
                path.write_text('#!/bin/bash\necho https://nodequality.com/r/example12345\nexit 1\n')
                return True
            popen = subprocess.Popen
            def no_unshare(command, **kwargs):
                return popen(command[command.index('bash'):], **kwargs)
            real_which = nq.shutil.which
            with patch.object(nq.common, '_download', side_effect=entry), patch.object(nq.common, 'resource_preflight', return_value=''), patch.object(nq.shutil, 'which', side_effect=lambda x: '/usr/bin/unshare' if x == 'unshare' else real_which(x)), patch.object(nq.subprocess, 'Popen', side_effect=no_unshare), patch.object(nq, 'read_archive', return_value=({'ip_quality.log': 'an error only'}, False)):
                result = nq.run({'checks':['ip_quality']}, temp)
            self.assertEqual(result['state'], 'partial')
            self.assertIn('ip_quality', result['diagnostic'])


if __name__ == '__main__':
    unittest.main()
