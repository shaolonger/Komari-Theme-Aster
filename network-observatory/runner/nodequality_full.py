"""Run the upstream NodeQuality benchmark in a private mount namespace.

The helper supplies the only privileged entry point. Upstream scripts and
BenchOS remain separate downloads; their licences are not bundled here.
"""
import base64
import json
import os
import re
import shutil
import signal
import subprocess
import time
import zipfile
from pathlib import Path

import tcpquality_full as common

ENTRY = 'https://run.NodeQuality.com'
FALLBACK = 'https://raw.githubusercontent.com/LloydAsp/NodeQuality/a92fca6c0067df29ddd03fdc2fee6f3000f64545/NodeQuality.sh'
UPLOAD = 'https://api.nodequality.com/api/v1/record'
URL = re.compile(r'https://(?:www\.)?nodequality\.com/r/[A-Za-z0-9_-]{1,128}')
FIELDS = ('hardware_quality', 'ip_quality', 'net_quality', 'backroute_trace')


def _capture_wrapper(directory):
    """Preserve the exact archive which upstream posts before it deletes BenchOS."""
    curl = shutil.which('curl')
    if not curl or '\n' in curl or "'" in curl:
        raise ValueError('缺少可用的 curl')
    wrapper = directory / 'curl'
    wrapper.write_text("""#!/bin/sh
for arg do
  if [ "$arg" = 'https://api.nodequality.com/api/v1/record' ]; then
    head -c 16777217 > "$_ASTER_NODEQUALITY_ARCHIVE" || exit 1
    size=$(wc -c < "$_ASTER_NODEQUALITY_ARCHIVE") || exit 1
    if [ "$size" -gt 16777216 ]; then echo 'NodeQuality 归档超过 16 MiB' >&2; exit 1; fi
    exec '""" + curl + """' "$@" < "$_ASTER_NODEQUALITY_ARCHIVE"
  fi
done
exec '""" + curl + """' "$@"
""", encoding='utf-8')
    wrapper.chmod(0o700)


def read_archive(encoded, selected):
    """Read only fixed upstream names, with size and archive safety limits."""
    sections, truncated = {}, False
    if not encoded.is_file():
        return sections, truncated
    if encoded.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('NodeQuality 归档超过 16 MiB')
    try:
        raw = base64.b64decode(encoded.read_bytes(), validate=False)
        archive = encoded.with_suffix('.zip')
        archive.write_bytes(raw)
        archive.chmod(0o600)
        with zipfile.ZipFile(archive) as z:
            if len(z.infolist()) > 32:
                raise ValueError('NodeQuality 归档文件数量过多')
            for info in z.infolist():
                if info.filename not in ({f'{name}.{ext}' for name in FIELDS for ext in ('json', 'log')} | {'header_info.log', 'port.log'}):
                    continue
                name, ext = info.filename.rsplit('.', 1)
                if name not in selected and info.filename not in ('header_info.log', 'port.log'):
                    continue
                if info.file_size > 2 * 1024 * 1024:
                    truncated = True
                    continue
                if info.filename in sections or (info.external_attr >> 16) & 0o170000 == 0o120000:
                    raise ValueError('NodeQuality 归档包含不安全文件')
                text = z.read(info).decode('utf-8', 'replace')
                if len(text) > 60000:
                    text, truncated = text[:60000], True
                sections[info.filename] = text
    except (ValueError, zipfile.BadZipFile, OSError) as error:
        raise ValueError('无法读取 NodeQuality 原始归档：' + str(error)) from error
    return sections, truncated


