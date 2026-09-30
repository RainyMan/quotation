"""Integration test: real PHP + SQLite, local fake PocketBase; no production writes.
Run with PHP_BINARY pointing to PHP 8.1+ with curl and pdo_sqlite enabled.
Optional PHP_TEST_INI points to a local php.ini.
"""
import contextlib, http.server, json, os, pathlib, socket, sqlite3, subprocess, tempfile, threading, time, unittest, urllib.request, urllib.error, http.cookiejar
ROOT = pathlib.Path(__file__).resolve().parents[1]
PHP = os.environ.get('PHP_BINARY', 'php')
def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0)); return s.getsockname()[1]
class PocketBase(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if '/api/collections/quotations/records/aaaaaaaaaaaaaaa?' not in self.path:
            self.send_error(404); return
        body=json.dumps({'id':'aaaaaaaaaaaaaaa','quo_number':'Q-001','customer_name':'測試公司','project_name':'測試工程','workflow_status':'awarded'}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
    def log_message(self,*args): pass
class AnalyticsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); cls.directory=pathlib.Path(cls.temp.name)
        cls.upstream=http.server.ThreadingHTTPServer(('127.0.0.1',0),PocketBase)
        threading.Thread(target=cls.upstream.serve_forever,daemon=True).start()
        cls.base='http://127.0.0.1:'+str(port()); cls.config=cls.directory/'config.php'
        cls.command=[PHP]+(['-c',os.environ['PHP_TEST_INI']] if os.environ.get('PHP_TEST_INI') else [])
        hashed=subprocess.check_output(cls.command+['-r',"echo password_hash('test-password-42',PASSWORD_DEFAULT);"]).decode()
        cls.configuration={'password_hash':hashed,'database':str(cls.directory/'analytics.sqlite'),'origin':cls.base,'pocketbase':'http://127.0.0.1:'+str(cls.upstream.server_port),'trusted_proxies':[],'geolocation':'','retention_days':90}
        cls.write_config()
        env=dict(os.environ,QUOTATION_ANALYTICS_CONFIG=str(cls.config))
        cls.log=open(cls.directory/'server.log','w')
        cls.server=subprocess.Popen(cls.command+['-S',cls.base.removeprefix('http://'),'-t',str(ROOT)],env=env,stdout=cls.log,stderr=cls.log,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        cls.admin=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        for _ in range(40):
            try: urllib.request.urlopen(cls.base+'/analytics.html');break
            except OSError: time.sleep(.1)
        else: raise RuntimeError('PHP server failed to start')
    @classmethod
    def write_config(cls):
        encoded=json.dumps(cls.configuration).replace('\\','\\\\').replace("'","\\'")
        cls.config.write_text("<?php return json_decode('"+encoded+"',true);",encoding='utf-8')
    @classmethod
    def tearDownClass(cls):
        cls.server.terminate();cls.server.wait();cls.upstream.shutdown();cls.upstream.server_close();cls.log.close();cls.temp.cleanup()
    def request(self,action,data=None,admin=False,headers=None,extra=''):
        req=urllib.request.Request(self.base+'/api/analytics.php?action='+action+extra,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
        try:
            with (self.admin.open(req) if admin else urllib.request.urlopen(req)) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def test_end_to_end(self):
        self.assertEqual(self.request('summary')[0],401)
        self.assertEqual(self.request('login',{'password':'wrong'})[0],401)
        self.assertEqual(self.request('login',{'password':'test-password-42'},headers={'Origin':'https://evil.test'})[0],403)
        code,login=self.request('login',{'password':'test-password-42'},admin=True);self.assertEqual(code,200)
        csrf={'X-CSRF-Token':login['csrf']}
        self.assertEqual(self.request('create_link',{'quotation':'aaaaaaaaaaaaaaa','recipient':'林先生'},admin=True)[0],403)
        code,link=self.request('create_link',{'quotation':'aaaaaaaaaaaaaaa','recipient':'林先生'},admin=True,headers=csrf);self.assertEqual(code,200)
        self.assertIn('share=',link['url'])
        self.assertEqual(self.request('start',{'quotation':'bbbbbbbbbbbbbbb'})[0],502)
        self.assertEqual(self.request('start',{'quotation':'aaaaaaaaaaaaaaa'},admin=True)[1],{'ignored':True})
        self.assertEqual(self.request('start',{'quotation':'aaaaaaaaaaaaaaa','share':'fake'})[0],404)
        code,one=self.request('start',{'quotation':'aaaaaaaaaaaaaaa','share':link['token']},headers={'CF-Connecting-IP':'8.8.8.8'});self.assertEqual(code,200)
        self.assertEqual(self.request('heartbeat',{'visit':one['visit'],'secret':'wrong','seconds':999})[0],403)
        time.sleep(1.1)
        self.assertEqual(self.request('heartbeat',{**one,'seconds':900000})[0],200)
        self.request('heartbeat',{**one,'seconds':0})
        event={**one,'event':'11111111-1111-1111-1111-111111111111','seconds':1}
        self.request('pdf',event);self.request('pdf',event)
        self.request('start',{'quotation':'aaaaaaaaaaaaaaa'})
        # Once configured as a trusted proxy, an explicit header determines the IP.
        self.configuration['trusted_proxies']=['127.0.0.1'];self.write_config()
        self.request('start',{'quotation':'aaaaaaaaaaaaaaa'},headers={'CF-Connecting-IP':'203.0.113.9'})
        code,summary=self.request('summary',admin=True);self.assertEqual(code,200)
        row=summary['items'][0];self.assertEqual(row['views'],3);self.assertEqual(row['unique_ips'],2);self.assertEqual(row['pdf_clicks'],1)
        code,detail=self.request('details',admin=True,extra='&quotation=aaaaaaaaaaaaaaa');self.assertEqual(code,200)
        self.assertNotIn('secret',json.dumps(detail));self.assertEqual(len(detail['items']),3)
        original=next(v for v in detail['items'] if v['id']==one['visit'])
        self.assertEqual(original['ip'],'127.0.0.1');self.assertEqual(original['recipient'],'林先生');self.assertGreaterEqual(original['seconds'],1);self.assertLessEqual(original['seconds'],3)
        self.assertEqual(len(original['pdf_times']),1)
        self.assertEqual(self.request('summary',admin=True,extra='&pdf=1')[1]['items'][0]['views'],1)
        self.assertEqual(self.request('summary',admin=True,extra='&status=paid')[1]['total'],0)
        # Geolocation cache returns country/city without any external requests.
        with sqlite3.connect(self.configuration['database']) as db:
            db.execute('INSERT INTO geo(ip,country,city,expires) VALUES(?,?,?,?)',('8.8.8.8','Test Country','Test City',int(time.time())+3600))
        db.close()
        self.configuration['geolocation']='ipwho.is';self.write_config()
        code,located=self.request('start',{'quotation':'aaaaaaaaaaaaaaa'},headers={'CF-Connecting-IP':'8.8.8.8'})
        self.assertEqual(code,200)
        located_rows=self.request('details',admin=True,extra='&quotation=aaaaaaaaaaaaaaa')[1]['items']
        self.assertEqual(next(v for v in located_rows if v['id']==located['visit'])['city'],'Test City')
        # Retention removes both an expired visit and its event, not active records.
        with sqlite3.connect(self.configuration['database']) as db:
            db.execute('UPDATE visits SET started=? WHERE id=?',(int(time.time())-91*86400,one['visit']))
        db.close()
        retained=self.request('summary',admin=True)[1]['items'][0]
        self.assertEqual(retained['views'],3);self.assertEqual(retained['pdf_clicks'],0)
        self.request('set_link',{'token':link['token'],'active':False},admin=True,headers=csrf)
        self.assertEqual(self.request('start',{'quotation':'aaaaaaaaaaaaaaa','share':link['token']})[0],404)
        self.request('logout',{},admin=True,headers=csrf)
        self.assertEqual(self.request('details',admin=True,extra='&quotation=aaaaaaaaaaaaaaa')[0],401)
if __name__=='__main__':unittest.main()
