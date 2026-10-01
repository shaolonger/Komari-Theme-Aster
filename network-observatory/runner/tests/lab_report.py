import sys, json, time, socket, threading, ssl, tempfile, subprocess, os
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import native
from http_receiver import Receiver
from http.server import ThreadingHTTPServer
from types import SimpleNamespace

# Lab loopback is explicitly allowed only by these in-process test patches.
password='a'*64
listener=native.Listener(25213,password,lifetime=80)
try:
    data=native.benchmark('127.0.0.1',{'port':25213,'seconds':5,'warmupSeconds':2,'streams':[1,4],'family':'4','reportVersion':3},{'publicKey':listener.public_key,'password':password,'scheme':listener.scheme})
    print(json.dumps({'method':data['method'],'state':data['state'],'runs':[{'vpsDirection':r['vpsDirection'],'streams':r['streams'],'bitsPerSecond':r.get('bitsPerSecond'),'intervalSource':r.get('intervalSource'),'tcpRttMs':r.get('tcpRttMs'),'retransmits':r.get('retransmits'),'intervals':len(r.get('intervals',[]))} for r in data['runs']]}),flush=True)
    assert data['state']=='ok'
    assert len(data['runs'])==4
    for r in data['runs']:
        assert r['bitsPerSecond']>0 and r['intervals'] and r['receiverIntervalsAvailable']
        assert r['tcpRttMs'] is not None and r['retransmits'] is not None
        assert r['maxBitsPerSecond'] is not None
finally:
    listener.close()
cert_dir=tempfile.TemporaryDirectory(prefix='aster-tls-lab-')
cert=Path(cert_dir.name)/'certificate.pem'
key=Path(cert_dir.name)/'private.pem'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
server=ThreadingHTTPServer(('127.0.0.1',0),Receiver)
context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(cert,key)
server.socket=context.wrap_socket(server.socket,server_side=True)
server.token='b'*32
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with patch('native.resolve_ip',return_value='127.0.0.1'),patch('native.ipaddress.ip_address',return_value=SimpleNamespace(is_global=True,is_multicast=False)),patch.dict(os.environ,{'SSL_CERT_FILE':str(cert)}):
        data=native.http_speed('localhost',{'port':server.server_port,'seconds':5,'warmupSeconds':2,'streams':[1],'family':'4','endpoint':{'https':True,'path':'/download','uploadPath':'/upload'}},{'token':server.token})
    print(json.dumps({'method':data['method'],'state':data['state'],'runs':[{'vpsDirection':r['vpsDirection'],'streams':r['streams'],'bitsPerSecond':r.get('bitsPerSecond'),'intervalSource':r.get('intervalSource'),'tcpRttMs':r.get('tcpRttMs'),'retransmits':r.get('retransmits'),'intervals':len(r.get('intervals',[]))} for r in data['runs']]}),flush=True)
    assert data['state']=='ok',data
    for r in data['runs']:
        assert r['bitsPerSecond']>0 and r['intervals'] and r['tcpRttMs'] is not None
        assert abs(r['bitsPerSecond']-r['bytes']*8/r['seconds'])<1
        assert r['congestionControl']!='unavailable'
    with patch('native.resolve_ip',return_value='127.0.0.1'),patch('native.ipaddress.ip_address',return_value=SimpleNamespace(is_global=True,is_multicast=False)),patch.dict(os.environ,{'SSL_CERT_FILE':str(cert)}):
        invalid=native.http_speed('wrong-host.example',{'port':server.server_port,'seconds':5,'warmupSeconds':0,'streams':[1],'family':'4','endpoint':{'https':True,'path':'/download','uploadPath':'/upload'}},{'token':server.token})
        assert invalid['state']=='failed' and all('certificate' in r['diagnostic'] for r in invalid['runs']),invalid
finally:
    server.shutdown();server.server_close();cert_dir.cleanup()
print('Authenticated Linux iperf P1/P4 and HTTPS receiver both directions with Host/SNI verification passed',flush=True)
