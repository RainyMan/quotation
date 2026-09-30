<?php
// PHP 8.1+, pdo_sqlite, curl. Configuration and database MUST live outside web root.
declare(strict_types=1);
ini_set('display_errors','0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
function reply(array $value, int $status = 200): never { http_response_code($status); echo json_encode($value, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE); exit; }
function fail(string $message, int $status = 400): never { reply(['error'=>$message], $status); }
try {
    $configFile = getenv('QUOTATION_ANALYTICS_CONFIG') ?: dirname(__DIR__, 2).'/quotation-analytics-config.php';
    if (!is_file($configFile)) fail('瀏覽紀錄服務尚未設定，請完成 ANALYTICS_SETUP.md 的部署步驟。', 503);
    $config = require $configFile;
    if (!is_array($config) || empty($config['password_hash']) || empty($config['database'])) fail('瀏覽紀錄服務設定不完整。', 503);
    $root = realpath(dirname(__DIR__));
    $dir = realpath(dirname($config['database']));
    if (!$dir || str_starts_with(strtolower($dir).DIRECTORY_SEPARATOR, strtolower($root).DIRECTORY_SEPARATOR)) fail('資料庫必須存放於網站根目錄之外。',503);
    $origin = rtrim($config['origin'] ?? '', '/');
    if (!preg_match('~^https?://[^/]+$~', $origin)) fail('請設定正確的 origin。',503);
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $origin) fail('來源不符。',403);
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && !str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) fail('請使用 JSON。',415);
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 8192) fail('請求過大。',413);
    $data = json_decode(file_get_contents('php://input', false, null, 0, 8193) ?: '{}', true);
    if (!is_array($data)) fail('JSON 格式錯誤。');
    $db = new PDO('sqlite:'.$config['database'], null, null, [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
    $db->exec('CREATE TABLE IF NOT EXISTS links (token TEXT PRIMARY KEY, quotation TEXT NOT NULL, recipient TEXT NOT NULL, created INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, secret TEXT NOT NULL, quotation TEXT NOT NULL, number TEXT, customer TEXT, project TEXT, status TEXT, link TEXT, recipient TEXT, ip TEXT NOT NULL, country TEXT, city TEXT, started INTEGER NOT NULL, last_seen INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS visits_quotation ON visits(quotation,started);
      CREATE INDEX IF NOT EXISTS visits_ip ON visits(ip,started);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, visit TEXT NOT NULL, kind TEXT NOT NULL, occurred INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_visit ON events(visit);
      CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS geo (ip TEXT PRIMARY KEY, country TEXT, city TEXT, expires INTEGER NOT NULL);');
    function query(string $sql, array $params=[]): PDOStatement { global $db; $s=$db->prepare($sql); $s->execute($params); return $s; }
    function rate(string $key, int $limit, int $window): void {
        $key .= ':'.intdiv(time(), $window);
        query('INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1',[$key,time()+$window]);
        if ((int)query('SELECT count FROM limits WHERE key=?',[$key])->fetchColumn()>$limit) fail('請稍後再試。',429);
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    // Trust exactly configured proxy peers, never arbitrary X-Forwarded-For.
    if (in_array($ip, $config['trusted_proxies'] ?? [], true)) {
        $forwarded=$_SERVER[$config['client_ip_header'] ?? 'HTTP_CF_CONNECTING_IP'] ?? '';
        if (filter_var($forwarded,FILTER_VALIDATE_IP)) $ip=$forwarded;
    }
    if (!filter_var($ip,FILTER_VALIDATE_IP)) fail('無法取得來源 IP。');
    $ip=inet_ntop(inet_pton($ip));
    session_name('quotation_analytics');
    ini_set('session.use_strict_mode','1');
    session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>str_starts_with($origin,'https://'),'httponly'=>true,'samesite'=>'Strict']);
    session_start();
    $admin=isset($_SESSION['login']) && $_SESSION['login']>time()-28800;
    $csrf=$_SESSION['csrf'] ?? '';
    session_write_close();
    $action=$_GET['action'] ?? '';
    $post=in_array($action,['login','logout','create_link','set_link','start','heartbeat','pdf'],true);
    if ($post && $_SERVER['REQUEST_METHOD']!=='POST') fail('需要 POST。',405);
    if ($action==='login') {
        rate('login:'.$ip,10,900);
        if (!password_verify((string)($data['password'] ?? ''),$config['password_hash'])) fail('密碼錯誤。',401);
        session_start(); session_regenerate_id(true); $_SESSION['login']=time(); $_SESSION['csrf']=bin2hex(random_bytes(24));
        reply(['csrf'=>$_SESSION['csrf']]);
    }
    $private=['session','logout','create_link','set_link','summary','details','links'];
    if (in_array($action,$private,true)) {
        if (!$admin) fail('請先登入瀏覽紀錄後台。',401);
        if ($post && (!$csrf || !hash_equals($csrf,$_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) fail('請重新登入。',403);
    }
    if ($action==='session') reply(['csrf'=>$csrf,'geo_enabled'=>($config['geolocation'] ?? '')==='ipwho.is']);
    if ($action==='logout') { session_start(); $_SESSION=[]; session_destroy(); reply(['ok'=>true]); }
    function fetchJson(string $url): array {
        $c=curl_init($url); curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>5,CURLOPT_CONNECTTIMEOUT=>3,CURLOPT_PROTOCOLS=>CURLPROTO_HTTP|CURLPROTO_HTTPS]);
        $body=curl_exec($c); $status=curl_getinfo($c,CURLINFO_RESPONSE_CODE); curl_close($c);
        $json=$body ? json_decode($body,true) : null;
        if ($status!==200 || !is_array($json)) throw new RuntimeException('upstream unavailable');
        return $json;
    }
    function quotation(string $id): array {
        global $config;
        if (!preg_match('/^[a-z0-9]{15}$/',$id)) fail('報價單編號格式錯誤。');
        try { return fetchJson(rtrim($config['pocketbase'] ?? 'https://pocketbase.tarmacroad.com','/').'/api/collections/quotations/records/'.$id.'?fields=id,quo_number,customer_name,project_name,project_location,workflow_status'); }
        catch (Throwable $e) { fail('無法確認報價單，請檢查 PocketBase 連線及讀取權限。',502); }
    }
    if ($action==='create_link') {
        $q=quotation((string)($data['quotation'] ?? ''));
        $recipient=trim((string)($data['recipient'] ?? ''));
        if (!$recipient || strlen($recipient)>240) fail('請輸入收件人標籤（最多 240 bytes）。');
        $token=bin2hex(random_bytes(24));
        query('INSERT INTO links(token,quotation,recipient,created) VALUES(?,?,?,?)',[$token,$q['id'],$recipient,time()]);
        reply(['url'=>$origin.'/?view='.$q['id'].'&share='.$token,'token'=>$token]);
    }
    if ($action==='set_link') {
        query('UPDATE links SET active=? WHERE token=?',[(int)!empty($data['active']),$data['token'] ?? '']); reply(['ok'=>true]);
    }
    if ($action==='links') reply(['items'=>query('SELECT * FROM links WHERE quotation=? ORDER BY created DESC',[$_GET['quotation'] ?? ''])->fetchAll()]);
    // Retention is enforced on each request so expired IPs cannot appear in reports.
    $cutoff=time()-max(1,(int)($config['retention_days'] ?? 90))*86400;
    query('DELETE FROM events WHERE visit IN (SELECT id FROM visits WHERE started<?)',[$cutoff]);
    query('DELETE FROM visits WHERE started<?',[$cutoff]);
    query('DELETE FROM limits WHERE expires<?',[time()]); query('DELETE FROM geo WHERE expires<?',[time()]);
    if ($action==='start') {
        if ($admin) reply(['ignored'=>true]);
        rate('start:'.$ip,120,3600);
        $id=(string)($data['quotation'] ?? ''); $token=(string)($data['share'] ?? ''); $recipient='未標記收件人（原分享連結）';
        if ($token!=='') {
            $link=query('SELECT * FROM links WHERE token=? AND quotation=? AND active=1',[$token,$id])->fetch();
            if (!$link) fail('追蹤連結不存在或已停用。',404);
            $recipient=$link['recipient'];
        }
        $q=quotation($id);
        $country=''; $city='';
        if (($config['geolocation'] ?? '')==='ipwho.is' && filter_var($ip,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)) {
            $geo=query('SELECT country,city FROM geo WHERE ip=?',[$ip])->fetch();
            if (!$geo) {
                try { $g=fetchJson('https://ipwho.is/'.rawurlencode($ip)); $geo=['country'=>!empty($g['success']) ? ($g['country'] ?? '') : '', 'city'=>!empty($g['success']) ? ($g['city'] ?? '') : '']; }
                catch (Throwable $e) { $geo=['country'=>'','city'=>'']; }
                query('INSERT OR REPLACE INTO geo(ip,country,city,expires) VALUES(?,?,?,?)',[$ip,$geo['country'],$geo['city'],time()+86400]);
            }
            $country=$geo['country']; $city=$geo['city'];
        }
        $visit=bin2hex(random_bytes(16));$secret=bin2hex(random_bytes(32));
        query('INSERT INTO visits(id,secret,quotation,number,customer,project,status,link,recipient,ip,country,city,started,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$visit,hash('sha256',$secret),$id,$q['quo_number'] ?? '',$q['customer_name'] ?? '',$q['project_name'] ?? $q['project_location'] ?? '',$q['workflow_status'] ?? 'quoted',$token,$recipient,$ip,$country,$city,time(),time()]);
        reply(['visit'=>$visit,'secret'=>$secret]);
    }
    if ($action==='heartbeat' || $action==='pdf') {
        $visit=query('SELECT * FROM visits WHERE id=?',[$data['visit'] ?? ''])->fetch();
        if (!$visit || !hash_equals($visit['secret'],hash('sha256',(string)($data['secret'] ?? '')))) fail('無效的瀏覽工作階段。',403);
        if (time()-(int)$visit['started']>86400) fail('工作階段已到期。',410);
        rate('event:'.$visit['id'],1000,3600);
        $total=max(0,(int)($data['seconds'] ?? 0));
        // Bound reported foreground time by elapsed wall time and monotonic updates.
        $total=min($total,time()-(int)$visit['started']);
        query('UPDATE visits SET seconds=MAX(seconds,?),last_seen=? WHERE id=?',[$total,time(),$visit['id']]);
        if ($action==='pdf') {
            $event=(string)($data['event'] ?? '');
            if (!preg_match('/^[a-f0-9-]{16,64}$/',$event)) fail('事件編號錯誤。');
            query('INSERT OR IGNORE INTO events(id,visit,kind,occurred) VALUES(?,?,?,?)',[$event,$visit['id'],'pdf',time()]);
        }
        reply(['ok'=>true]);
    }
    if ($action==='summary' || $action==='details') {
        $where=['1=1'];$params=[];
        if (!empty($_GET['from'])) { $date=DateTimeImmutable::createFromFormat('!Y-m-d',$_GET['from'],new DateTimeZone('Asia/Taipei')); if (!$date) fail('日期錯誤'); $where[]='v.started>=?';$params[]=$date->getTimestamp(); }
        if (!empty($_GET['to'])) { $date=DateTimeImmutable::createFromFormat('!Y-m-d',$_GET['to'],new DateTimeZone('Asia/Taipei')); if (!$date) fail('日期錯誤');$where[]='v.started<?';$params[]=$date->modify('+1 day')->getTimestamp(); }
        if (!empty($_GET['q'])) { $where[]='(v.customer LIKE ? OR v.project LIKE ? OR v.number LIKE ?)';$term='%'.substr($_GET['q'],0,200).'%';array_push($params,$term,$term,$term); }
        if (!empty($_GET['status'])) { $where[]='v.status=?';$params[]=$_GET['status']; }
        if (!empty($_GET['pdf'])) $where[]='EXISTS(SELECT 1 FROM events e WHERE e.visit=v.id)';
        if ($action==='details') { $where[]='v.quotation=?';$params[]=$_GET['quotation'] ?? ''; }
        $filter=implode(' AND ',$where); $page=max(1,(int)($_GET['page'] ?? 1));$offset=($page-1)*50;
        if ($action==='summary') {
            $sql="SELECT v.quotation,MAX(v.started) latest,COUNT(*) views,COUNT(DISTINCT v.ip) unique_ips,SUM(v.seconds) seconds,SUM((SELECT COUNT(*) FROM events e WHERE e.visit=v.id)) pdf_clicks FROM visits v WHERE $filter GROUP BY v.quotation ORDER BY latest DESC";
            $total=(int)query("SELECT COUNT(DISTINCT v.quotation) FROM visits v WHERE $filter",$params)->fetchColumn();
            $rows=query($sql." LIMIT 50 OFFSET $offset",$params)->fetchAll();
            foreach($rows as &$row) {
                $meta=query('SELECT number,customer,project,status FROM visits WHERE quotation=? ORDER BY started DESC LIMIT 1',[$row['quotation']])->fetch();$row=array_merge($row,$meta ?: []);
            }unset($row);
            reply(['items'=>$rows,'total'=>$total,'page'=>$page]);
        }
        $total=(int)query("SELECT COUNT(*) FROM visits v WHERE $filter",$params)->fetchColumn();
        $rows=query("SELECT v.id,v.quotation,v.recipient,v.ip,v.country,v.city,v.started,v.last_seen,v.seconds,(SELECT COUNT(*) FROM events e WHERE e.visit=v.id) pdf_clicks FROM visits v WHERE $filter ORDER BY v.started DESC LIMIT 50 OFFSET $offset",$params)->fetchAll();
        foreach($rows as &$row) { $row['pdf_times']=query('SELECT occurred FROM events WHERE visit=? ORDER BY occurred',[$row['id']])->fetchAll(PDO::FETCH_COLUMN); }unset($row);
        $ips=query("SELECT v.ip,COUNT(*) views,SUM(v.seconds) seconds,MAX(v.started) latest FROM visits v WHERE $filter GROUP BY v.ip ORDER BY views DESC",$params)->fetchAll();
        reply(['items'=>$rows,'ips'=>$ips,'total'=>$total,'page'=>$page]);
    }
    fail('未知操作。',404);
} catch (Throwable $e) { error_log('quotation analytics: '.$e->getMessage()); fail('瀏覽紀錄服務暫時無法使用，請檢查伺服器設定。',503); }
