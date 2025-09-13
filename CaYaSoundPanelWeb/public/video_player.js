// Receives a blob via postMessage and plays it
const v = document.getElementById('v');
const fsBtn = document.getElementById('fsBtn');
let _currentObjectUrl = null;
function tryFullscreen(){
  try{
    if(v.requestFullscreen) return v.requestFullscreen();
    if(v.webkitRequestFullscreen) return v.webkitRequestFullscreen();
  }catch(e){console.warn('fullscreen failed', e)}
}
fsBtn.addEventListener('click', tryFullscreen);
window.addEventListener('keydown', (ev)=>{ if(ev.key === 'F11' || ev.key === 'f11'){ ev.preventDefault(); tryFullscreen(); } });
window.addEventListener('message', (ev)=>{
  if(!ev.data) return;
  if(ev.data.type === 'video-blob-url'){
    try{
      v.src = ev.data.url;
      _currentObjectUrl = ev.data.url;
      v.play().catch(()=>{});
      try{ window.opener.postMessage({ type: 'received-video-url' }, '*'); }catch(e){}
    }catch(e){console.error(e)}
  }
  // structured clone path: receive blob directly
  if(ev.data.type === 'video-blob'){
    try{
      const blob = ev.data.blob;
      const objUrl = URL.createObjectURL(blob);
      _currentObjectUrl = objUrl;
      v.src = objUrl;
      v.addEventListener('loadeddata', ()=>{
        // acknowledge to opener that we have loaded the blob (so it can cleanup if needed)
        try{ window.opener.postMessage({ type: 'received-video-url' }, '*'); }catch(e){}
        // revoke object URL when page unloads (safety)
        window.addEventListener('beforeunload', ()=>{ try{ if(_currentObjectUrl) URL.revokeObjectURL(_currentObjectUrl); }catch(e){} });
      }, { once: true });
      v.play().catch(()=>{});
    }catch(e){console.error(e)}
  }
  if(ev.data.type === 'request-fullscreen'){
    // best-effort fullscreen request
    try{
      if(v.requestFullscreen){ v.requestFullscreen().catch(()=>{}); }
      else if(v.webkitRequestFullscreen){ v.webkitRequestFullscreen(); }
    }catch(e){}
  }
});
// if opened directly, allow drag/drop of a file
v.addEventListener('error', ()=>{ console.error('Video error'); });
// when video ends, revoke URL and close window
v.addEventListener('ended', ()=>{
  try{ if(_currentObjectUrl) URL.revokeObjectURL(_currentObjectUrl); }catch(e){}
  try{ window.close(); }catch(e){}
});
