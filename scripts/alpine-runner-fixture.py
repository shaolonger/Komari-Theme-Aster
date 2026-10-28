"""Real service checks inside disposable Alpine or a guarded GitHub systemd runner."""
import importlib.util
import fcntl
import json
import os
import pty
import select
import hashlib
import shutil
import tempfile
import zipfile
from types import SimpleNamespace
from pathlib import Path
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path("/usr/local/libexec/aster-network-observatory")
CONFIG = Path("/etc/aster-network-observatory")
NODE = "c388e74d-a922-4ae1-bd10-1fb30e2e53de"
PROBE = "9c9c6478-879e-40e4-8648-c71828337491"
OPENRC = os.environ.get("ASTER_TEST_SYSTEMD") != "1"
SERVICES = ["aster-network-observatory", "aster-network-observatory-probe-" + PROBE] if OPENRC else ["aster-network-observatory-agent.service", "aster-network-observatory-probe@" + PROBE + ".service"]


def service_command(name, action):
    return ["rc-service", name, action] if OPENRC else ["systemctl", action if action != "status" else "is-active", name]
TOKEN = "a" * 64
events = []
release = json.loads((ROOT / "release.json").read_text())
policies = {NODE: False, PROBE: False}
worker_status = {}
leases = {}
jobs = [{"id": "0f8cd9d8-9547-4c52-919b-c16305251457", "operation": "route", "target": "127.0.0.1", "options": {"fullMtr": True, "protocol": "tcp", "port": 25774, "family": "4", "packets": 5}}]


class Panel(BaseHTTPRequestHandler):
    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        assert self.headers.get("Authorization") == "Bearer " + TOKEN
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = json.loads(body) if body else {}
        events.append((self.path, payload))
        identity = self.path.split("/")[-2]
        response = {"ok": True}
        if self.path.endswith("/heartbeat"):
            worker_status[identity] = payload
        elif self.path.endswith("/update-policy"):
            response = {"release": release, "enabled": policies[identity], "busy": False, "version": worker_status.get(identity, {}).get("version", ""), "instanceId": worker_status.get(identity, {}).get("instanceId", "")}
        elif self.path.endswith("/maintenance") and payload.get("action") == "claim":
            leases[identity] = "b" * 32
            response = {"lease": leases[identity]}
        elif self.path.endswith("/maintenance") and payload.get("action") == "release":
            leases.pop(identity, None)
        elif f"/node/{NODE}/poll" in self.path and jobs and identity not in leases:
            response = {"task": jobs.pop(0)}
        result = json.dumps(response).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(result)))
        self.end_headers()
        self.wfile.write(result)

    def log_message(self, *_):
        pass


def wait_for(predicate, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.2)
    raise AssertionError("Timed out waiting for service integration condition")


