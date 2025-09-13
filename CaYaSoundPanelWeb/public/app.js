// Minimal client: stores audio in IndexedDB (IDB) and uses a server-set cookie to enable features

const notice = document.getElementById('notice');
const fileInput = document.getElementById('fileInput');
const libraryList = document.getElementById('libraryList');
const player = document.getElementById('player');
const masterVolEl = document.getElementById('masterVol');

const COOKIE_NAME = '_caya_session';

function hasCookie(name) {
  return document.cookie.split(';').map(s=>s.trim()).some(s=>s.startsWith(name + '='));
}

// volume state
let masterVolume = parseFloat(localStorage.getItem('caya_master_vol')||'1');
const soundVolumeMap = new Map(); // id -> 0..1

function applyVolumesToExisting(){
  for(const [id,a] of addedAudioMap.entries()){
    const vol = (soundVolumeMap.get(id) ?? 1) * masterVolume;
    a.volume = Math.max(0, Math.min(1, vol));
  }
  try{ player.volume = masterVolume * (soundVolumeMap.get(exclusivePlayingId) ?? 1); }catch(e){}
}

function setMasterVolume(v){ masterVolume = v; localStorage.setItem('caya_master_vol', String(v)); applyVolumesToExisting(); }

function showNotice(msg) {
  notice.textContent = msg;
}

// small IndexedDB wrapper
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('caya-sounds', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('sounds')) {
        const os = db.createObjectStore('sounds', { keyPath: 'id' });
        // indexes for ordering
        os.createIndex('order_idx', 'order', { unique: false });
      }
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function addSound({ id, name, blob, kind='audio' }) {
  const db = await openDB();
  const dbItems = await listSounds();
  const order = (dbItems.length>0 ? Math.max(...dbItems.map(x=>x.order||0))+1 : 1);
  const tx = db.transaction('sounds', 'readwrite');
  tx.objectStore('sounds').put({ id, name, blob, kind, created: Date.now(), order, description: '' });
  return tx.complete || new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

async function listSounds() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sounds', 'readonly');
    const req = tx.objectStore('sounds').getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      // sort by order asc, then by created desc
      arr.sort((a,b)=> {
        const oa = a.order||0; const ob = b.order||0;
        if (oa !== ob) return oa - ob;
        return b.created - a.created;
      });
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });
}

async function updateSoundMeta(id, patch){
  const db = await openDB();
  const tx = db.transaction('sounds','readwrite');
  const store = tx.objectStore('sounds');
  const cur = await new Promise((res,rej)=>{ const r=store.get(id); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  if(!cur) return;
  const updated = Object.assign({}, cur, patch);
  store.put(updated);
  return tx.complete || new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=rej; });
}

async function reorder(id, delta){
  const items = await listSounds();
  const idx = items.findIndex(x=>x.id===id);
  if(idx === -1) return;
  const targetIdx = idx + delta;
  if(targetIdx < 0 || targetIdx >= items.length) return;
  // swap order values
  const a = items[idx];
  const b = items[targetIdx];
  const oa = a.order || 0;
  const ob = b.order || 0;
  await updateSoundMeta(a.id, { order: ob });
  await updateSoundMeta(b.id, { order: oa });
}

async function deleteSound(id) {
  const db = await openDB();
  const tx = db.transaction('sounds', 'readwrite');
  tx.objectStore('sounds').delete(id);
  return tx.complete || new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
}

// Queue in localStorage as array of ids
// queue implementation removed (UI not used)

