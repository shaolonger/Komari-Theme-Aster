#!/usr/bin/env python3
"""Root-only, fixed-operation helper for complete TcpQuality reports.

It accepts no commands, paths, URLs or shell arguments from a worker. The
upstream project requires mount/chroot: each run is put in its own mount
namespace; worker services retain their existing capability restrictions.
"""
import json
import grp
import os
import pwd
import re
import socket
import signal
import shutil
import time
import stat
import struct
import sys
import tempfile
import threading
from pathlib import Path

import tcpquality_full

SOCKET_PATH = Path('/run/aster-network-observatory/tcpquality.sock')
STATE = Path('/var/lib/aster-network-observatory/tcpquality-full')
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', re.I)


def validate_private_state(state):
    """Reject old untrusted trees before privileged code opens any task file.

    Once the parent and state roots are owned by this service and not writable
    by the worker, the unprivileged worker cannot replace components during
    this check or while an upstream task is running.
    """
    parent_fd = os.open(state.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parent = os.fstat(parent_fd)
        if parent.st_uid != os.geteuid() or parent.st_mode & 0o022:
            raise ValueError('TcpQuality 状态父目录不可信，请人工检查')
        try:
            os.mkdir(state.name, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            pass
        state_fd = os.open(state.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            root = os.fstat(state_fd)
            if root.st_uid != os.geteuid() or root.st_mode & 0o077:
                raise ValueError('TcpQuality 状态目录权限不安全，请人工检查')
            def inspect(directory_fd):
                for name in os.listdir(directory_fd):
                    try:
                        child = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
                    except OSError as error:
                        raise ValueError('TcpQuality 旧状态包含不可信路径，请人工检查') from error
                    try:
                        info = os.fstat(child)
                        if info.st_uid != os.geteuid() or info.st_mode & 0o022:
                            raise ValueError('TcpQuality 旧状态权限不安全，请人工检查')
                        if stat.S_ISDIR(info.st_mode):
                            inspect(child)
                        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                            raise ValueError('TcpQuality 旧状态包含非普通文件或硬链接，请人工检查')
                        elif name == 'task.json' and info.st_size > 1100000:
                            raise ValueError('TcpQuality 旧任务记录超过大小限制，请人工检查')
                    finally:
                        os.close(child)
            inspect(state_fd)
        finally:
            os.close(state_fd)
    finally:
        os.close(parent_fd)


def atomic_json(path, data):
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False, encoding='utf8') as f:
        os.chmod(f.name, 0o600)
        json.dump(data, f, separators=(',', ':'))
        f.flush()
        os.fsync(f.fileno())
        name = f.name
    os.replace(name, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


class Manager:
    def __init__(self, state=STATE):
        self.state = Path(state)
        validate_private_state(self.state)
        self.lock = threading.Lock()
        self.events = {}
        self.threads = {}
        self.pending = {}
        self.upload_pending = set()
        self.recovery_cursor = 0
        self.shutdown_event = threading.Event()
        # A helper restart must not silently re-run an interrupted test.
        for directory in self.state.iterdir():
            if directory.is_dir() and UUID.fullmatch(directory.name):
                task = self._read(directory)
                if task and not task.get('acknowledged'):
                    self.pending[directory.name] = task.get('nodeUuid', '')
                if task and task.get('reportPending'):
                    self.upload_pending.add(directory.name)
                if task and task.get('state') == 'running':
                    task.update(state='complete', revision=1, data={'kind': 'tcpquality-full', 'state': 'failed',
                        'diagnostic': '执行器中断；原始文件已保留，请检查后重新执行',
                        'startedAt': task.get('startedAt', ''), 'completedAt': tcpquality_full.timestamp(),
                        'profile': task.get('options', {}).get('profile', 'AUTO'), 'exitCode': None,
                        'cleanLog': '', 'csv': '', 'reportUrl': ''})
                    atomic_json(directory / 'task.json', task)

    def _read(self, directory):
        try:
            fd = os.open(directory / 'task.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'r', encoding='utf8') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 1100000:
                    raise ValueError('TcpQuality 任务记录不安全')
                data = json.load(stream)
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def _finish(self, task_id, options, event):
        directory = self.state / task_id
        try:
            result = tcpquality_full.run(options, directory / 'artifacts', cancelled=event.is_set)
        except Exception as error:
            result = {'kind': 'tcpquality-full', 'state': 'failed', 'diagnostic': str(error)[:1000],
                      'profile': options.get('profile', 'AUTO'), 'exitCode': None, 'cleanLog': '',
                      'csv': '', 'reportUrl': '', 'startedAt': '', 'completedAt': tcpquality_full.timestamp()}
        with self.lock:
            task = self._read(directory)
            if task:
                task.update(state='complete', revision=1, data=result)
                if result.get('csv') and not result.get('reportUrl') and result.get('diagnostic') != '检测已取消':
                    task['reportPending'] = True
                    self.upload_pending.add(task_id)
                atomic_json(directory / 'task.json', task)
            self.events.pop(task_id, None)
            self.threads.pop(task_id, None)

    def request(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('无效请求')
        action = payload.get('action')
        with self.lock:
            if action == 'list':
                tasks = []
                for task_id in list(self.pending):
                    task = self._read(self.state / task_id)
                    if task and not task.get('acknowledged'):
                        tasks.append({k: task[k] for k in ('id', 'nodeUuid', 'state')})
                return {'tasks': tasks}
            task_id = payload.get('id', '')
            if not isinstance(task_id, str) or not UUID.fullmatch(task_id):
                raise ValueError('无效任务 ID')
            directory = self.state / task_id
            task = self._read(directory)
            if action == 'start':
                node = payload.get('nodeUuid', '')
                options = payload.get('options', {})
                if not isinstance(node, str) or not UUID.fullmatch(node) or not isinstance(options, dict):
                    raise ValueError('无效执行身份或参数')
                profile = options.get('profile', 'AUTO')
                minutes = options.get('timeoutMinutes', 120)
                if profile not in ('AUTO', 'FULL', 'LOWMEM') or type(minutes) is not int or not 30 <= minutes <= 150:
                    raise ValueError('无效运行档位或超时')
                options = {'profile': profile, 'timeoutMinutes': minutes}
                if task:
                    if task['nodeUuid'] != node or task['options'] != options:
                        raise ValueError('任务 ID 已用于不同参数')
                    return {'state': task['state']}
                if self.events:
                    raise ValueError('另一项完整 TcpQuality 测试正在运行')
                directory.mkdir(mode=0o700)
                task = {'id': task_id, 'nodeUuid': node, 'options': options, 'state': 'running',
                        'startedAt': tcpquality_full.timestamp(), 'acknowledged': False}
                atomic_json(directory / 'task.json', task)
                self.pending[task_id] = node
                event = threading.Event()
                self.events[task_id] = event
                worker = threading.Thread(target=self._finish, args=(task_id, options, event), daemon=True)
                self.threads[task_id] = worker
                worker.start()
                return {'state': 'running'}
            if not task:
                return {'state': 'missing'}
            if payload.get('nodeUuid') != task.get('nodeUuid'):
                raise ValueError('任务与节点身份不匹配')
            if action == 'status':
                return {'state': task['state'], **({'data': task['data'], 'revision': task.get('revision', 1)} if task['state'] == 'complete' else {})}
            if action == 'cancel':
                if task_id in self.events:
                    self.events[task_id].set()
                return {'state': task['state']}
            if action == 'ack':
                if task['state'] != 'complete':
                    raise ValueError('任务尚未完成')
                if type(payload.get('revision')) is not int or payload['revision'] != task.get('revision', 1):
                    raise ValueError('报告版本已变化，请重新回传')
                task['acknowledged'] = True
                data = task.get('data', {})
                # Complete copies are now durable on the panel. Keep truncated
                # originals and unuploaded CSVs for recovery and manual access.
                if not task.get('reportPending') and not data.get('logTruncated') and not data.get('csvTruncated'):
                    data['cleanLog'] = ''
                    data['csv'] = ''
                    atomic_json(directory / 'task.json', task)
                    shutil.rmtree(directory / 'artifacts', ignore_errors=True)
                else:
                    atomic_json(directory / 'task.json', task)
                self.pending.pop(task_id, None)
                return {'state': 'complete'}
            raise ValueError('不支持的操作')


    def retry_pending(self):
        """Retry up to two failed public uploads, preserving prior observations."""
        with self.lock:
            queue = sorted(self.upload_pending)
            if not queue:
                return
            start = self.recovery_cursor % len(queue)
            ids = (queue[start:] + queue[:start])[:2]
            self.recovery_cursor = (start + len(ids)) % len(queue)
        for task_id in ids:
            if self.shutdown_event.is_set():
                return
            directory = self.state / task_id
            with self.lock:
                task = self._read(directory)
                if not task or not task.get('reportPending'):
                    self.upload_pending.discard(task_id)
                    continue
                clean = task.get('data', {}).get('cleanLog', '')
            csv_files = sorted((directory / 'artifacts').glob('zstatic_nping_*.csv'), key=lambda p: p.stat().st_mtime, reverse=True)
            if not csv_files:
                continue  # Keep pending marker for an operator to investigate.
            url = tcpquality_full.recover_report(csv_files[0], clean, self.shutdown_event.is_set)
            if not url:
                continue
            with self.lock:
                task = self._read(directory)
                if not task or not task.get('reportPending'):
                    continue
                task['data']['reportUrl'] = url
                task['revision'] = task.get('revision', 1) + 1
                task['reportPending'] = False
                task['acknowledged'] = False
                atomic_json(directory / 'task.json', task)
                self.upload_pending.discard(task_id)
                self.pending[task_id] = task['nodeUuid']

    def recovery_loop(self):
        while not self.shutdown_event.wait(1800):
            self.retry_pending()

    def shutdown(self):
        self.shutdown_event.set()
        with self.lock:
            for event in self.events.values():
                event.set()
            threads = list(self.threads.values())
        for thread in threads:
            thread.join(timeout=38)


def serve():
    if os.geteuid() != 0 or not hasattr(socket, 'SO_PEERCRED'):
        raise SystemExit('完整 TcpQuality helper 仅支持 Linux root')
    worker = pwd.getpwnam('aster-netobs')
    group = grp.getgrnam('aster-netobs')
    if worker.pw_uid == 0 or group.gr_gid == 0 or worker.pw_gid != group.gr_gid:
        raise SystemExit('aster-netobs 必须使用非 root UID 和独立主组；拒绝启动特权执行器')
    SOCKET_PATH.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    directory = os.open(SOCKET_PATH.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchown(directory, 0, group.gr_gid)
        os.fchmod(directory, 0o750)
    finally:
        os.close(directory)
    if SOCKET_PATH.exists():
        if not stat.S_ISSOCK(SOCKET_PATH.lstat().st_mode):
            raise SystemExit('helper socket 路径被非 socket 占用')
        SOCKET_PATH.unlink()
    manager = Manager()
    recovery = threading.Thread(target=manager.recovery_loop, daemon=True)
    recovery.start()
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(str(SOCKET_PATH))
        os.chown(SOCKET_PATH, 0, group.gr_gid)
        os.chmod(SOCKET_PATH, 0o660)
        server.listen(4)
        server.settimeout(1)
        while not stopping.is_set():
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            with conn:
                conn.settimeout(10)
                try:
                    _, uid, _ = struct.unpack('3i', conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    if uid != worker.pw_uid:
                        raise ValueError('无权访问 helper')
                    data = b''
                    while b'\n' not in data and len(data) <= 4096:
                        part = conn.recv(4096)
                        if not part:
                            break
                        data += part
                    if len(data) > 4096 or not data.endswith(b'\n'):
                        raise ValueError('无效请求长度')
                    response = manager.request(json.loads(data))
                except (OSError, ValueError, KeyError, TypeError) as error:
                    response = {'error': str(error)[:500]}
                try:
                    conn.sendall(json.dumps(response, separators=(',', ':')).encode() + b'\n')
                except OSError:
                    pass
    manager.shutdown()
    recovery.join(timeout=4)
    SOCKET_PATH.unlink(missing_ok=True)


if __name__ == '__main__':
    serve()
