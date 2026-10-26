"""Public-speed failure paths; local fixtures only, never a real speed test."""
import errno
import http.client
import http.server
import json
import socket
import ssl
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import native
import public_speed as speed


class ReliabilityTests(unittest.TestCase):
    def setUp(self):
        speed._directory_cache.clear()
        speed.tls_context.cache_clear()
        self.runtime = SimpleNamespace(cancelled=lambda: False, integer=native.integer, tcp_info=lambda _: {})
        self.options = {"city": "上海", "carrier": "电信", "family": "6", "maxTrafficMiB": 16}
        self.endpoint = {"ip": "2001:4860:4860::8888", "port": 8080, "city": "上海", "carrier": "电信", "family": "6"}

    def serve(self, handler):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        self.addCleanup(worker.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def test_tls_context_is_verified_and_ca_loading_is_reused(self):
        original=ssl.create_default_context
        with patch.object(speed.ssl,'create_default_context',side_effect=original) as factory:
            first=speed.tls_context()
            self.assertIs(first,speed.tls_context())
            factory.assert_called_once()
            self.assertTrue(first.check_hostname)
            self.assertEqual(first.verify_mode,ssl.CERT_REQUIRED)

    def test_control_reads_connection_close_body_and_never_follows_redirects(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302 if self.path.startswith('/redirect') else int(self.path[1:]) if self.path[1:].isdigit() else 200)
                self.send_header('Content-Length', '100' if self.path == '/truncated' else '2')
                self.send_header('Location', 'http://127.0.0.1/private')
                self.end_headers()
                self.wfile.write(b'[]')
            def log_message(self, *_): pass
        server = self.serve(Handler)
        original = http.client.HTTPConnection
        with patch.object(speed.http.client, 'HTTPConnection', side_effect=lambda host, port, timeout: original('127.0.0.1', server.server_port, timeout=timeout)):
            self.assertEqual(speed.request('http://8.8.8.8/data'), '[]')
            with self.assertRaises(speed.ControlFailure) as caught:
                speed.request('http://8.8.8.8/redirect?key=PRIVATE_SESSION')
            for status,retryable in [(503,True),(429,True),(403,False)]:
                with self.assertRaises(speed.ControlFailure) as http_error:
                    speed.request('http://8.8.8.8/'+str(status))
                self.assertEqual(http_error.exception.retryable,retryable)
            with self.assertRaises(speed.ControlFailure) as truncated:
                speed.request('http://8.8.8.8/truncated')
            self.assertEqual(truncated.exception.stage,'response-body')
            self.assertTrue(truncated.exception.retryable)
        self.assertEqual(caught.exception.status, 302)
        self.assertFalse(caught.exception.retryable)
        self.assertNotIn('PRIVATE_SESSION', str(caught.exception))

    def test_tls_timeout_and_certificate_failure_have_distinct_retry_policy(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_): pass
        server = self.serve(Handler)
        original = http.client.HTTPConnection
        for error, retryable in [(TimeoutError('handshake timed out'), True), (ssl.SSLCertVerificationError(1, 'certificate invalid'), False)]:
            speed.tls_context.cache_clear()
            with self.subTest(retryable=retryable), patch.object(speed.http.client, 'HTTPConnection', side_effect=lambda host, port, timeout: original('127.0.0.1', server.server_port, timeout=timeout)), patch.object(speed.ssl, 'create_default_context') as context:
                context.return_value.wrap_socket.side_effect = error
                with self.assertRaises(speed.ControlFailure) as caught:
                    speed.request('https://8.8.8.8/data?key=PRIVATE_SESSION')
                self.assertEqual(caught.exception.stage, 'tls-handshake')
                self.assertEqual(caught.exception.retryable, retryable)
                self.assertNotIn('PRIVATE_SESSION', str(caught.exception))

    def test_control_header_and_body_timeouts_record_the_correct_phase(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path == '/headers': time.sleep(.2)
                self.send_response(200)
                self.send_header('Content-Length', '2')
                self.end_headers()
                self.wfile.flush()
                if self.path == '/body': time.sleep(.2)
                try: self.wfile.write(b'[]')
                except OSError: pass
            def log_message(self, *_): pass
        server = self.serve(Handler)
        original = http.client.HTTPConnection
        for path, phase in [('/headers', 'response-headers'), ('/body', 'response-body')]:
            with self.subTest(path=path), patch.object(speed, 'HEADER_TIMEOUT', .05), patch.object(speed, 'READ_TIMEOUT', .05), patch.object(speed.http.client, 'HTTPConnection', side_effect=lambda host, port, timeout: original('127.0.0.1', server.server_port, timeout=timeout)):
                with self.assertRaises(speed.ControlFailure) as caught: speed.request('http://8.8.8.8' + path)
                self.assertEqual(caught.exception.stage, phase)
                self.assertTrue(caught.exception.retryable)

    def test_directory_timeout_retries_once_and_is_retryable_without_payload(self):
        calls = []
        def fetch(url):
            calls.append(url)
            raise TimeoutError('The read operation timed out')
        with patch.object(speed, 'pause'):
            result = speed.measure(self.options, self.runtime, fetch)
        self.assertEqual(len(calls), 2)
        self.assertTrue(result['retryable'])
        self.assertEqual(result['failureStage'], 'directory-location.request')
        self.assertEqual(result['trafficBytesObserved'], 0)
        self.assertEqual(len(result['controlRequests']), 2)
        self.assertEqual(result['runs'], [])

    def test_directory_cache_expires_does_not_slide_and_separates_address_families(self):
        calls = []
        def fetch(url):
            calls.append(url)
            if 'getIpLoc' in url: return '1.1.1.1|[]'
            return json.dumps([{'hostip': self.endpoint['ip'] if 'ipv6=1' in url else '8.8.8.8', 'port':8080, 'city':'上海', 'hostname':'上海电信'}])
        with patch.object(speed.time, 'monotonic', return_value=100):
            first = speed.discover('上海','电信','6',fetch)
            first[0]['ip'] = 'mutated'
        with patch.object(speed.time, 'monotonic', return_value=200):
            self.assertEqual(speed.discover('上海','电信','6',fetch)[0]['ip'], self.endpoint['ip'])
            self.assertEqual(len(calls), 2)
            self.assertEqual(speed.discover('上海','电信','4',fetch)[0]['family'], '4')
            self.assertEqual(len(calls), 3)
        with patch.object(speed.time, 'monotonic', return_value=221):
            speed.discover('上海','电信','6',fetch)
            self.assertEqual(len(calls), 5)
        for i in range(50): speed.cache_put(('bounded', i), [i])
        self.assertLessEqual(len(speed._directory_cache), 32)

    def test_cancellation_and_total_budget_stop_further_control_requests(self):
        cancelled=threading.Event(); calls=[]
        runtime=SimpleNamespace(cancelled=cancelled.is_set,integer=native.integer)
        def fetch(url):
            calls.append(url); cancelled.set(); raise TimeoutError('timed out')
        result=speed.measure(self.options,runtime,fetch)
        self.assertEqual(len(calls),1)
        self.assertEqual(result['failureStage'],'cancelled')
        self.assertFalse(result['retryable'])
        calls.clear(); cancelled.clear()
        with patch.object(speed,'MEASUREMENT_TIMEOUT',0): result=speed.measure(self.options,runtime,fetch)
        self.assertEqual(calls,[])
        self.assertFalse(result['retryable'])

    def test_admission_failover_keeps_both_directions_on_the_selected_endpoint(self):
        other = {**self.endpoint, 'ip':'2001:4860:4860::8844'}
        selected = []
        def phase(server, session, direction, count, seconds, warmup, budget, runtime, deadline_limit):
            selected.append(server['ip'])
            return {'state':'ok','streams':count,'vpsDirection':direction,'trafficBytesObserved':0}
        with patch.object(speed, 'discover', return_value=[self.endpoint,other]), patch.object(speed, 'open_session', side_effect=[speed.ControlFailure('公共测速节点繁忙','session-admission',True),'PRIVATE']), patch.object(speed, 'transfer_phase', side_effect=phase), patch.object(speed, 'pause'):
            result = speed.measure(self.options,self.runtime,lambda *args:'')
        self.assertEqual(selected,[other['ip'],other['ip']])
        self.assertEqual(result['actualEndpoint']['ip'],other['ip'])
        self.assertEqual(result['candidateAttempts'],2)
        self.assertEqual(result['candidateFailures'][0]['stage'],'session-admission')
        self.assertNotIn('PRIVATE',json.dumps(result))

    def test_failed_download_only_is_retried_and_successful_upload_is_preserved(self):
        calls, successful_upload = [], {'state':'ok','streams':1,'vpsDirection':'upload','trafficBytesObserved':40,'bitsPerSecond':320}
        def phase(server, session, direction, count, seconds, warmup, budget, runtime, deadline_limit):
            calls.append(direction)
            if len(calls)==1:
                return {'state':'failed','retryable':True,'streams':count,'vpsDirection':direction,'trafficBytesObserved':0,'diagnostic':'timed out','failureStage':'response-headers'}
            size=40 if direction=='upload' else 60
            reserved=budget.reserve(size); budget.account(reserved,reserved)
            return successful_upload if direction=='upload' else {'state':'ok','streams':count,'vpsDirection':direction,'trafficBytesObserved':60}
        with patch.object(speed,'discover',return_value=[self.endpoint]), patch.object(speed,'open_session',return_value='key'), patch.object(speed,'transfer_phase',side_effect=phase), patch.object(speed,'pause'):
            result=speed.measure(self.options,self.runtime,lambda *args:'')
        self.assertEqual(calls,['download','upload','download'])
        self.assertIs(result['runs'][1],successful_upload)
        self.assertEqual(result['trafficBytesObserved'],100)
        self.assertEqual(result['remainingTrafficBytes'],16*1048576-100)
        self.assertEqual(len(result['runs'][0]['attempts']),2)
        self.assertEqual(result['state'],'ok')

    def test_transferred_payload_and_exhausted_budget_prevent_remeasurement(self):
        for used in [128,16*1048576]:
            calls=[]
            def phase(server,session,direction,count,seconds,warmup,budget,runtime,deadline_limit):
                calls.append(direction)
                reserved=budget.reserve(used); budget.account(reserved,reserved)
                return {'state':'failed','retryable':True,'streams':count,'vpsDirection':direction,'trafficBytesObserved':reserved,'diagnostic':'timed out'}
            with self.subTest(used=used), patch.object(speed,'discover',return_value=[self.endpoint]), patch.object(speed,'open_session',return_value='key'), patch.object(speed,'transfer_phase',side_effect=phase), patch.object(speed,'pause'):
                result=speed.measure(self.options,self.runtime,lambda *args:'')
                self.assertFalse(result['retryable'])
                self.assertEqual(len(calls),2 if used==128 else 1)
                self.assertLessEqual(result['trafficBytesObserved'],16*1048576)

    def test_delayed_headers_do_not_consume_the_measured_window(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                time.sleep(1.1)
                self.send_response(200)
                self.send_header('Content-Length','1048576')
                self.end_headers()
                try: self.wfile.write(b'x'*1048576)
                except OSError: pass
            def log_message(self,*_): pass
        server=self.serve(Handler)
        result=speed.transfer_phase({'ip':'127.0.0.1','port':server.server_port},'key','download',1,.3,0,speed.Budget(65536),self.runtime)
        self.assertGreater(result['trafficBytesObserved'],0)
        self.assertGreaterEqual(result['setupSeconds'],1)
        self.assertLess(result['seconds'],.5)
        self.assertNotEqual(result['state'],'failed')

    def test_thread_limit_failure_releases_already_started_workers(self):
        original=threading.Thread.start
        started=[]
        def start(thread):
            if started: raise RuntimeError('cannot start thread')
            original(thread); started.append(thread)
        class Connection:
            def settimeout(self,*_): pass
            def sendall(self,*_): pass
            def close(self): pass
            def shutdown(self,*_): pass
        class Response:
            status=200
            def begin(self): pass
            def getheader(self,key,default=None): return default
        with patch.object(speed.socket,'create_connection',return_value=Connection()), patch.object(speed.http.client,'HTTPResponse',return_value=Response()), patch.object(threading.Thread,'start',start):
            with self.assertRaises(OSError) as caught:
                speed.transfer_phase(self.endpoint,'key','download',4,1,0,speed.Budget(65536),self.runtime)
        self.assertEqual(caught.exception.errno,errno.EAGAIN)
        self.assertTrue(started)
        self.assertFalse(any(thread.is_alive() for thread in started))

    def test_cancel_during_connect_waits_for_cleanup_without_sending_a_request(self):
        cancelled=threading.Event(); writes=[]; closed=[]
        class Connection:
            def settimeout(self,*_): pass
            def sendall(self,*_): writes.append(True)
            def close(self): closed.append(True)
            def shutdown(self,*_): pass
        def connect(*args,**kwargs):
            cancelled.set(); time.sleep(.15); return Connection()
        runtime=SimpleNamespace(cancelled=cancelled.is_set,tcp_info=lambda _: {})
        with patch.object(speed.socket,'create_connection',side_effect=connect):
            result=speed.transfer_phase(self.endpoint,'key','download',1,1,0,speed.Budget(65536),runtime)
        self.assertTrue(closed)
        self.assertEqual(writes,[])
        self.assertEqual(result['trafficBytesObserved'],0)
        self.assertFalse(result['retryable'])


if __name__=='__main__': unittest.main()