async function renderLibrary(){
  libraryList.innerHTML='';
  let items = await listSounds();
  // ensure every item has a numeric order; if not, initialize sequentially
  if(items.some(it => typeof it.order !== 'number')){
    for(let i=0;i<items.length;i++){
      await updateSoundMeta(items[i].id, { order: i+1 });
    }
    items = await listSounds();
  }
  // Track order number
  let idx = 1;
  for(const it of items){
    // ensure map has persisted volume (1 if absent)
    soundVolumeMap.set(it.id, (typeof it.volume === 'number') ? it.volume : 1);
    const li = document.createElement('li');
    li.className = 'lib-row';

    // left index box
    const indexBox = document.createElement('div');
    indexBox.className = 'index-box';
    indexBox.textContent = idx++;

  // icon placeholder (different for audio/video)
  const icon = document.createElement('div');
  icon.className = 'icon-box';
  icon.innerHTML = (it.kind === 'video') ? '▶' : '♪';

  // name button (exclusive play for audio, open new window for video)
    const nameBtn = document.createElement('button');
    nameBtn.className = 'name-btn';
    // show only first 10 characters, keep full name as tooltip
    const short = (it.name && it.name.length > 10) ? (it.name.slice(0, 10) + '…') : it.name;
    nameBtn.textContent = short;
    nameBtn.title = it.name;

    // add/ toggle button (plays without stopping others)
    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = 'Ekle';

    // text / description area (placeholder)
      // text / description editable area
      const desc = document.createElement('input');
      desc.className = 'desc';
      desc.type = 'text';
      desc.placeholder = 'Açıklama ekle...';
      desc.value = it.description || '';
      desc.addEventListener('change', async ()=>{ await updateSoundMeta(it.id, { description: desc.value }); });
      // per-sound volume slider
      const volWrapper = document.createElement('div'); volWrapper.className='vol-wrap';
      const volInput = document.createElement('input'); volInput.type='range'; volInput.min=0; volInput.max=100; volInput.value = Math.round((it.volume ?? 1) * 100);
      volInput.title = 'Ses seviyesi';
      volInput.addEventListener('input', ()=>{
        const v = volInput.value / 100;
        soundVolumeMap.set(it.id, v);
        // apply immediately
        if(addedAudioMap.has(it.id)){
          const a = addedAudioMap.get(it.id); a.volume = Math.max(0, Math.min(1, v * masterVolume));
        }
        if(exclusivePlayingId === it.id){ try{ player.volume = v * masterVolume; }catch(e){} }
      });
      volInput.addEventListener('change', async ()=>{ await updateSoundMeta(it.id, { volume: (volInput.value/100) }); });
      volWrapper.appendChild(volInput);
  // right controls: up/down, delete
  const right = document.createElement('div');
  right.className = 'row-right';
  const upBtn = document.createElement('button'); upBtn.className='small'; upBtn.textContent='▲'; upBtn.title='Yukarı';
  const downBtn = document.createElement('button'); downBtn.className='small'; downBtn.textContent='▼'; downBtn.title='Aşağı';
  const delBtn = document.createElement('button'); delBtn.className='small del'; delBtn.textContent='✖'; delBtn.title = 'Sil';
  delBtn.onclick = async ()=>{ await deleteSound(it.id); await renderLibrary(); };
  // assemble in desired order: up/down -> delete
  right.appendChild(upBtn); right.appendChild(downBtn); right.appendChild(delBtn);
    const middle = document.createElement('div');
    middle.className = 'row-middle';
  middle.appendChild(icon);
  middle.appendChild(nameBtn);
  middle.appendChild(addBtn);
  middle.appendChild(desc);
  // do NOT append volWrapper to middle; vol will be on the right side

    li.appendChild(indexBox);
    li.appendChild(middle);
    li.appendChild(right);

    // set button states based on current playing state
  if (exclusivePlayingId === it.id) nameBtn.classList.add('active-excl'); else nameBtn.classList.remove('active-excl');
  if (playingAdded.has(it.id)) { addBtn.textContent = 'Durdur'; addBtn.classList.add('playing'); } else { addBtn.textContent = 'Ekle'; addBtn.classList.remove('playing'); }
  // highlight row when playing (either exclusive or added)
  if(exclusivePlayingId === it.id || playingAdded.has(it.id)) li.classList.add('playing-row'); else li.classList.remove('playing-row');

  // wiring behavior for exclusive and added play
    nameBtn.addEventListener('click', async ()=>{
      // if this is a video, open in dedicated player window and allow screen selection
      if(it.kind === 'video'){
        const item = (await listSounds()).find(s=>s.id===it.id);
        if(!item) return;
        // enumerate screens
        const screens = await getScreens();
        // if more than one, ask user to select via prompt (simple fallback)
        let choice = 0;
        if(screens.length > 1){
          const labels = screens.map((s,i)=>`${i+1}: ${s.label} (${s.width}x${s.height})`).join('\n');
          const ans = prompt(`Ekran seçiniz:\n${labels}\nSeçim numarası:`,'1');
          // if user cancels prompt (ans === null), abort opening
          if(ans === null) return;
          const n = parseInt(ans||'1',10);
          if(!isNaN(n) && n>=1 && n<=screens.length) choice = n-1;
        }
        const target = screens[choice];
        // open the player window synchronously (to avoid popup blocking) and try to move it
        const w = window.open('video_player.html', '_blank', `left=${target.left},top=${target.top},width=${target.width},height=${target.height}`);
        if(!w){ alert('Yeni pencere açılamadı. Popup engelleyiciyi devre dışı bırakın.'); return; }
        // send the blob directly (structured clone) after short delay; avoids object-URL races
        setTimeout(()=>{ try{ w.postMessage({ type:'video-blob', blob: item.blob, filename: item.name }, '*'); }catch(e){} }, 200);
        // attempt to move/resize (may be blocked by browser)
        try{ w.moveTo(target.left, target.top); w.resizeTo(target.width, target.height); }catch(e){}
        // try to request fullscreen in the child by sending a message
        setTimeout(()=>{ try{ w.postMessage({ type:'request-fullscreen' }, '*'); }catch(e){} }, 500);
        return;
      }
      // audio: If exclusive is already playing this id -> stop
      if (exclusivePlayingId === it.id) {
        stopExclusive();
        renderLibrary();
        return;
      }
      // stop only current exclusive playback; keep overlays running
      stopExclusive();
      const item = (await listSounds()).find(s=>s.id===it.id);
      if (item) playExclusive(item.blob, it.id);
      renderLibrary();
    });

  upBtn.onclick = async ()=>{ await reorder(it.id, -1); await renderLibrary(); };
  downBtn.onclick = async ()=>{ await reorder(it.id, +1); await renderLibrary(); };

  addBtn.addEventListener('click', async ()=>{
      // toggle added playback for this id
      if (playingAdded.has(it.id)){
        // currently playing => stop
        stopAdded(it.id);
        addBtn.textContent = 'Ekle'; addBtn.classList.remove('playing');
      } else {
        // start playing without stopping others
        const item = (await listSounds()).find(s=>s.id===it.id);
        if (item) startAdded(item.blob, it.id);
        addBtn.textContent = 'Durdur'; addBtn.classList.add('playing');
      }
      renderLibrary();
    });

  // place volWrapper to the right side (so it's visually right-aligned)
  right.insertBefore(volWrapper, right.firstChild);

    libraryList.appendChild(li);
  }
}

