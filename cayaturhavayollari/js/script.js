document.addEventListener('DOMContentLoaded',()=>{
  // Carousel
  const prev = document.querySelector('.carousel-btn.prev');
  const next = document.querySelector('.carousel-btn.next');
  const track = document.querySelector('.carousel-track');
  let idx=0;
  const slides = track ? Array.from(track.querySelectorAll('img')) : [];
  function show(i){
    if(!track) return;
    idx=(i+slides.length)%slides.length;
    const offsets = slides.slice(0,idx).reduce((acc,img)=> acc + img.getBoundingClientRect().width + parseInt(getComputedStyle(track).gap||0), 0);
    track.style.transform = `translateX(-${offsets}px)`;
  }
  prev?.addEventListener('click',()=>show(idx-1));
  next?.addEventListener('click',()=>show(idx+1));
  setInterval(()=>show(idx+1),4500);

  // Mobile menu toggle
  const toggle = document.querySelector('.mobile-toggle');
  const nav = document.querySelector('.main-nav');
  toggle?.addEventListener('click',()=>{
    if(!nav) return;
    const visible = getComputedStyle(nav).display !== 'none';
    nav.style.display = visible ? 'none' : 'flex';
    nav.style.flexDirection = 'column';
    nav.style.gap = '10px';
  });

  // Map and markers
  const svg = document.getElementById('gta-map');
  const markers = Array.from(document.querySelectorAll('.marker'));
  const modeOriginBtn = document.getElementById('mode-origin');
  const modeDestBtn = document.getElementById('mode-dest');
  const clearBtn = document.getElementById('clear-markers');
  const reserveNow = document.getElementById('reserve-now');
  const originLabel = document.getElementById('selected-origin');
  const destLabel = document.getElementById('selected-dest');
  const routeLine = document.getElementById('route-line');

  let mode = 'origin';
  let selectedOrigin = null;
  let selectedDest = null;

  function setMode(m){
    mode = m;
    modeOriginBtn.classList.toggle('active', mode==='origin');
    modeDestBtn.classList.toggle('active', mode==='dest');
  }
  modeOriginBtn?.addEventListener('click',()=>setMode('origin'));
  modeDestBtn?.addEventListener('click',()=>setMode('dest'));

  function updateLabels(){
    originLabel.textContent = `Kalkış: ${selectedOrigin? selectedOrigin.dataset.name : 'yok'}`;
    destLabel.textContent = `Varış: ${selectedDest? selectedDest.dataset.name : 'yok'}`;
  }

  function drawRoute(){
    if(!selectedOrigin || !selectedDest){
      routeLine.setAttribute('opacity','0');
      routeLine.classList.remove('show');
      return;
    }
    const o = selectedOrigin.getCTM();
    const d = selectedDest.getCTM();
    const ox = o.e;
    const oy = o.f;
    const dx = d.e;
    const dy = d.f;
    routeLine.setAttribute('x1',ox);
    routeLine.setAttribute('y1',oy);
    routeLine.setAttribute('x2',dx);
    routeLine.setAttribute('y2',dy);
    routeLine.setAttribute('opacity','1');
    // animate stroke
    setTimeout(()=> routeLine.classList.add('show'), 40);
  }

  markers.forEach(m=>{
    m.setAttribute('tabindex',0);
    m.addEventListener('click',(ev)=>{
      // toggle selection based on mode
      if(mode==='origin'){
        if(selectedOrigin) selectedOrigin.querySelector('circle').setAttribute('stroke','#fff');
        selectedOrigin = m;
        m.querySelector('circle').setAttribute('stroke','#000');
      } else {
        if(selectedDest) selectedDest.querySelector('circle').setAttribute('stroke','#fff');
        selectedDest = m;
        m.querySelector('circle').setAttribute('stroke','#000');
      }
      updateLabels();
      drawRoute();
  });
  m.addEventListener('keydown',(e)=>{ if(e.key==='Enter' || e.key===' ') m.click(); });
    // tooltip on hover
    m.addEventListener('mouseenter',()=>{
      const tip = document.getElementById('map-tooltip');
      if(tip){ tip.textContent = m.dataset.name; tip.setAttribute('aria-hidden','false'); }
    });
    m.addEventListener('mouseleave',()=>{
      const tip = document.getElementById('map-tooltip');
      if(tip){ tip.textContent = ''; tip.setAttribute('aria-hidden','true'); }
    });
  });

  clearBtn?.addEventListener('click',()=>{
    if(selectedOrigin) selectedOrigin.querySelector('circle').setAttribute('stroke','#fff');
    if(selectedDest) selectedDest.querySelector('circle').setAttribute('stroke','#fff');
    selectedOrigin=null; selectedDest=null; updateLabels(); drawRoute();
  });

  // Reservation modal logic & storage
  const modal = document.getElementById('reserve-modal');
  const modalClose = modal?.querySelector('.modal-close');
  const modalCancel = modal?.querySelector('.modal-cancel');
  const reserveForm = document.getElementById('reserve-form');
  const bookingsList = document.getElementById('bookings-list');

  function openModal(fromName,toName,fromId,toId){
    if(!modal) return;
    modal.setAttribute('aria-hidden','false');
    modal.querySelector('input[name="from"]').value = fromName || '';
    modal.querySelector('input[name="to"]').value = toName || '';
    modal.dataset.fromId = fromId || '';
    modal.dataset.toId = toId || '';
  }
  function closeModal(){
    if(!modal) return;
    modal.setAttribute('aria-hidden','true');
    reserveForm.reset();
  }
  modalClose?.addEventListener('click',closeModal);
  modalCancel?.addEventListener('click',closeModal);

  reserveNow?.addEventListener('click',()=>{
    if(!selectedOrigin || !selectedDest){
      alert('Lütfen hem kalkış hem varış seçin.');
      return;
    }
    openModal(selectedOrigin.dataset.name, selectedDest.dataset.name, selectedOrigin.dataset.id, selectedDest.dataset.id);
  });

  // Quick reservation buttons in flight cards
  document.querySelectorAll('.card button[data-route-from]').forEach(b=>{
    b.addEventListener('click',()=>{
      const fromId = b.dataset.routeFrom;
      const toId = b.dataset.routeTo;
      const from = document.querySelector(`.marker[data-id="${fromId}"]`);
      const to = document.querySelector(`.marker[data-id="${toId}"]`);
      if(from) { if(selectedOrigin) selectedOrigin.querySelector('circle').setAttribute('stroke','#fff'); selectedOrigin = from; from.querySelector('circle').setAttribute('stroke','#000'); }
      if(to) { if(selectedDest) selectedDest.querySelector('circle').setAttribute('stroke','#fff'); selectedDest = to; to.querySelector('circle').setAttribute('stroke','#000'); }
      updateLabels(); drawRoute();
      openModal(selectedOrigin.dataset.name, selectedDest.dataset.name, selectedOrigin.dataset.id, selectedDest.dataset.id);
    });
  });

  // Bookings persistence
  function loadBookings(){
    const raw = localStorage.getItem('cayatur_bookings');
    try{
      return raw? JSON.parse(raw) : [];
    }catch(e){return []}
  }
  function saveBookings(list){ localStorage.setItem('cayatur_bookings', JSON.stringify(list)); }
  function renderBookings(){
    const list = loadBookings();
    if(!bookingsList) return;
    if(list.length===0) { bookingsList.textContent = 'Henüz kayıtlı rezervasyon yok.'; return; }
    bookingsList.innerHTML = '';
    list.forEach((b,idx)=>{
      const el = document.createElement('div'); el.className='booking';
      el.innerHTML = `<strong>${b.name}</strong> — ${b.from} → ${b.to} <span class="muted">(${new Date(b.when).toLocaleString()})</span> <button data-idx="${idx}" class="btn small ghost cancel-book">İptal</button>`;
      bookingsList.appendChild(el);
    });
    document.querySelectorAll('.cancel-book').forEach(btn=>btn.addEventListener('click',()=>{
      const idx = Number(btn.dataset.idx);
      const arr = loadBookings(); arr.splice(idx,1); saveBookings(arr); renderBookings();
    }));
  }
  renderBookings();

  // Export / Import bookings
  const exportBtn = document.getElementById('export-bookings');
  const importBtn = document.getElementById('import-bookings');
  exportBtn?.addEventListener('click',()=>{
    const data = localStorage.getItem('cayatur_bookings') || '[]';
    const blob = new Blob([data],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'cayatur_bookings.json'; a.click(); URL.revokeObjectURL(url);
  });
  importBtn?.addEventListener('click',()=>{
    const input = document.createElement('input'); input.type='file'; input.accept='application/json';
    input.onchange = ()=>{
      const f = input.files[0]; if(!f) return; const r = new FileReader(); r.onload = ()=>{ try{ const arr = JSON.parse(r.result); if(Array.isArray(arr)){ saveBookings(arr); renderBookings(); alert('İçe aktarıldı.'); } else alert('Geçersiz dosya'); } catch(e){ alert('İçeri aktarma hatası'); } }; r.readAsText(f);
    };
    input.click();
  });

  // Marker search
  const searchInput = document.getElementById('map-search');
  searchInput?.addEventListener('input',(e)=>{
    const q = e.target.value.trim().toLowerCase();
    markers.forEach(m=>{
      const name = m.dataset.name.toLowerCase();
      const visible = q === '' || name.includes(q);
      m.style.display = visible ? 'inline' : 'none';
    });
  });

  reserveForm?.addEventListener('submit',(e)=>{
    e.preventDefault();
    const fd = new FormData(reserveForm);
    const name = fd.get('name');
    const phone = fd.get('phone');
    const from = fd.get('from');
    const to = fd.get('to');
    const when = fd.get('when');
    const list = loadBookings();
    list.push({name,phone,from,to,when});
    saveBookings(list);
    renderBookings();
    closeModal();
    alert('Rezervasyon kaydedildi!');
  });

  // Accessibility: close modal on ESC
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') closeModal(); });

  // Lightbox behavior for gallery images
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = lightbox?.querySelector('img');
  const lightboxClose = lightbox?.querySelector('.lightbox-close');
  document.querySelectorAll('.carousel-track img').forEach(img=>{
    img.addEventListener('click',()=>{
      if(!lightbox || !lightboxImg) return;
      lightboxImg.src = img.src;
      lightbox.setAttribute('aria-hidden','false');
      lightbox.classList.add('show');
    });
  });
  function closeLightbox(){ if(!lightbox) return; lightbox.setAttribute('aria-hidden','true'); lightbox.classList.remove('show'); if(lightboxImg) lightboxImg.src=''; }
  lightboxClose?.addEventListener('click', closeLightbox);
  lightbox?.addEventListener('click',(e)=>{ if(e.target === lightbox) closeLightbox(); });

});