def run(options, artifact_dir, cancelled=lambda: False):
    flags = options.get('checks', list(FIELDS))
    if not isinstance(flags, list) or not flags or len(set(flags)) != len(flags) or any(x not in FIELDS for x in flags):
        raise ValueError('请选择有效的 NodeQuality 检测项目')
    minutes = options.get('timeoutMinutes', 120)
    if type(minutes) is not int or not 30 <= minutes <= 180:
        raise ValueError('NodeQuality 超时时间应为 30 至 180 分钟')
    hardware_mode = options.get('hardwareMode', 'standard')
    network_mode = options.get('networkMode', 'standard')
    if hardware_mode not in ('standard', 'fast', 'deep') or network_mode not in ('standard', 'low-data'):
        raise ValueError('NodeQuality 检测模式无效')
    family = options.get('family', 'auto')
    if family not in ('4', '6', 'auto'):
        raise ValueError('NodeQuality 地址族无效')
    directory = Path(artifact_dir)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    result = {'kind': 'nodequality-full', 'state': 'failed', 'startedAt': common.timestamp(),
              'completedAt': '', 'exitCode': None, 'reportUrl': '', 'diagnostic': '',
              'cleanLog': '', 'sections': {}, 'checks': flags, 'family': family,
              'logTruncated': False, 'sectionsTruncated': False}
    if not all(shutil.which(tool) for tool in ('bash', 'curl', 'unshare', 'head', 'wc')):
        result.update(diagnostic='缺少 bash、curl、unshare、head 或 wc', completedAt=common.timestamp())
        return result
    stats = os.statvfs(directory)
    if stats.f_bavail * stats.f_frsize < 1536 * 1024 * 1024:
        result.update(diagnostic='NodeQuality 工作目录至少需要 1.5 GiB 可用空间', completedAt=common.timestamp())
        return result
    preflight = common.resource_preflight(tempdir=directory)
    if preflight:
        result.update(diagnostic=preflight, completedAt=common.timestamp())
        return result
    entry = directory / 'entry.sh'
    source = next((url for url in (ENTRY, FALLBACK) if not cancelled() and common._download(url, entry, cancelled)), None)
    if not source:
        result.update(diagnostic='检测已取消' if cancelled() else 'NodeQuality 入口下载失败', completedAt=common.timestamp())
        return result
    shim = directory / 'bin'
    shim.mkdir(mode=0o700, exist_ok=True)
    _capture_wrapper(shim)
    archive = directory / 'result.b64'
    env = {'PATH': str(shim) + ':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
           'HOME': '/root', 'TERM': 'xterm', '_ASTER_NODEQUALITY_ARCHIVE': str(archive)}
    command = ['unshare', '--mount', '--propagation', 'private', 'bash', str(entry), '-D', str(directory)]
    if family != 'auto':
        command.append('-' + family)
    if shutil.which('nice'):
        command = ['nice', '-n', '10'] + command
    answers_by_field = {'hardware_quality': {'standard':'y', 'fast':'f', 'deep':'v'}[hardware_mode],
                        'ip_quality': 'y', 'net_quality': {'standard':'y', 'low-data':'l'}[network_mode],
                        'backroute_trace': 'y'}
    answers = ''.join((answers_by_field[name] if name in flags else 'n') + '\n' for name in FIELDS).encode()
    log = directory / 'raw.log'
    timed_out = was_cancelled = False
    with log.open('wb') as output:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=output, stderr=subprocess.STDOUT,
                                   env=env, cwd=directory, start_new_session=True)
        try:
            process.stdin.write(answers)
            process.stdin.close()
        except BrokenPipeError:
            pass
        deadline = time.monotonic() + minutes * 60
        while process.poll() is None:
            if cancelled() or time.monotonic() >= deadline:
                was_cancelled, timed_out = bool(cancelled()), time.monotonic() >= deadline
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                break
            time.sleep(.5)
    result['exitCode'] = process.returncode
    with log.open('rb') as stream:
        head = stream.read(1024 * 1024)
        if log.stat().st_size > 2 * 1024 * 1024:
            stream.seek(-1024 * 1024, os.SEEK_END)
            raw = head + b'\n[...log truncated...]\n' + stream.read(1024 * 1024)
        else:
            raw = head + stream.read(1024 * 1024)
    clean = common.ANSI.sub('', raw.decode('utf-8', 'replace')).replace('\r', '\n')
    result['cleanLog'] = clean if len(clean) <= 100000 else clean[:50000] + '\n[...日志已截断...]\n' + clean[-49980:]
    result['logTruncated'] = len(clean) > 100000 or log.stat().st_size > 2 * 1024 * 1024
    urls = URL.findall(clean)
    result['reportUrl'] = urls[-1] if urls else ''
    try:
        result['sections'], result['sectionsTruncated'] = read_archive(archive, flags)
    except ValueError as error:
        result['diagnostic'] = str(error)
    missing = []
    for name in flags:
        try:
            payload = json.loads(result['sections'][name + '.json'])
            if not isinstance(payload, (dict, list)):
                raise ValueError('unexpected JSON')
        except (KeyError, ValueError, TypeError):
            missing.append(name)
    if was_cancelled or timed_out:
        result['diagnostic'] = '检测已取消' if was_cancelled else '检测超时'
    elif result['reportUrl'] and not missing and not result['sectionsTruncated']:
        # NodeQuality's cleanup currently exits 1 even after a successful run.
        result['state'] = 'ok'
    elif result['reportUrl'] or result['sections']:
        result['state'] = 'partial'
        result['diagnostic'] = result['diagnostic'] or ('未取得部分检测数据：' + ', '.join(missing) if missing else '检测数据不完整或上游报告上传失败')
    else:
        result['diagnostic'] = result['diagnostic'] or 'NodeQuality 未生成可用报告；请检查日志、挂载权限和上游服务'
    result['completedAt'] = common.timestamp()
    result['entrySource'] = 'primary' if source == ENTRY else 'fallback'
    while len(json.dumps({'id': '0' * 36, 'data': result}, separators=(',', ':')).encode()) > 950000:
        result['logTruncated'] = True
        if len(result['cleanLog']) > 1000:
            result['cleanLog'] = result['cleanLog'][:len(result['cleanLog']) // 2]
        elif result['sections']:
            key = max(result['sections'], key=lambda k: len(result['sections'][k]))
            result['sections'][key] = result['sections'][key][:len(result['sections'][key]) // 2]
            result['sectionsTruncated'] = True
        else:
            raise ValueError('NodeQuality 结果超过回传限制')
    return result