async function renderQueue(){
  // queue UI removed
}

function playBlob(blob){
  const url = URL.createObjectURL(blob);
  player.src = url;
  player.play();
  player.onended = () => { try{ URL.revokeObjectURL(url); }catch(e){} exclusivePlayingId = null; renderLibrary(); };
}

// ---- added/exclusive playback management ----
// exclusive: only one exclusive audio can play at once. It's mapped to the main <audio> player.
let exclusivePlayingId = null;
function playExclusive(blob, id){
  exclusivePlayingId = id;
  playBlob(blob);
  // apply volume for exclusive
  const per = soundVolumeMap.get(id) ?? 1;
  try{ player.volume = Math.max(0, Math.min(1, per * masterVolume)); }catch(e){}
}
function stopExclusive(){
  exclusivePlayingId = null;
  try{ player.pause(); player.currentTime = 0; }catch(e){}
}

// added: multiple short-play sounds that can overlap. We'll create Audio objects for each.
const addedAudioMap = new Map(); // id -> HTMLAudioElement
const playingAdded = new Set();
function startAdded(blob, id){
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  a.loop = false;
  a._objUrl = url;
  a.onended = () => { try{ URL.revokeObjectURL(a._objUrl); }catch(e){} addedAudioMap.delete(id); playingAdded.delete(id); };
  // ensure UI updates when added sound ends
  a.addEventListener('ended', ()=>{ renderLibrary(); });
  // apply per-sound volume
  const per = soundVolumeMap.get(id) ?? 1;
  a.volume = Math.max(0, Math.min(1, per * masterVolume));
  a._perSoundVolume = per;
  addedAudioMap.set(id, a);
  playingAdded.add(id);
  a.play();
}
function stopAdded(id){
  const a = addedAudioMap.get(id);
  if(a){ try{ a.pause(); a.currentTime = 0; }catch(e){} try{ if(a._objUrl) URL.revokeObjectURL(a._objUrl); }catch(e){} addedAudioMap.delete(id); playingAdded.delete(id); }
}
function stopAllAdded(){
  for(const id of Array.from(addedAudioMap.keys())) stopAdded(id);
}

