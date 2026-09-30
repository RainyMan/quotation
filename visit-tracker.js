/* Public telemetry contains only a session capability, never admin credentials. */
(() => {
    let credentials=null, total=0, visibleSince=null, started=false, pendingPdf=[];
    const now=()=>performance.now();
    const accumulate=()=>{if(visibleSince!==null){total+=Math.max(0,now()-visibleSince);visibleSince=null;}};
    const payload=()=>({...credentials,seconds:Math.floor((total+(visibleSince!==null?now()-visibleSince:0))/1000)});
    function send(action,extra={}) {
        if(!credentials) return;
        const body=JSON.stringify({...payload(),...extra});
        fetch(`api/analytics.php?action=${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
    }
    window.startQuotationTracking=async function(quotation) {
        if(started || !new URLSearchParams(location.search).get('view')) return;
        started=true;
        const notice=document.createElement('small');
        notice.className='text-muted d-block text-center py-2';
        notice.id='visit-tracking-notice';
        notice.textContent='本頁會記錄開啟時間、IP 與推估地區、前景停留時間及 PDF 按鈕點擊，供報價跟進使用。';
        document.getElementById('view-mode-toolbar').append(notice);
        try {
            const response=await fetch('api/analytics.php?action=start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quotation:quotation.id,share:new URLSearchParams(location.search).get('share')||''})});
            const result=await response.json();
            if(!response.ok || !result.visit) return;
            credentials={visit:result.visit,secret:result.secret};
            if(document.visibilityState==='visible') visibleSince=now();
            for(const event of pendingPdf) send('pdf',{event}); pendingPdf=[];
            setInterval(()=>send('heartbeat'),15000);
        } catch (_) { /* Analytics must never prevent the quotation from loading. */ }
    };
    document.addEventListener('visibilitychange',()=>{
        accumulate();send('heartbeat');
        if(credentials && document.visibilityState==='visible') visibleSince=now();
    });
    window.addEventListener('pagehide',()=>{accumulate();send('heartbeat');});
    window.addEventListener('pageshow',()=>{if(credentials && visibleSince===null && document.visibilityState==='visible') visibleSince=now();});
    document.addEventListener('click',event=>{
        if(!event.target.closest?.('#view-mode-toolbar button') || !started) return;
        const id=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
        if(credentials) send('pdf',{event:id}); else pendingPdf.push(id);
    },true);
})();
