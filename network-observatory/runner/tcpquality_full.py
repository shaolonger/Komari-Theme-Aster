"""Full TcpQuality execution primitives, for use only by a privileged helper.

The probe's sandbox deliberately lacks the mount privileges required by the
upstream rootfs.  This module must not be advertised until an isolated helper
has been installed and tested on the node's init system.
"""
import fcntl
import csv
import io
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PRIMARY = 'https://tcpquality.ibsgss.uk/run'
FALLBACK = 'https://raw.githubusercontent.com/ibsgss/TcpQuality/main/runTcpQuality.sh'
REPORT_API = 'https://tcpquality.ibsgss.uk/generate'
REPORT_URL = re.compile(r'https://tcpquality\.ibsgss\.uk/r/[A-Za-z0-9_-]+')
ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]')
LIMIT = 400000


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def controller_paths(controller, root=Path('/sys/fs/cgroup'), membership='/proc/self/cgroup'):
    """Visible v1/v2 leaf and parents, including controller roots.

    The kernel may expose host-wide /proc/meminfo inside a limited container.
    Limits can also be imposed by a parent while the leaf itself says `max`.
    Ignore paths that would escape the controller's mount.
    """
    root = Path(root)
    bases = [root, root / controller]
    result = []
    try:
        lines = Path(membership).read_text().splitlines()
    except OSError:
        lines = []
    for line in lines:
        fields = line.split(':', 2)
        if len(fields) != 3:
            continue
        _, controllers, relative = fields
        if not relative.startswith('/') or any(part in ('.', '..') for part in relative.split('/')):
            continue
        if not controllers:
            base = root
        elif controller in controllers.split(','):
            base = root / controller
        else:
            continue
        current = base.joinpath(*filter(None, relative.split('/')))
        while True:
            if current not in result:
                result.append(current)
            if current == base:
                break
            current = current.parent
    for base in bases:
        if base not in result:
            result.append(base)
    return result


def finite_limit(path):
    try:
        value = path.read_text().strip()
        if not value.isdigit():
            return None
        amount = int(value)
        # cgroup v1 commonly uses LONG_MAX rounded down for unlimited.
        return amount if amount < 1 << 60 else None
    except OSError:
        return None


