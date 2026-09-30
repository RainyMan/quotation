// Node 20+, playwright, Edge. APIs are fixtures; no production data is changed.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const root=path.resolve(__dirname,'..');const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let logged=false;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/api/analytics.php'){
   const action=url.searchParams.get('action');
   let body={};if(action==='session'&&!logged)return route.fulfill({status:401,json:{error:'請先登入瀏覽紀錄後台。'}});
   if(action==='login'){logged=true;body={csrf:'test-csrf'}};
   if(action==='summary')body={items:[{quotation:'aaaaaaaaaaaaaaa',number:'Q-001',customer:'測試公司',project:'道路修繕工程',status:'billing',views:4,unique_ips:2,seconds:122,pdf_clicks:1,latest:1790730000}],total:1};
   if(action==='details')body={items:[{recipient:'林先生',ip:'203.0.113.9',country:'Taiwan',city:'Taipei',started:1790730000,seconds:62,pdf_clicks:1,pdf_times:[1790730060]}],ips:[{ip:'203.0.113.9',views:3,seconds:100,latest:1790730000}],total:1};
   if(action==='create_link')body={url:'http://quotation.test/?view=aaaaaaaaaaaaaaa&share=token'};
   if(action==='links')body={items:[]};
   if(action==='logout')logged=false;
   return route.fulfill({json:body});
  }
  const file=path.join(root,path.basename(url.pathname));
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('http://quotation.test/analytics.html?quotation=aaaaaaaaaaaaaaa');
 await page.locator('#password').fill('test-password');await page.getByRole('button',{name:'登入',exact:true}).click();
 await page.locator('#summary button').waitFor();assert.match(await page.locator('#summary').textContent(),/2 分 2 秒/);
 await page.locator('#summary button').click();await page.locator('#details tr').waitFor();assert.match(await page.locator('#details').textContent(),/Taipei/);
 await page.locator('#recipient').fill('林先生');await page.getByRole('button',{name:'產生連結'}).click();await page.locator('#share-url').waitFor({state:'visible'});
 assert.match(await page.locator('#share-url').inputValue(),/share=token/);
 await page.locator('#filters input[name=pdf]').check();await page.getByRole('button',{name:'篩選',exact:true}).click();
 await page.screenshot({path:path.resolve('work/analytics-preview.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#logout').click();await page.locator('#login-panel').waitFor({state:'visible'});
 const tracking=await browser.newPage();const packets=[];
 await tracking.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.pathname.includes('/api/')){packets.push({action:u.searchParams.get('action'),...JSON.parse(route.request().postData()||'{}')});return route.fulfill({json:u.searchParams.get('action')==='start'?{visit:'visit',secret:'secret'}:{ok:true}})}
  return route.fulfill({body:'<div id="view-mode-toolbar"><button>PDF</button></div>'});
 });
 await tracking.goto('http://quotation.test/?view=aaaaaaaaaaaaaaa&share=token');await tracking.clock.install();
 await tracking.addScriptTag({path:path.join(root,'visit-tracker.js')});
 await tracking.evaluate(()=>startQuotationTracking({id:'aaaaaaaaaaaaaaa'}));
 await tracking.evaluate(()=>startQuotationTracking({id:'aaaaaaaaaaaaaaa'}));
 await tracking.clock.runFor(16000);
 await tracking.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await tracking.clock.runFor(30000);
 await tracking.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
 await tracking.clock.runFor(14000);
 await tracking.getByRole('button',{name:'PDF'}).click();
 await tracking.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await tracking.waitForTimeout(100);
 assert.equal(packets.filter(p=>p.action==='start').length,1);
 assert.equal(packets.filter(p=>p.action==='pdf').length,1);
 const last=packets.filter(p=>p.action==='heartbeat').at(-1);assert.ok(last.seconds>=29&&last.seconds<=31,JSON.stringify(last));
 assert.deepEqual(errors,[]);await browser.close();console.log('PASS: dashboard login, summary, details, links, filters, mobile; foreground timing, one start and PDF click.');
})().catch(e=>{console.error(e);process.exit(1)});