// Open a new window for video playback and send the blob via postMessage
function openVideoPlayerWindow(blob, filename){
  // default behavior: open a small player window (may be blocked by popup blocker)
  const w = window.open('video_player.html', '_blank', 'width=800,height=600');
  if(!w) { alert('Yeni pencere açılamadı. Lütfen popup engelleyiciyi devre dışı bırakın.'); return; }
  // send the blob directly via postMessage (structured clone) after short delay
  setTimeout(()=>{ try{ w.postMessage({ type: 'video-blob', blob, filename }, '*'); }catch(e){} }, 250);
  // optional: listen for ack but we don't manage object URLs here anymore
}

// Try to enumerate available screens (best-effort). Returns array of { left, top, width, height, label }
async function getScreens(){
  try{
    if(window.getScreenDetails){
      const sd = await window.getScreenDetails();
      if(sd && sd.screens && sd.screens.length){
        return sd.screens.map(s=>({ left: s.availLeft ?? s.left ?? 0, top: s.availTop ?? s.top ?? 0, width: s.width ?? s.availWidth ?? window.screen.width, height: s.height ?? s.availHeight ?? window.screen.height, label: s.label || 'Ekran' }));
      }
    }
  }catch(e){}
  // fallback: single primary screen
  return [{ left: window.screenX || 0, top: window.screenY || 0, width: window.screen.width, height: window.screen.height, label: 'Primary' }];
}
// queue functionality removed

// Init
(async function init(){
  if(!hasCookie(COOKIE_NAME)){
    showNotice('Bu sayfa sadece sitemizden erişildiğinde çalışır. Lütfen site adresinden erişin.');
    // disable controls
    fileInput.disabled = true;
    return;
  }

  // clear the ready notice (we'll keep notice empty)
  showNotice('');

  fileInput.addEventListener('change', async (ev)=>{
    const f = ev.target.files[0];
    if(!f) return;
    const id = crypto.randomUUID();
    const mime = f.type || '';
    const kind = mime.startsWith('video/') ? 'video' : 'audio';
    const blob = await f.arrayBuffer().then(b=>new Blob([b], { type: f.type }));
    await addSound({ id, name: f.name, blob, kind });
    await renderLibrary();
  });

  // queue controls removed

  // master volume wiring
  try{
    masterVolEl.value = Math.round(masterVolume * 100);
    masterVolEl.addEventListener('input', ()=>{ setMasterVolume(masterVolEl.value/100); });
  }catch(e){}

  // custom player elements
  const playBtn = document.getElementById('playBtn');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const curTimeEl = document.getElementById('curTime');
  const totalTimeEl = document.getElementById('totalTime');
  const globalStopBtn = document.getElementById('globalStopBtn');
  const loopToggle = document.getElementById('loopToggle');

  function formatTime(s){
    if(!isFinite(s)) return '0:00';
    const m = Math.floor(s/60); const sec = Math.floor(s%60).toString().padStart(2,'0');
    return `${m}:${sec}`;
  }

  playBtn.addEventListener('click', ()=>{
    if(player.paused) player.play(); else player.pause();
  });

  // global stop button: stops exclusive playback
  globalStopBtn.addEventListener('click', ()=>{
    stopExclusive();
    renderLibrary();
  });

  // loop toggle persisted in localStorage
  let loopExclusive = (localStorage.getItem('caya_loop_excl') === '1');
  function updateLoopUI(){
    player.loop = !!loopExclusive;
    if(loopExclusive) loopToggle.classList.add('active'); else loopToggle.classList.remove('active');
    loopToggle.title = loopExclusive ? 'Tekrar açık' : 'Tekrar kapalı';
  }
  loopToggle.addEventListener('click', ()=>{
    loopExclusive = !loopExclusive;
    localStorage.setItem('caya_loop_excl', loopExclusive ? '1' : '0');
    updateLoopUI();
  });
  updateLoopUI();

  player.addEventListener('play', ()=>{ playBtn.textContent = '❚❚'; });
  player.addEventListener('pause', ()=>{ playBtn.textContent = '▶'; });
  player.addEventListener('timeupdate', ()=>{
    const pct = (player.currentTime / (player.duration || 1)) * 100;
    progressFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    curTimeEl.textContent = formatTime(player.currentTime);
    totalTimeEl.textContent = formatTime(player.duration || 0);
  });
  player.addEventListener('loadedmetadata', ()=>{ totalTimeEl.textContent = formatTime(player.duration || 0); });

  progressBar.addEventListener('click', (ev)=>{
    const r = progressBar.getBoundingClientRect();
    const x = ev.clientX - r.left; const pct = x / r.width;
    player.currentTime = pct * (player.duration || 0);
  });


  await renderLibrary();
})();
