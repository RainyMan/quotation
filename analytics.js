(() => {
    const $=id=>document.getElementById(id);
    let csrf='',page=1,detailPage=1,selected='';
    const statuses={quoted:'報價中',awarded:'已得標',billing:'請款中',paid:'已結案'};
    const date=value=>new Date(Number(value)*1000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
    const duration=value=>`${Math.floor(Number(value)/60)} 分 ${Number(value)%60} 秒`;
    const message=text=>$('message').textContent=text;
    async function api(action,data,params={}) {
        const response=await fetch('api/analytics.php?'+new URLSearchParams({action,...params}),data?{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(data)}:{cache:'no-store'});
        let result;try{result=await response.json()}catch{throw Error('服務未就緒，請確認 PHP 與部署設定。')}
        if(!response.ok){if(response.status===401) showLogin();throw Error(result.error||'操作失敗');}
        return result;
    }
    function showLogin(){$('login-panel').hidden=false;$('dashboard').hidden=true;$('logout').hidden=true;csrf='';}
    function showDashboard(token){csrf=token;$('login-panel').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;}
    function cell(row,text){const td=document.createElement('td');td.textContent=text;row.append(td);return td;}
    function empty(body,columns){const row=document.createElement('tr');const td=cell(row,'查無紀錄');td.colSpan=columns;body.append(row);}
    function filters(){return Object.fromEntries(new FormData($('filters')));}
    async function summary(){
        const result=await api('summary',null,{...filters(),page});const body=$('summary');body.replaceChildren();
        for(const q of result.items){const row=document.createElement('tr');cell(row,`${q.number||q.quotation}\n${q.customer||''}`);cell(row,q.project||'');const badge=document.createElement('span');badge.className='badge '+(Object.hasOwn(statuses,q.status)?q.status:'');badge.textContent=statuses[q.status]||'報價中';cell(row,'').append(badge);cell(row,q.views);cell(row,q.unique_ips);cell(row,duration(q.seconds));cell(row,q.pdf_clicks);cell(row,date(q.latest));const button=document.createElement('button');button.textContent='明細';button.onclick=()=>{selected=q.quotation;detailPage=1;$('detail-title').textContent=`${q.number||q.quotation} · 瀏覽明細`;run(details);};cell(row,'').append(button);body.append(row);}
        if(!result.items.length)empty(body,9);
        $('page-info').textContent=`第 ${page} 頁 · 共 ${result.total} 張`;$('previous').disabled=page<=1;$('next').disabled=page*50>=result.total;
    }
    async function details(){
        const result=await api('details',null,{...filters(),quotation:selected,page:detailPage});$('detail-panel').hidden=false;const body=$('details');body.replaceChildren();
        for(const v of result.items){const row=document.createElement('tr');cell(row,v.recipient);cell(row,date(v.started));cell(row,v.ip);cell(row,`${v.country||'未知'}／${v.city||'未知'}`);cell(row,duration(v.seconds));cell(row,`${v.pdf_clicks} 次${v.pdf_times.length?' · '+v.pdf_times.map(date).join('；'):''}`);body.append(row);}
        if(!result.items.length)empty(body,6);
        $('detail-page-info').textContent=`第 ${detailPage} 頁 · 共 ${result.total} 次`;$('detail-previous').disabled=detailPage<=1;$('detail-next').disabled=detailPage*50>=result.total;
        const ips=$('ip-summary');ips.replaceChildren();for(const ip of result.ips){const row=document.createElement('tr');cell(row,ip.ip);cell(row,ip.views);cell(row,duration(ip.seconds));cell(row,date(ip.latest));ips.append(row);}
    }
    async function links(){const result=await api('links',null,{quotation:$('quotation-id').value});$('links').replaceChildren();for(const link of result.items){const row=document.createElement('div');const label=document.createElement('span');label.textContent=`${link.recipient} · ${date(link.created)} · ${link.active?'追蹤中':'追蹤已停用'}`;const button=document.createElement('button');button.textContent=link.active?'停用追蹤':'啟用追蹤';button.onclick=()=>run(async()=>{await api('set_link',{token:link.token,active:!link.active});await links();});row.append(label,button);$('links').append(row);}}
    async function run(fn){message('');try{await fn()}catch(e){message(e.message)}}
    $('login-form').onsubmit=event=>{event.preventDefault();run(async()=>{const result=await api('login',{password:$('password').value});$('password').value='';showDashboard(result.csrf);await summary();});};
    $('logout').onclick=()=>run(async()=>{await api('logout',{});showLogin();});
    $('filters').onsubmit=event=>{event.preventDefault();page=1;detailPage=1;run(async()=>{await summary();if(selected)await details();});};
    $('link-form').onsubmit=event=>{event.preventDefault();run(async()=>{const result=await api('create_link',{quotation:$('quotation-id').value,recipient:$('recipient').value});$('share-url').value=result.url;$('link-result').hidden=false;await links();});};
    $('copy-link').onclick=()=>run(async()=>{await navigator.clipboard.writeText($('share-url').value);message('已複製專屬連結。');});
    $('load-links').onclick=()=>run(links);
    $('previous').onclick=()=>{page--;run(summary)};$('next').onclick=()=>{page++;run(summary)};
    $('detail-previous').onclick=()=>{detailPage--;run(details)};$('detail-next').onclick=()=>{detailPage++;run(details)};
    $('quotation-id').value=new URLSearchParams(location.search).get('quotation')||'';
    run(async()=>{const result=await api('session');showDashboard(result.csrf);await summary();});
})();