def profile_for(requested, meminfo='/proc/meminfo', cgroup=Path('/sys/fs/cgroup'), membership='/proc/self/cgroup'):
    if requested not in ('AUTO', 'FULL', 'LOWMEM'):
        raise ValueError('运行档位无效')
    if requested != 'AUTO':
        return requested
    values = {}
    try:
        for line in Path(meminfo).read_text().splitlines():
            m = re.match(r'^(MemTotal|SwapTotal):\s*(\d+)\s+kB', line)
            if m:
                values[m[1]] = int(m[2])
    except OSError:
        pass
    memory, swap = values.get('MemTotal'), values.get('SwapTotal', 0)
    for directory in controller_paths('memory', cgroup, membership):
        v2_memory = finite_limit(directory / 'memory.max')
        v1_memory = finite_limit(directory / 'memory.limit_in_bytes')
        memsw = finite_limit(directory / 'memory.memsw.limit_in_bytes')
        for limit in (v2_memory, v1_memory, memsw):
            if limit is not None:
                limit_kb = limit // 1024
                memory = min(memory, limit_kb) if memory is not None else limit_kb
        v2_swap = finite_limit(directory / 'memory.swap.max')
        if v2_swap is not None:
            swap = min(swap, v2_swap // 1024)
        if memsw is not None:
            # v1 memsw is a combined memory+swap limit. If memory itself is
            # unlimited, memsw caps memory too, leaving no guaranteed swap.
            cap = min(v1_memory, memsw) if v1_memory is not None else memsw
            swap = min(swap, max(0, memsw - cap) // 1024)
    return 'LOWMEM' if memory is not None and (memory < 196608 or memory < 262144 and swap < 131072) else 'FULL'


def trim(text):
    if len(text) <= LIMIT:
        return text, False
    marker = '\n[内容过长，已截断；原文件保留在 VPS]\n'
    return text[:LIMIT - len(marker)] + marker, True


def coverage_from_csv(text, log, truncated=False):
    """Summarize upstream observations without inventing missing coverage.

    An exit code/report URL only confirms that the report was generated. The
    CSV records individual targets and may explicitly contain failed/skipped
    tests. Configuration rows are metadata, not measurement results.
    """
    totals = {'ok': 0, 'failed': 0, 'skipped': 0, 'unknown': 0, 'total': 0}
    result = {'state': 'unknown', **totals, 'ipv4': 'unknown', 'ipv6': 'unknown', 'sections': []}
    for family in ('4', '6'):
        if re.search(r'未检测到可用\s*IPv' + family, log, re.I):
            result['ipv' + family] = 'unavailable'
        elif re.search(r'检测到可用\s*IPv' + family, log, re.I):
            result['ipv' + family] = 'available'
    if not text:
        return result
    try:
        reader = csv.reader(io.StringIO(text.lstrip('\ufeff')))
        headers = next(reader, [])
        if '网络' not in headers or '状态' not in headers:
            return result
        group_at, status_at = headers.index('网络'), headers.index('状态')
        groups = {}
        for row in reader:
            if not row or not any(cell.strip() for cell in row):
                continue
            name = row[group_at].strip() if len(row) > group_at else ''
            status = row[status_at].strip().upper() if len(row) > status_at else ''
            if name == '网络' and status == '状态':
                continue
            if name in ('三网单线程配置',):
                continue
            name = name[:40] or '未分类'
            if name not in groups and len(groups) >= 20:
                name = '其他'
            group = groups.setdefault(name, {'name': name, **totals})
            key = {'OK': 'ok', 'FAIL': 'failed', 'SKIP': 'skipped'}.get(status, 'unknown')
            result[key] += 1
            result['total'] += 1
            group[key] += 1
            group['total'] += 1
        result['sections'] = list(groups.values())
    except (csv.Error, ValueError):
        return result
    if result['total'] and not truncated and not result['unknown']:
        if result['failed'] or result['skipped'] or 'unavailable' in (result['ipv4'], result['ipv6']):
            result['state'] = 'partial'
        elif 'unknown' not in (result['ipv4'], result['ipv6']):
            result['state'] = 'complete'
    return result


def fit_result(result, budget=950000):
    """Bound the actual JSON request size, including ensure_ascii expansion."""
    def size():
        return len(json.dumps({"id": "0" * 36, "data": result}, separators=(",", ":")).encode("utf-8"))
    marker = "\n[内容过长，已截断；原文件保留在 VPS]\n"
    while size() > budget:
        field = max(("cleanLog", "csv"), key=lambda k: len(json.dumps(result[k])))
        value = result[field]
        if not value:
            raise ValueError("报告元数据超出回传限制")
        if value.endswith(marker):
            value = value[:-len(marker)]
        # Halving bounds the number of serializations and leaves headroom for metadata.
        result[field] = value[:len(value) // 2] + marker
        result["logTruncated" if field == "cleanLog" else "csvTruncated"] = True
    return result


def run_bounded(command, timeout, cancelled):
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    deadline = time.monotonic() + timeout
    while True:
        if cancelled() or time.monotonic() >= deadline:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.communicate()
            raise subprocess.TimeoutExpired(command, timeout)
        try:
            out, err = process.communicate(timeout=0.25)
            return subprocess.CompletedProcess(command, process.returncode, out, err)
        except subprocess.TimeoutExpired:
            pass


def _download(url, destination, cancelled=lambda: False):
    # Use the same transfer, fallback and shebang checks as tcpquality-auto.
    try:
        result = run_bounded(['curl', '-fsSL', '--retry', '3', '--retry-delay', '2',
                              '--connect-timeout', '15', '--max-time', '120', url,
                              '-o', str(destination)], 150, cancelled)
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode or not destination.is_file() or destination.stat().st_size > 2 * 1024 * 1024:
        return False
    with destination.open('rb') as stream:
        return bool(re.match(rb'^#!.*(?:bash|sh)', stream.readline(1024)))


def recover_report(csv_path, clean_log, cancelled=lambda: False):
    if not csv_path or not csv_path.is_file():
        return ''
    found = re.findall(r'报告时间：\s*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d CST)', clean_log)
    with tempfile.NamedTemporaryFile() as response:
        for family in ('ipv4', 'auto'):
            for attempt in range(2):
                args = ['curl', '--silent', '--show-error', '--connect-timeout', '15', '--max-time', '90',
                        '-o', response.name, '-w', '%{http_code}', '-H', 'Content-Type: text/csv; charset=utf-8']
                if family == 'ipv4':
                    args.insert(1, '-4')
                if found:
                    args.extend(['-H', 'X-Report-Time: ' + found[-1]])
                args.extend(['--data-binary', '@' + str(csv_path), REPORT_API])
                try:
                    run = run_bounded(args, 95, cancelled)
                    status = run.stdout.decode('ascii', 'replace')
                    if run.returncode == 0 and status.startswith('2'):
                        payload = json.loads(Path(response.name).read_text())
                        url = payload.get('url', '')
                        if isinstance(url, str) and REPORT_URL.fullmatch(url):
                            return url
                    if status.isdigit() and 400 <= int(status) < 500 and status not in ('408', '429'):
                        return ''
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass
                if cancelled():
                    return ''
                if attempt == 0:
                    for _ in range(10):
                        if cancelled():
                            return ''
                        time.sleep(.5)
    return ''


def resource_preflight(cgroup=Path('/sys/fs/cgroup'), tempdir=None, membership='/proc/self/cgroup'):
    """Reject only clearly insufficient resource budgets; not a success guarantee."""
    for directory in controller_paths('pids', cgroup, membership):
        try:
            limit = (directory / 'pids.max').read_text().strip()
            current = int((directory / 'pids.current').read_text().strip())
            if limit != 'max' and int(limit) - current < 8:
                return f'进程/线程余量不足：pids.current={current}，pids.max={limit}；请至少预留 8 个名额并检查容器父级限制'
        except (OSError, ValueError):
            pass
    # The upstream rootfs selects the first sufficiently spacious writable
    # directory from /var/tmp and /tmp; those can be different filesystems.
    candidates = (tempdir,) if tempdir is not None else ('/var/tmp', '/tmp')
    free_values = []
    for path in candidates:
        try:
            if not os.path.isdir(path) or not os.access(path, os.W_OK):
                continue
            stats = os.statvfs(path)
            free_values.append(stats.f_bavail * stats.f_frsize)
        except OSError:
            pass
    if free_values and max(free_values) < 700 * 1024 * 1024:
        return f'临时目录可用空间不足（最大 {max(free_values) // (1024 * 1024)} MiB）；按当前上游 rootfs 预留至少 700 MiB，标准可能随上游变更'
    return ''


def run(options, artifact_dir, cancelled=lambda: False, lock_path='/run/tcpquality-auto.lock'):
    """Run fixed upstream --all with bounded options. Caller must isolate privileges.

    `artifact_dir` must be a private, task-specific, root-owned directory. CSV
    and full output stay on disk even if reporting fails or output is truncated.
    """
    requested = options.get('profile', 'AUTO')
    actual = profile_for(requested)
    minutes = options.get('timeoutMinutes', 120)
    if type(minutes) is not int or not 30 <= minutes <= 150:
        raise ValueError('最长运行时间应为 30 至 150 分钟')
    directory = Path(artifact_dir)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    result = {'kind': 'tcpquality-full', 'state': 'failed', 'profile': actual,
              'startedAt': timestamp(), 'completedAt': '', 'exitCode': None,
              'reportUrl': '', 'diagnostic': '', 'cleanLog': '', 'csv': ''}
    preflight = resource_preflight()
    if preflight:
        result.update(diagnostic=preflight, completedAt=timestamp())
        return result
    if not all(shutil.which(x) for x in ('bash', 'curl', 'unshare')):
        result.update(diagnostic='缺少 bash、curl 或 unshare；请安装完整 TcpQuality 执行依赖', completedAt=timestamp())
        return result
    with open(lock_path, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            result.update(diagnostic='已有 TcpQuality 测试正在运行，本次未执行', completedAt=timestamp())
            return result
        entry, log = directory / 'entry.sh', directory / 'raw.log'
        source = next((url for url in (PRIMARY, FALLBACK) if not cancelled() and _download(url, entry, cancelled)), None)
        if not source:
            result.update(diagnostic='检测已取消' if cancelled() else 'TcpQuality 主入口和备用入口下载失败', completedAt=timestamp())
            return result
        # Do not pass service environment overrides that could redirect root-executed upstream code.
        env = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
               'HOME': '/root', 'TERM': 'xterm', 'MALLOC_ARENA_MAX': '2',
               'TCPQUALITY_OUTPUT_DIR': str(directory)}
        # Mounts remain private even if the helper or upstream receives SIGKILL.
        command = ['unshare', '--mount', '--propagation', 'private', 'bash', str(entry), '--all'] + (['-p', '1'] if actual == 'LOWMEM' else [])
        # Like tcpquality-auto's renice, lower CPU priority when supported.
        if shutil.which('nice'):
            command = ['nice', '-n', '10'] + command
        timed_out = False
        cancelled_job = False
        with log.open('wb') as output:
            process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT, env=env, start_new_session=True, pass_fds=(lock.fileno(),))
            deadline = time.monotonic() + minutes * 60
            while process.poll() is None:
                if cancelled() or time.monotonic() >= deadline:
                    cancelled_job, timed_out = bool(cancelled()), time.monotonic() >= deadline
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
                time.sleep(0.5)
        result['exitCode'] = process.returncode
        # Avoid unbounded memory consumption on small VPSs. Full raw log stays on disk.
        with log.open('rb') as stream:
            head = stream.read(1024 * 1024)
            if log.stat().st_size > 2 * 1024 * 1024:
                stream.seek(-1024 * 1024, os.SEEK_END)
                raw = head + b'\n[...log truncated...]\n' + stream.read(1024 * 1024)
            else:
                raw = head + stream.read(1024 * 1024)
            clean = ANSI.sub('', raw.decode('utf-8', 'replace')).replace('\r', '\n')
        result['cleanLog'], result['logTruncated'] = trim(clean)
        result['logTruncated'] = result['logTruncated'] or log.stat().st_size > 2 * 1024 * 1024
        files = sorted(directory.glob('zstatic_nping_*.csv'), key=lambda f: f.stat().st_mtime, reverse=True)
        csv_path = files[0] if files else None
        csv_text = ''
        csv_incomplete = False
        if csv_path:
            with csv_path.open('rb') as stream:
                csv_text = stream.read(2 * 1024 * 1024).decode('utf-8', 'replace')
            csv_incomplete = csv_path.stat().st_size > 2 * 1024 * 1024
            result['csv'], result['csvTruncated'] = trim(csv_text)
            result['csvTruncated'] = result['csvTruncated'] or csv_incomplete
        result['coverage'] = coverage_from_csv(csv_text, clean, csv_incomplete)
        urls = REPORT_URL.findall(clean)
        result['reportUrl'] = urls[-1] if urls else ''
        if not result['reportUrl'] and csv_path and not (timed_out or cancelled_job):
            result['reportUrl'] = recover_report(csv_path, clean, cancelled)
        if timed_out or cancelled_job:
            result['diagnostic'] = '检测已取消' if cancelled_job else '检测超时'
        elif process.returncode == 0 and result['reportUrl']:
            if result['coverage']['state'] == 'complete':
                result['state'] = 'ok'
            else:
                result['state'] = 'partial'
                result['diagnostic'] = ('报告已生成，部分测量失败或跳过' if result['coverage']['state'] == 'partial'
                                        else '报告已生成，但测量覆盖无法完整确认')
        elif process.returncode == 0 or result['reportUrl'] or csv_path:
            result['state'] = 'partial'
            result['diagnostic'] = ('检测未完整成功；已保留原始记录' if process.returncode else
                                    '在线报告上传失败；已保留 CSV' if csv_path else '未生成可用的在线报告或 CSV')
        else:
            result['diagnostic'] = 'TcpQuality 执行失败，请查看日志及系统权限（容器需要允许创建 mount 命名空间）'
        result['completedAt'] = timestamp()
        result['entrySource'] = 'primary' if source == PRIMARY else 'fallback'
        return fit_result(result)