def worker_pids():
    result = []
    for path in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            args = path.read_bytes().split(b"\0")
            if len(args) > 3 and args[0].endswith(b"python3") and str(ROOT / "agent.py").encode() in args and b"run" in args:
                result.append(int(path.parent.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return result


server = ThreadingHTTPServer(("127.0.0.1", 25774), Panel)
threading.Thread(target=server.serve_forever, daemon=True).start()
spec = importlib.util.spec_from_file_location("agent", ROOT / "agent.py")
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
assert agent.worker_capacity() == 1


def configure(probe="", reuse=False):
    with patch.object(agent.getpass, "getpass", return_value="" if reuse else TOKEN):
        agent.configure("http://127.0.0.1:25774", "" if probe else NODE, probe)


def interactive_upgrade():
    child, terminal = pty.fork()
    if child == 0:
        os.execvp("sh", ["sh", "/fixture/network-observatory/runner/quick-install.sh", "--profile", "lite", "--server-url", "http://127.0.0.1:25774", "--node-uuid", NODE])
    transcript = b""
    answered = False
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if select.select([terminal], [], [], 0.2)[0]:
                try:
                    chunk = os.read(terminal, 8192)
                except OSError:
                    break  # Linux PTY signals EIO after its slave closes.
                if not chunk:
                    break
                transcript += chunk
                if not answered and "探测器密钥（已有配置可回车保留）:".encode() in transcript:
                    os.write(terminal, b"\n")
                    answered = True
        else:
            os.kill(child, signal.SIGKILL)
            raise AssertionError("Interactive installer did not finish")
        _, status = os.waitpid(child, 0)
        assert answered and os.waitstatus_to_exitcode(status) == 0, transcript.decode(errors="replace")
    finally:
        os.close(terminal)


configure()
wait_for(lambda: any(path.endswith("/poll") for path, _ in events))
wait_for(lambda: any(path.endswith("/result") for path, _ in events))
measured = next(body["data"] for path, body in events if path.endswith("/result"))
assert measured.get("method") == "MTR" and measured.get("complete"), measured
assert measured.get("quality", {}).get("sent") == 5, measured
assert len(worker_pids()) == 1
pid = worker_pids()[0]
status = Path(f"/proc/{pid}/status").read_text()
caps = int(next(line.split()[1] for line in status.splitlines() if line.startswith("CapEff:")), 16)
assert caps == 1 << 13, f"Expected CAP_NET_RAW only, got {caps:x}"
assert "NoNewPrivs:\t1" in status
print("Worker started with CAP_NET_RAW only; " + next(line for line in status.splitlines() if line.startswith("VmRSS:")))

# Restarting the independent OpenRC maintenance service must not make the
# live unprivileged worker lose access to its durable result outbox.
if shutil.which("rc-service") and not Path("/run/systemd/system").exists():
    import grp
    import pwd
    subprocess.run(["rc-service", "aster-network-observatory-update", "restart"], check=True)
    child = os.fork()
    if child == 0:
        try:
            os.setgid(grp.getgrnam("aster-netobs").gr_gid)
            os.setuid(pwd.getpwnam("aster-netobs").pw_uid)
            path = Path("/var/lib/aster-network-observatory") / ("node-" + NODE)
            os.listdir(path)
            os._exit(0)
        except OSError:
            os._exit(1)
    _, exit_status = os.waitpid(child, 0)
    assert os.waitstatus_to_exitcode(exit_status) == 0, "maintenance restart denied outbox access"

# Reinstallation leaves credentials intact, then configure verifies and reuses them.
original = (CONFIG / "agent.json").read_bytes()
subprocess.run(["sh", "/fixture/network-observatory/runner/quick-install.sh", "--profile", "lite"], check=True)
assert (CONFIG / "agent.json").read_bytes() == original
interactive_upgrade()
wait_for(lambda: len(worker_pids()) == 1 and pid not in worker_pids())
assert (CONFIG / "agent.json").read_bytes() == original

configure(PROBE)
wait_for(lambda: len(worker_pids()) == 2)
assert (CONFIG / "agent.json").read_bytes() == original
assert (CONFIG / f"probe-{PROBE}.json").stat().st_mode & 0o777 == 0o640
for name in SERVICES:
    if OPENRC:
        assert (Path("/etc/runlevels/default") / name).is_symlink()
    else:
        subprocess.run(["systemctl", "is-enabled", name], check=True)
    subprocess.run(service_command(name, "status"), check=True)
if OPENRC:
    assert not (Path("/etc/runlevels/default") / "aster-network-observatory-http").exists()
else:
    subprocess.run(["systemctl", "start", "aster-network-observatory-update.service"], check=True)

# OpenRC's supervisor must recover a crashed worker without manual intervention.
before = set(worker_pids())
os.kill(next(iter(before)), signal.SIGKILL)
wait_for(lambda: len(worker_pids()) == 2 and set(worker_pids()) != before, timeout=25)

# Real idle transaction and rollback on the same 128 MiB OpenRC host.
updater_spec = importlib.util.spec_from_file_location("updater", ROOT / "updater.py")
updater = importlib.util.module_from_spec(updater_spec)
updater_spec.loader.exec_module(updater)
archive = Path("/fixture") / release["archive"]
creds_before = {path: path.read_bytes() for path in [CONFIG / "agent.json", CONFIG / f"probe-{PROBE}.json", CONFIG / "install-profile"]}
args = SimpleNamespace(command="auto", server_url="", node_uuid=NODE, probe_id="", profile="preserve")
def local_download(url, destination, _limit):
    shutil.copyfile(Path(str(archive) + ".sha256") if url.endswith(".sha256") else archive, destination)


def run_upgrade(arguments):
    # Match updater.main(): an OpenRC start_pre recovery child must observe
    # the active transaction lock instead of rolling back this healthy upgrade.
    with open(updater.STATE / "upgrade.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        updater.perform(arguments)


with patch.object(updater, "download", side_effect=AssertionError("Disabled auto-updater attempted download")):
    run_upgrade(args)
# The transaction tests below control each invocation and download explicitly.
# A randomized OpenRC minute must not launch another process outside those mocks.
maintenance = "aster-network-observatory-update" if OPENRC else "aster-network-observatory-update.timer"
if OPENRC:
    minute = int(Path("/var/lib/aster-network-observatory/update-minute").read_text().strip())
    assert 0 <= minute < 60
    assert (CONFIG / "cron/root").read_text().startswith(f"{minute} * * * * ")
subprocess.run(service_command(maintenance, "stop"), check=True)
policies[NODE] = policies[PROBE] = True
source = (ROOT / "agent.py").read_text()
current_declaration = f'RUNNER_VERSION = "{release["version"]}"'
assert source.count(current_declaration) == 1, "Installed runner and release metadata versions differ"
(ROOT / "agent.py").write_text(source.replace(current_declaration, 'RUNNER_VERSION = "1.9.2"', 1))
for name in SERVICES:
    subprocess.run(service_command(name, "restart"), check=True)
wait_for(lambda: all(worker_status.get(id, {}).get("version") == "1.9.2" for id in [NODE, PROBE]))
with patch.object(updater, "download", side_effect=local_download):
    run_upgrade(args)
assert (ROOT / "agent.py").read_text() == source
assert not leases
for path, content in creds_before.items():
    assert path.read_bytes() == content

# An enabled privileged helper must be stopped and disabled even when the
# replacement agent cannot start and the old worker services are restored.
helper = "aster-network-observatory-tcpquality" if OPENRC else "aster-network-observatory-tcpquality.service"
if OPENRC:
    subprocess.run(["rc-update", "add", helper, "default"], check=True)
    subprocess.run(["rc-service", helper, "start"], check=True)
else:
    subprocess.run(["systemctl", "enable", "--now", helper], check=True)
assert subprocess.run(service_command(helper, "status"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

with tempfile.TemporaryDirectory() as temporary:
    broken = Path(temporary) / "broken.zip"
    with zipfile.ZipFile(archive) as original_zip, zipfile.ZipFile(broken, "w") as result:
        for entry in original_zip.infolist():
            content = original_zip.read(entry)
            if entry.filename == "runner/agent.py":
                content = content.replace(b'if __name__ == "__main__":', b'if len(sys.argv) > 1 and sys.argv[1] == "run":\n    raise SystemExit(7)\n\nif __name__ == "__main__":')
            result.writestr(entry.filename, content)
    bad_checksum = Path(temporary) / "sha256"
    bad_checksum.write_text(hashlib.sha256(broken.read_bytes()).hexdigest() + "  " + release["archive"] + "\n")
    def broken_download(url, destination, _limit):
        shutil.copyfile(bad_checksum if url.endswith(".sha256") else broken, destination)
    args.command = "manual"
    with patch.object(updater, "download", side_effect=broken_download), patch.object(updater, "HEALTH_SECONDS", 0):
        try:
            run_upgrade(args)
            raise AssertionError("Broken worker passed upgrade health checks")
        except RuntimeError as error:
            assert "心跳" in str(error)
    assert (ROOT / "agent.py").read_text() == source
    for path, content in creds_before.items():
        assert path.read_bytes() == content
    wait_for(lambda: len(worker_pids()) == 2)
    assert subprocess.run(service_command(helper, "status"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode != 0
    if OPENRC:
        assert not (Path("/etc/runlevels/default") / helper).exists()
    else:
        assert subprocess.run(["systemctl", "is-enabled", "--quiet", helper]).returncode != 0
if OPENRC:
    assert (Path("/etc/runlevels/default") / "aster-network-observatory-update").is_symlink()
else:
    subprocess.run(["systemctl", "is-enabled", "aster-network-observatory-update.timer"], check=True)
assert not (Path("/var/lib/aster-network-observatory") / "upgrade-transaction.json").exists()
print("Real automatic upgrade and failed-start rollback preserved both credentials and lite profile.")
for name in SERVICES:
    subprocess.run(service_command(name, "stop"), check=True, timeout=42)
wait_for(lambda: not worker_pids())

# SIGTERM also cancels a detached measurement process group, not just the worker.
cancel_code = '''
import sys, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import agent
def task(*args):
    with agent.native.task_context("c388e74d-a922-4ae1-bd10-1fb30e2e53de"):
        agent.native.execute([sys.executable, "-c", "import time; time.sleep(120)", "aster-cancel-child"], 130)
agent.native_task = task
agent.flush_results = lambda *_: None
agent.heartbeat = lambda *_: None
agent.api_request = lambda *_: {"task": {"id": "c388e74d-a922-4ae1-bd10-1fb30e2e53de", "operation": "route"}}
raise SystemExit(agent.main())
'''
cancel_path = ROOT / "cancel-fixture.py"
cancel_path.write_text(cancel_code)
process = subprocess.Popen(["python3", str(cancel_path), "run", "--config", str(CONFIG / "agent.json")])


def children():
    found = []
    for path in Path("/proc").glob("[0-9]*/cmdline"):
        try:
            if b"aster-cancel-child\0" in path.read_bytes():
                found.append(path)
        except (FileNotFoundError, ProcessLookupError):
            pass
    return found


wait_for(children)
process.terminate()
assert process.wait(timeout=8) == 0
wait_for(lambda: not children(), timeout=5)
assert any(path.endswith("/heartbeat") and body.get("version") == agent.RUNNER_VERSION for path, body in events)
server.shutdown()
print("Verified install, poll, raw sockets, upgrade, credential reuse, node/probe coexistence, runlevel, respawn and SIGTERM cancellation.")
