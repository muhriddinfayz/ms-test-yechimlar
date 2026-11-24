// On the GitHub Pages site a deck opens for visitors only if the owner listed it in visible.json
// (managed from boshqaruv.html). The owner's own device (token saved there) opens every deck.
// Local files and the single-file tablet copies are never gated.
(function(){
  if (!/\.github\.io$/.test(location.hostname)) return;
  const m = decodeURIComponent(location.pathname).match(/(Fizika_MS_TEST|Matematika_MOCK)_(\d+)_prezentatsiya/);
  if (!m) return;
  try { if (localStorage.getItem('msOwnerToken')) return; } catch (e) {}
  const code = m[1][0] + m[2];
  const root = document.documentElement;
  root.style.visibility = 'hidden';
  function closed(){
    document.body.innerHTML =
      '<div style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'gap:18px;background:#0B1B3A;color:#fff;font:600 22px/1.4 Segoe UI,Roboto,system-ui,sans-serif;text-align:center;padding:24px;z-index:2147483647">' +
      '<div style="font-size:54px">🔒</div><div>Bu prezentatsiya hozircha yopiq.</div>' +
      '<a href="./" style="color:#0B1B3A;background:#FFC531;padding:12px 26px;border-radius:12px;text-decoration:none;font-weight:800">Bosh sahifa</a></div>';
    root.style.visibility = '';
  }
  fetch('visible.json?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(v => { if ((v.visible || []).indexOf(code) >= 0) root.style.visibility = ''; else closed(); })
    .catch(closed);
})();

// Pen / annotation layer: draw on slides while recording.
// Strokes are kept per slide (in stage coordinates 1920x1080) and redrawn when you come back.
window.Annot = (function(){
  const COLORS = [
    { c: '#E5322D', name: 'Qizil' },
    { c: '#1155CC', name: 'Ko‘k' },
    { c: '#0F9D58', name: 'Yashil' },
    { c: '#1B2638', name: 'Qora' },
    { c: '#FFC93C', name: 'Marker', marker: true },
  ];
  const WIDTH = { thin: 5, thick: 11 };
  const stage = document.getElementById('stage');
  let active = false, tool = 'pen', colorIx = 0, widthKey = 'thin';
  let slide = 0, drawing = null;
  const strokes = {};                       // slide index -> [{c, w, a, pts:[[x,y,p]...]}]
  const list = () => (strokes[slide] = strokes[slide] || []);

  // ---------- DOM ----------
  const cv = document.createElement('canvas');
  cv.id = 'annot-canvas';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');

  const ICON = {
    pen: '<svg viewBox="0 0 24 24"><path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5z"/><path d="M13.5 7l3.5 3.5"/></svg>',
    thin: '<svg viewBox="0 0 24 24"><path d="M5 17C9 9 14 15 19 7" style="stroke-width:1.6"/></svg>',
    thick: '<svg viewBox="0 0 24 24"><path d="M5 17C9 9 14 15 19 7" style="stroke-width:4"/></svg>',
    eraser: '<svg viewBox="0 0 24 24"><path d="M8 20h12"/><path d="M4.5 14.5l9-9 6 6-7.5 7.5H9z"/><path d="M9 10l6 6"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/></svg>',
    clear: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>',
    fsOn: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/></svg>',
    fsOff: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/></svg>',
  };
  const ui = document.createElement('div');
  ui.id = 'annot-ui';
  ui.innerHTML =
    '<button id="an-fs" title="To‘liq ekran (F)">' + ICON.fsOn + '</button>' +
    '<button id="an-toggle" title="Ruchka — chizish (D)">' + ICON.pen + '</button>' +
    '<div id="an-panel">' +
      COLORS.map((o, i) => '<button class="an-c" data-i="' + i + '" title="' + o.name + ' (' + (i + 1) + ')" style="--c:' + o.c + '"></button>').join('') +
      '<span class="an-sep"></span>' +
      '<button class="an-w" data-w="thin" title="Ingichka">' + ICON.thin + '</button>' +
      '<button class="an-w" data-w="thick" title="Qalin">' + ICON.thick + '</button>' +
      '<span class="an-sep"></span>' +
      '<button id="an-eraser" title="O‘chirg‘ich (E)">' + ICON.eraser + '</button>' +
      '<button id="an-undo" title="Orqaga (Z)">' + ICON.undo + '</button>' +
      '<button id="an-clear" title="Slaydni tozalash (C)">' + ICON.clear + '</button>' +
    '</div>';
  document.body.appendChild(ui);

  // ---------- geometry ----------
  function view(){
    const r = stage.getBoundingClientRect();
    return { k: r.width / 1920, x: r.left, y: r.top };
  }
  function toStage(e){
    const v = view();
    return [(e.clientX - v.x) / v.k, (e.clientY - v.y) / v.k];
  }
  function resize(w, h){
    const vv = window.visualViewport, de = document.documentElement;
    w = w || (vv ? vv.width : de.clientWidth || innerWidth);
    h = h || (vv ? vv.height : de.clientHeight || innerHeight);
    const d = window.devicePixelRatio || 1;
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    redraw();
  }

  // ---------- drawing ----------
  function paint(s){
    const p = s.pts;
    if (!p.length) return;
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
    ctx.globalAlpha = s.a; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (p.length === 1){
      ctx.beginPath(); ctx.arc(p[0][0], p[0][1], s.w * p[0][2] / 2, 0, Math.PI * 2); ctx.fill();
    } else if (s.pressure){
      for (let i = 1; i < p.length; i++){
        ctx.lineWidth = s.w * (p[i - 1][2] + p[i][2]) / 2;
        ctx.beginPath(); ctx.moveTo(p[i - 1][0], p[i - 1][1]); ctx.lineTo(p[i][0], p[i][1]); ctx.stroke();
      }
    } else {
      ctx.lineWidth = s.w;
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++){
        const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      const l = p[p.length - 1]; ctx.lineTo(l[0], l[1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function redraw(){
    const d = window.devicePixelRatio || 1, v = view();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.setTransform(d * v.k, 0, 0, d * v.k, d * v.x, d * v.y);
    for (const s of list()) paint(s);
    if (drawing && !drawing.erasing) paint(drawing);
  }
  function eraseAt(x, y){
    const L = list(), R = 22;
    for (let i = L.length - 1; i >= 0; i--){
      if (L[i].pts.some(q => Math.hypot(q[0] - x, q[1] - y) < R + L[i].w / 2)) L.splice(i, 1);
    }
    redraw();
  }

  cv.addEventListener('pointerdown', e => {
    if (!active || e.button === 2) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const [x, y] = toStage(e);
    if (tool === 'eraser'){ drawing = { erasing: true }; eraseAt(x, y); return; }
    const o = COLORS[colorIx], pen = e.pointerType === 'pen';
    drawing = { c: o.c, a: o.marker ? 0.38 : 1, w: o.marker ? 30 : WIDTH[widthKey],
                pressure: pen && !o.marker, pts: [[x, y, pen && !o.marker ? 0.4 + (e.pressure || 0.5) * 1.2 : 1]] };
    redraw();
  });
  cv.addEventListener('pointermove', e => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]){
      const [x, y] = toStage(ev);
      if (drawing.erasing){ eraseAt(x, y); continue; }
      drawing.pts.push([x, y, drawing.pressure ? 0.4 + (ev.pressure || 0.5) * 1.2 : 1]);
    }
    if (!drawing.erasing) redraw();
  });
  function finish(){
    if (drawing && !drawing.erasing && drawing.pts.length) list().push(drawing);
    drawing = null; redraw();
  }
  cv.addEventListener('pointerup', finish);
  cv.addEventListener('pointercancel', finish);
  cv.addEventListener('contextmenu', e => { e.preventDefault(); if (active) undo(); });

  // ---------- state / UI ----------
  function cursorFor(){
    if (tool === 'eraser') return 'cell';
    const o = COLORS[colorIx], r = o.marker ? 9 : 5;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="' + r +
                '" fill="' + o.c + '" fill-opacity="' + (o.marker ? 0.6 : 1) + '" stroke="white" stroke-width="1.5"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '") 12 12, crosshair';
  }
  function sync(){
    document.body.classList.toggle('drawing', active);
    ui.classList.toggle('on', active);
    ui.querySelectorAll('.an-c').forEach(b => b.classList.toggle('sel', tool === 'pen' && +b.dataset.i === colorIx));
    ui.querySelectorAll('.an-w').forEach(b => b.classList.toggle('sel', b.dataset.w === widthKey));
    ui.querySelector('#an-eraser').classList.toggle('sel', tool === 'eraser');
    cv.style.cursor = active ? cursorFor() : '';
  }
  function setActive(v){ active = v; if (!v) finish(); if (v) document.body.classList.remove('nocursor'); sync(); }
  const de = document.documentElement;
  const fsSupported = !!(de.requestFullscreen || de.webkitRequestFullscreen);
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFullscreen(){
    if (fsElement()){
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (de.requestFullscreen){
      const r = de.requestFullscreen({ navigationUI: 'hide' }); if (r && r.catch) r.catch(() => {});
    } else if (de.webkitRequestFullscreen){
      de.webkitRequestFullscreen();
    }
  }
  if (!fsSupported) ui.querySelector('#an-fs').style.display = 'none';
  function syncFs(){
    const on = !!fsElement(), b = ui.querySelector('#an-fs');
    b.innerHTML = on ? ICON.fsOff : ICON.fsOn;
    b.title = on ? 'To‘liq ekrandan chiqish (F / Esc)' : 'To‘liq ekran (F)';
  }
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);
  function undo(){ list().pop(); redraw(); }
  function clear(){ strokes[slide] = []; redraw(); }

  ui.addEventListener('click', e => {
    e.stopPropagation();
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'an-fs') toggleFullscreen();
    else if (b.id === 'an-toggle') setActive(!active);
    else if (b.classList.contains('an-c')){ colorIx = +b.dataset.i; tool = 'pen'; setActive(true); }
    else if (b.classList.contains('an-w')){ widthKey = b.dataset.w; tool = 'pen'; setActive(true); }
    else if (b.id === 'an-eraser'){ tool = tool === 'eraser' ? 'pen' : 'eraser'; setActive(true); }
    else if (b.id === 'an-undo') undo();
    else if (b.id === 'an-clear') clear();
  });
  ui.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
  ui.addEventListener('pointerdown', e => e.stopPropagation());

  function handleKey(e){
    const k = e.key;
    if (e.ctrlKey || e.metaKey){
      if (active && (k === 'z' || k === 'Z')){ e.preventDefault(); undo(); return true; }
      return false;
    }
    if (k === 'd' || k === 'D'){ setActive(!active); return true; }
    if (!active) return false;
    if (k === 'Escape'){ setActive(false); return true; }
    if (k === 'z' || k === 'Z'){ undo(); return true; }
    if (k === 'c' || k === 'C'){ clear(); return true; }
    if (k === 'e' || k === 'E'){ tool = tool === 'eraser' ? 'pen' : 'eraser'; sync(); return true; }
    if (k >= '1' && k <= String(COLORS.length)){ colorIx = +k - 1; tool = 'pen'; sync(); return true; }
    return false;
  }

  resize(); sync();
  return {
    get active(){ return active; },
    setSlide(n){ finish(); slide = n; redraw(); },
    handleKey,
    redraw,
    resize,
    toggleFullscreen,
  };
})();

(function(){
  const stage = document.getElementById('stage');
  const MAXB = 1080 - 40;            // lowest allowed content edge on a 1920x1080 slide
  const PROB_MAXW = 1584, PROB_MAXH = 740;

  // ---------- responsive fit: scale the 1920x1080 stage into the visible window ----------
  // (visualViewport, not innerWidth: tablets enlarge innerWidth when content is wider than the screen)
  function viewSize(){
    const vv = window.visualViewport, de = document.documentElement;
    return [vv ? vv.width : (de.clientWidth || innerWidth), vv ? vv.height : (de.clientHeight || innerHeight)];
  }
  function fit(){
    const [w, h] = viewSize(), k = Math.min(w / 1920, h / 1080);
    stage.style.transform = 'translate(' + (w - 1920 * k) / 2 + 'px,' + (h - 1080 * k) / 2 + 'px) scale(' + k + ')';
    if (window.Annot) Annot.resize(w, h);
  }
  fit();
  ['resize', 'orientationchange'].forEach(ev => addEventListener(ev, () => { fit(); setTimeout(fit, 300); }));
  if (window.visualViewport) visualViewport.addEventListener('resize', fit);
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => setTimeout(fit, 60)));

  function bottomOf(sec){
    let m = 0;
    for (const c of sec.children){
      if (c.classList.contains('kicker') || c.classList.contains('handle')) continue;
      m = Math.max(m, c.offsetTop + c.offsetHeight);
    }
    return m;
  }
  function sizeImg(img, s){
    img.style.width = Math.round(+img.dataset.w * s) + 'px';
    img.style.height = Math.round(+img.dataset.h * s) + 'px';
  }

  // one slide if statement + solution fit; otherwise statement slide + solution slide(s)
  function layoutOne(sec){
    const img = sec.querySelector('.pcard img');
    const fig = sec.querySelector('.fig > img, .fig > svg');
    sec.classList.add('measure');
    let fw = 0, fh = 0;
    if (fig){ const r = fig.getBoundingClientRect(); fw = fig.offsetWidth || r.width; fh = fig.offsetHeight || r.height; }
    const sizeFig = (k) => { if (fig && fw){ fig.style.width = Math.round(fw * k) + 'px'; fig.style.height = Math.round(fh * k) + 'px'; } };
    // [statement scale, figure scale]
    for (const [s, k] of [[1, 1], [0.9, 1], [0.9, 0.8], [0.82, 0.7]]){
      sizeImg(img, s); sizeFig(k);
      if (bottomOf(sec) <= MAXB){ sec.classList.remove('measure'); return; }
    }
    sizeFig(1);
    sec.classList.remove('measure');
    split(sec, img);
  }

  function split(sec, img){
    const label = sec.dataset.label;
    const head = sec.querySelector('.kicker').outerHTML + sec.querySelector('.handle').outerHTML;
    const prob = document.createElement('section');
    prob.className = 'prob'; prob.setAttribute('data-transition', 'fade');
    prob.innerHTML = head + '<div class="ph"><p class="badge">' + label + '</p><p class="ph-hint">Shartni diqqat bilan o‘qing</p></div>';
    prob.appendChild(sec.querySelector('.pcard'));
    sizeImg(img, Math.min(PROB_MAXW / +img.dataset.w, PROB_MAXH / +img.dataset.h));
    stage.insertBefore(prob, sec);

    const steps = Array.from(sec.querySelectorAll('.steps > .step'));
    const fig = sec.querySelector('.fig'), ans = sec.querySelector('.answer');
    let i = 0, first = true;
    while (true){
      const sol = document.createElement('section');
      sol.className = 'sol'; sol.setAttribute('data-transition', 'fade');
      sol.innerHTML = head + '<h2 class="st">' + label + ' — yechim' + (first ? '' : ' <span class="cont">(davomi)</span>') +
                      '</h2><div class="body"><div class="steps"></div></div>';
      const body = sol.querySelector('.body'), list = sol.querySelector('.steps');
      if (first && fig) body.appendChild(fig);
      stage.insertBefore(sol, sec);
      sol.classList.add('measure');
      let placed = 0;
      while (i < steps.length){
        list.appendChild(steps[i]);
        if (bottomOf(sol) > MAXB && placed > 0){ list.removeChild(steps[i]); break; }
        i++; placed++;
      }
      if (i >= steps.length){
        sol.appendChild(ans);
        if (bottomOf(sol) > MAXB && placed > 1){
          sol.removeChild(ans); i--; list.removeChild(steps[i]);
          sol.classList.remove('measure'); first = false; continue;
        }
        sol.classList.remove('measure'); break;
      }
      sol.classList.remove('measure'); first = false;
    }
    sec.remove();
  }

  function startNav(){
    const S = Array.from(stage.children);
    const hud = document.getElementById('hud'), help = document.getElementById('help');
    let i = 0, hudT = 0, curT = 0;
    function frags(s){
      const f = Array.from(s.querySelectorAll('.fragment'));
      return f.map((el,k)=>({el,k,ix: el.hasAttribute('data-fragment-index') ? +el.getAttribute('data-fragment-index') : 1e6}))
              .sort((a,b)=>a.ix-b.ix || a.k-b.k).map(o=>o.el);
    }
    function mark(s){
      const f = frags(s); f.forEach(e=>e.classList.remove('current-fragment'));
      const v = f.filter(e=>e.classList.contains('visible'));
      if (v.length) v[v.length-1].classList.add('current-fragment');
    }
    function showHud(){
      hud.textContent = (i+1) + ' / ' + S.length;
      hud.classList.add('show'); clearTimeout(hudT); hudT = setTimeout(()=>hud.classList.remove('show'), 1200);
    }
    function go(n, allVisible, fromIdx){
      n = Math.max(0, Math.min(S.length-1, n));
      const prev = S[fromIdx==null ? i : fromIdx];
      S.forEach(s=>s.classList.remove('active','enter-fade'));
      const s = S[n];
      frags(s).forEach(e=>e.classList.toggle('visible', !!allVisible));
      mark(s);
      if (prev && prev !== s && prev.getAttribute('data-transition')) s.classList.add('enter-fade');
      void s.offsetWidth; s.classList.add('active');
      i = n; history.replaceState(null, '', '#' + (n+1)); showHud();
      if (window.Annot) Annot.setSlide(n);
    }
    function next(){
      const f = frags(S[i]).filter(e=>!e.classList.contains('visible'));
      if (f.length){ f[0].classList.add('visible'); mark(S[i]); return; }
      if (i < S.length-1) go(i+1, false);
    }
    function prev(){
      const v = frags(S[i]).filter(e=>e.classList.contains('visible'));
      if (v.length){ v[v.length-1].classList.remove('visible'); mark(S[i]); return; }
      if (i > 0) go(i-1, true);
    }
    addEventListener('keydown', e=>{
      const k = e.key;
      if (k==='Escape' && help.classList.contains('show')) { help.classList.remove('show'); return; }
      if (window.Annot && Annot.handleKey(e)) { e.preventDefault(); return; }
      if (['ArrowRight','ArrowDown',' ','PageDown','Enter','n','N'].includes(k)) { e.preventDefault(); next(); }
      else if (['ArrowLeft','ArrowUp','PageUp','Backspace','p','P'].includes(k)) { e.preventDefault(); prev(); }
      else if (k==='Home') go(0,false);
      else if (k==='End') go(S.length-1,false);
      else if (k==='f' || k==='F') { if (window.Annot) Annot.toggleFullscreen(); }
      else if (k==='r' || k==='R') go(i,false);
      else if (k==='h' || k==='H' || k==='?') help.classList.toggle('show');
      else if (k==='Escape') help.classList.remove('show');
    });
    const penBusy = e => window.Annot && (Annot.active || (e.target.closest && e.target.closest('#annot-ui')));
    addEventListener('click', e=>{ if (e.button===0 && !penBusy(e)) next(); });
    addEventListener('contextmenu', e=>{ e.preventDefault(); if (!penBusy(e)) prev(); });
    // tablets: swipe left / right changes the step / slide (tap still advances)
    let tx = null, ty = 0;
    addEventListener('touchstart', e=>{
      if (e.touches.length !== 1 || penBusy(e)) { tx = null; return; }
      tx = e.touches[0].clientX; ty = e.touches[0].clientY;
    }, { passive: true });
    addEventListener('touchend', e=>{
      if (tx === null) return;
      const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty; tx = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) { if (dx < 0) next(); else prev(); }
    }, { passive: true });
    addEventListener('mousemove', ()=>{
      document.body.classList.remove('nocursor'); clearTimeout(curT);
      curT = setTimeout(()=>{ if (!(window.Annot && Annot.active)) document.body.classList.add('nocursor'); }, 1500);
    });
    fit();
    const h = parseInt(location.hash.slice(1)); go(isNaN(h) ? 0 : h-1, false, -1);
    document.body.dataset.ready = '1';
  }

  // formulas are stored as TeX (<span class="m"> inline, <span class="md"> display) and rendered here
  function renderMath(){
    if (!window.katex) return;
    document.querySelectorAll('.m, .md').forEach(el => {
      try {
        katex.render(el.textContent, el, { displayMode: el.classList.contains('md'), throwOnError: false, strict: 'ignore' });
      } catch (e) { /* leave the TeX text visible */ }
    });
  }
  renderMath();

  // load every font first so measurements are exact, then lay out and start
  Promise.all(Array.from(document.fonts).map(f => f.load().catch(()=>null)))
    .then(() => document.fonts.ready)
    .then(() => {
      if (!document.body.contains(stage)) return;     // deck closed by gate.js
      Array.from(stage.querySelectorAll('section.combo')).forEach(layoutOne); startNav();
    });
})();
