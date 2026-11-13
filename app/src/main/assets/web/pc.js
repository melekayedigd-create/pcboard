/* BoardLink — PC page (main menu, board, video + draw) */
(() => {
  'use strict';
  const BL = window.BoardLink;
  const $ = (s) => document.querySelector(s);
  BL.mountIcons();

  const cid = 'p-' + BL.uid();
  const send = BL.createSender(cid);
  let state = { mode: 'menu', bg: 'white', videoAspect: 16 / 9, layers: { board: [], video: [] } };
  let view = 'menu';
  let tablets = 0, online = false;

  const board = new BL.Surface($('#boardSurface'));
  const annot = new BL.Surface($('#annotSurface'));
  annot.setBg('none');


  /* ------------------------------ views ------------------------------ */
  function show(name, push = true) {
    view = name;
    for (const v of ['menu', 'board', 'video']) $('#' + v).hidden = v !== name;
    state.mode = name;
    send({ t: 'mode', mode: name, videoAspect: state.videoAspect });
    if (push) history.replaceState(null, '', name === 'menu' ? '/' : '#' + name);
    if (name === 'board') layoutBoard();
    if (name === 'video') layoutAnnot();
  }
  $('#goBoard').onclick = () => show('board');
  $('#goVideo').onclick = () => show('video');
  document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); show('menu'); }));
  document.querySelectorAll('[data-fs]').forEach((b) => (b.onclick = () => {
    const el = $(b.dataset.fs);
    if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen().catch(() => {});
  }));

  /* --------------------------- connection ---------------------------- */
  function connect() {
    const es = new EventSource('/api/stream?role=pc&cid=' + cid);
    es.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      for (const ev of msg.events || []) handle(ev);
    };
    es.onerror = () => { online = false; paintStatus(); };
  }
  let first = true;
  function handle(ev) {
    switch (ev.t) {
      case 'hello':
        online = true;
        state = ev.state;
        board.setSize(BL.layerSize('board', state));
        board.setBg(state.bg);
        board.setObjects(state.layers.board);
        annot.setSize(BL.layerSize('video', state));
        annot.setObjects(state.layers.video);
        paintBg(); paintHint();
        if (first) { first = false; const h = location.hash.slice(1); show(h === 'board' || h === 'video' ? h : 'menu', false); }
        else send({ t: 'mode', mode: view, videoAspect: state.videoAspect });
        break;
      case 'presence': tablets = ev.tablets; break;
      case 'bg': state.bg = ev.value; board.setBg(ev.value); paintBg(); break;
      case 'video': remoteVideo(ev.action); break;
      default:
        if (ev.layer === 'board') { board.apply(ev); state.layers.board = board.objects; paintHint(); }
        else if (ev.layer === 'video') {
          annot.apply(ev); state.layers.video = annot.objects;
          if ((ev.t === 'begin' || ev.t === 'add') && view === 'video' && hasVideo && $('#annot').hidden) openAnnot(true);
        }
    }
    paintStatus();
  }

  function paintStatus() {
    const tab = $('#pillTab');
    const ok = online && tablets > 0;
    tab.className = 'pill ' + (ok ? 'ok' : 'bad');
    $('#tabText').textContent = ok ? `Tablet connected · ${location.hostname}`
      : online ? 'Open the BoardLink app on the tablet' : 'Tablet not reachable — check the cable / USB tethering';
    for (const id of ['#boardPill', '#videoPill']) {
      const p = $(id); p.className = 'mini-pill ' + (ok ? 'ok' : 'bad');
      p.querySelector('em').textContent = ok ? 'tablet connected' : 'tablet not connected';
    }
  }

  /* --------------------------- AI settings --------------------------- */
  const aiModal = $('#aiModal');
  async function loadAI() {
    try {
      const d = await (await fetch('/api/settings')).json();
      $('#aiKeyState').textContent = d.hasKey ? `A key is saved (${d.keyHint}). Leave empty to keep it.` : 'No key saved yet.';
      $('#aiModel').value = d.model || '';
    } catch { $('#aiKeyState').textContent = 'Tablet not reachable.'; }
  }
  $('#aiSetBtn').onclick = () => { aiModal.hidden = false; $('#aiKey').value = ''; loadAI(); setTimeout(() => $('#aiKey').focus(), 50); };
  $('#aiCancel').onclick = () => (aiModal.hidden = true);
  aiModal.addEventListener('click', (e) => { if (e.target === aiModal) aiModal.hidden = true; });
  $('#aiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { model: $('#aiModel').value.trim() };
    if ($('#aiKey').value.trim()) body.apiKey = $('#aiKey').value.trim();
    try {
      const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw 0;
      aiModal.hidden = true; toast('AI settings saved on the tablet');
    } catch { toast('Could not save — is the tablet connected?'); }
  });

  /* ------------------------------ board ------------------------------ */
  const boardStage = $('#boardStage');
  function layoutBoard() { if (view === 'board') board.fit(boardStage.clientWidth - 40, boardStage.clientHeight - 40); }
  new ResizeObserver(layoutBoard).observe(boardStage);
  function paintBg() { document.querySelectorAll('#bgSeg button').forEach((b) => b.classList.toggle('on', b.dataset.bg === state.bg)); }
  function paintHint() { $('#boardHint').hidden = board.objects.length > 0; }
  $('#bgSeg').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.bg = b.dataset.bg; board.setBg(state.bg); paintBg();
    send({ t: 'bg', value: state.bg });
  };
  $('#boardClear').onclick = () => {
    if (!board.objects.length || !confirm('Clear the whole board?')) return;
    const ev = { t: 'clear', layer: 'board' }; board.apply(ev); state.layers.board = board.objects; send(ev); paintHint();
  };
  $('#boardSave').onclick = () => download(board.composite(1.25), 'board');

  function download(canvas, name) {
    const a = document.createElement('a');
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    a.download = `boardlink-${name}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
    toast('Saved to your Downloads folder');
  }

  /* ------------------------------ video ------------------------------ */
  // A video can come from a file (offline), a direct link (.mp4/.webm) or a
  // website player (YouTube, Vimeo, Dailymotion, Google Drive) shown in a frame.
  const vid = $('#vid'), vstage = $('#videoStage'), frame = $('#vframe');
  let hasVideo = false, videoUrl = null;
  let src = null;            // { kind: 'file' | 'url' | 'yt' | 'vimeo' | 'embed', ... }
  let fPaused = true, fTime = 0, fListen = null; // state of website players

  function resetVideo() {
    if (videoUrl) { URL.revokeObjectURL(videoUrl); videoUrl = null; }
    vid.pause(); vid.removeAttribute('src'); vid.removeAttribute('crossorigin'); vid.load(); vid.hidden = true;
    frame.src = 'about:blank'; frame.hidden = true;
    clearInterval(fListen); fPaused = true; fTime = 0;
  }
  function showSource(name) {
    $('#drop').hidden = true; $('#annotBtn').hidden = false;
    $('#videoName').textContent = name; $('#videoName').title = name;
    hasVideo = true;
  }
  function setAspect(a) {
    state.videoAspect = a;
    annot.setSize(BL.layerSize('video', state));
    send({ t: 'mode', mode: view, videoAspect: state.videoAspect });
    layoutFrame(); layoutAnnot();
  }

  function loadVideo(file) {
    if (!file) return;
    const okType = (file.type || '').startsWith('video/') || /\.(mp4|webm|mkv|mov|m4v|ogv|ogg|avi)$/i.test(file.name);
    if (!okType) { toast('That file is not a video'); return; }
    resetVideo();
    videoUrl = URL.createObjectURL(file);
    src = { kind: 'file' };
    vid.src = videoUrl; vid.hidden = false;
    showSource(file.name);
    vid.play().catch(() => {});
  }
  for (const id of ['#videoInput', '#videoInput2']) $(id).addEventListener('change', (e) => { loadVideo(e.target.files[0]); e.target.value = ''; });

  /* ---- links ---- */
  function seconds(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return +t;
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  }
  function parseLink(raw) {
    let s = (raw || '').trim();
    if (!s) return null;
    const ifr = /<iframe[^>]+src=["']([^"']+)["']/i.exec(s); if (ifr) s = ifr[1]; // pasted embed code
    if (s.startsWith('//')) s = 'https:' + s;
    if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
    let u; try { u = new URL(s); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    const parts = u.pathname.split('/').filter(Boolean);
    const start = seconds(u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([\dhms]+)/) || [])[1]);
    const ytId = (id) => (/^[\w-]{11}$/.test(id || '') ? id : null);

    if (host === 'youtu.be') { const id = ytId(parts[0]); if (id) return { kind: 'yt', id, start, short: false, url: s }; }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      let id = ytId(u.searchParams.get('v')), short = false;
      if (!id && ['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) { id = ytId(parts[1]); short = parts[0] === 'shorts'; }
      if (id) return { kind: 'yt', id, start, short, url: s };
      return { error: 'This YouTube link is not a single video. Open the video and copy its link.' };
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const i = parts.findIndex((x) => /^\d+$/.test(x));
      if (i >= 0) {
        const h = u.searchParams.get('h') || (/^[0-9a-f]{6,}$/i.test(parts[i + 1] || '') ? parts[i + 1] : '');
        return { kind: 'vimeo', id: parts[i], h, start, url: s };
      }
    }
    if (host === 'dailymotion.com' && parts[0] === 'video' && parts[1]) return { kind: 'embed', name: 'Dailymotion', url: s, embed: `https://www.dailymotion.com/embed/video/${parts[1].split('_')[0]}?autoplay=1` };
    if (host === 'dai.ly' && parts[0]) return { kind: 'embed', name: 'Dailymotion', url: s, embed: `https://www.dailymotion.com/embed/video/${parts[0]}?autoplay=1` };
    if (host === 'drive.google.com') {
      const id = (parts[0] === 'file' && parts[1] === 'd' && parts[2]) || u.searchParams.get('id');
      if (id) return { kind: 'embed', name: 'Google Drive video', url: s, embed: `https://drive.google.com/file/d/${id}/preview` };
    }
    return { kind: 'url', url: u.href, name: decodeURIComponent(parts[parts.length - 1] || u.hostname) };
  }

  function loadLink(raw) {
    const L = parseLink(raw);
    if (!L) { toast('That does not look like a link'); return; }
    if (L.error) { toast(L.error); return; }
    if (view !== 'video') show('video');
    resetVideo();
    src = L;
    $('#linkInput').value = L.url; $('#linkInput2').value = '';
    if (L.kind === 'url') {
      // try with CORS first (so "Save a picture" can include the frame), then without
      L.cors = true;
      vid.crossOrigin = 'anonymous';
      vid.src = L.url; vid.hidden = false;
      showSource(L.name);
      vid.play().catch(() => {});
      remember(L.url, L.name);
      return;
    }
    let url;
    if (L.kind === 'yt') {
      const q = new URLSearchParams({ enablejsapi: '1', autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', origin: location.origin });
      if (L.start) q.set('start', L.start);
      url = `https://www.youtube.com/embed/${L.id}?${q}`;
      L.name = 'YouTube video';
    } else if (L.kind === 'vimeo') {
      const q = new URLSearchParams({ autoplay: '1', playsinline: '1', dnt: '1' });
      if (L.h) q.set('h', L.h);
      url = `https://player.vimeo.com/video/${L.id}?${q}` + (L.start ? `#t=${L.start}s` : '');
      L.name = 'Vimeo video';
    } else url = L.embed;
    frame.hidden = false;
    frame.src = url;
    showSource(L.name);
    setAspect(L.short ? 9 / 16 : 16 / 9);
    fetchTitle(L);
    remember(L.url, L.name);
    if (L.kind === 'embed') toast(`${L.name}: use the player's own buttons to play / pause`);
  }

  // Ask the site for the video title (just for the label). Fails quietly.
  async function fetchTitle(L) {
    const api = L.kind === 'yt' ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent('https://www.youtube.com/watch?v=' + L.id)}`
      : L.kind === 'vimeo' ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(L.url)}` : null;
    if (!api) return;
    try {
      const d = await (await fetch(api)).json();
      if (d && d.title && src === L) { L.name = d.title; showSource(d.title); remember(L.url, d.title); }
      if (d && d.width && d.height && src === L && L.kind === 'vimeo') setAspect(d.width / d.height);
    } catch {}
  }

  for (const [f, i] of [['#linkForm', '#linkInput'], ['#linkForm2', '#linkInput2']]) {
    $(f).addEventListener('submit', (e) => { e.preventDefault(); loadLink($(i).value); $(i).blur(); });
  }
  // Ctrl+V anywhere on the video screen plays a copied link
  document.addEventListener('paste', (e) => {
    if (view !== 'video' || e.target.matches('input, textarea')) return;
    const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (/^\s*(https?:\/\/|www\.|youtu)/i.test(t)) { e.preventDefault(); loadLink(t); }
  });

  /* ---- recent links (kept in this browser) ---- */
  const RKEY = 'boardlink.recentLinks';
  function recent() { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch { return []; } }
  function remember(url, name) {
    const list = [{ url, name }, ...recent().filter((r) => r.url !== url)].slice(0, 6);
    try { localStorage.setItem(RKEY, JSON.stringify(list)); } catch {}
    paintRecent();
  }
  function paintRecent() {
    const box = $('#recent'), list = recent();
    box.querySelectorAll('button').forEach((b) => b.remove());
    box.hidden = !list.length;
    for (const r of list) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = r.name || r.url; b.title = r.url;
      b.onclick = () => loadLink(r.url);
      box.append(b);
    }
  }
  paintRecent();

  /* ---- drag & drop: a file or a link ---- */
  vstage.addEventListener('dragover', (e) => { e.preventDefault(); vstage.classList.add('dragging'); });
  vstage.addEventListener('dragleave', (e) => { if (e.target === vstage) vstage.classList.remove('dragging'); });
  vstage.addEventListener('drop', (e) => {
    e.preventDefault(); vstage.classList.remove('dragging');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { loadVideo(f); return; }
    const t = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (t) loadLink(t.split('\n')[0]);
  });

  /* ---- <video> (files and direct links) ---- */
  vid.addEventListener('loadedmetadata', () => {
    if (vid.videoWidth && vid.videoHeight) setAspect(vid.videoWidth / vid.videoHeight);
    layoutAnnot();
  });
  vid.addEventListener('error', () => {
    if (vid.hidden || !vid.getAttribute('src')) return;
    if (src && src.kind === 'url' && src.cors) { // the site refuses CORS: try again plainly
      src.cors = false; vid.removeAttribute('crossorigin'); vid.src = src.url; vid.play().catch(() => {}); return;
    }
    toast(src && src.kind === 'url'
      ? 'This link is not a playable video. Use a YouTube / Vimeo link or a direct link ending in .mp4 or .webm.'
      : 'Chrome cannot play this video format. Try MP4 (H.264) or WebM.');
  });
  vid.addEventListener('play', () => { send({ t: 'vstate', playing: true }); paintPlay(); });
  vid.addEventListener('pause', () => { send({ t: 'vstate', playing: false }); paintPlay(); });

  /* ---- website players (YouTube / Vimeo talk through postMessage) ---- */
  const isFrame = () => src && (src.kind === 'yt' || src.kind === 'vimeo' || src.kind === 'embed');
  function ytCmd(func, args = []) { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*'); } catch {} }
  function vmCmd(method, value) { try { frame.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), 'https://player.vimeo.com'); } catch {} }
  frame.addEventListener('load', () => {
    if (!src || frame.hidden) return;
    clearInterval(fListen);
    if (src.kind === 'yt') {
      let n = 0; // YouTube only reports its state after we say we are listening
      const hi = () => { try { frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); } catch {} };
      hi(); fListen = setInterval(() => (++n > 20 ? clearInterval(fListen) : hi()), 500);
    }
    if (src.kind === 'vimeo') for (const ev of ['play', 'pause', 'ended', 'timeupdate']) vmCmd('addEventListener', ev);
  });
  function framePlaying(playing) {
    if (fPaused === !playing) return;
    fPaused = !playing; paintPlay(); send({ t: 'vstate', playing });
  }
  window.addEventListener('message', (e) => {
    if (!src || e.source !== frame.contentWindow) return;
    let d = e.data; if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
    if (!d || typeof d !== 'object') return;
    if (src.kind === 'yt') {
      clearInterval(fListen);
      const info = d.info;
      if (d.event === 'onStateChange' && typeof info === 'number') { if (info === 1) framePlaying(true); else if (info === 2 || info === 0) framePlaying(false); }
      if (d.event === 'infoDelivery' && info && typeof info === 'object') {
        if (typeof info.currentTime === 'number') fTime = info.currentTime;
        if (info.playerState === 1) framePlaying(true); else if (info.playerState === 2 || info.playerState === 0) framePlaying(false);
      }
      if (d.event === 'onError') toast('YouTube will not play this video here (the owner turned off embedding). Try another link.');
    } else if (src.kind === 'vimeo') {
      if (d.event === 'ready') for (const ev of ['play', 'pause', 'ended', 'timeupdate']) vmCmd('addEventListener', ev);
      if (d.event === 'play') framePlaying(true);
      if (d.event === 'pause' || d.event === 'ended') framePlaying(false);
      if (d.event === 'timeupdate' && d.data) fTime = d.data.seconds || fTime;
    }
  });

  /* ---- one set of controls for every kind of video ---- */
  const isPaused = () => (isFrame() ? fPaused : vid.paused);
  function paintPlay() { const b = $('#abPlay'); b.innerHTML = BL.icon(isPaused() ? 'play' : 'pause'); }
  $('#abPlay').onclick = () => remoteVideo('toggle');
  function remoteVideo(action) {
    if (!hasVideo || !src) return;
    if (src.kind === 'embed') { toast(`${src.name}: use the player's own buttons`); return; }
    if (src.kind === 'yt') {
      if (action === 'toggle') { ytCmd(fPaused ? 'playVideo' : 'pauseVideo'); framePlaying(fPaused); }
      else { fTime = Math.max(0, fTime + (action === 'back' ? -10 : 10)); ytCmd('seekTo', [fTime, true]); }
      return;
    }
    if (src.kind === 'vimeo') {
      if (action === 'toggle') { vmCmd(fPaused ? 'play' : 'pause'); framePlaying(fPaused); }
      else { fTime = Math.max(0, fTime + (action === 'back' ? -10 : 10)); vmCmd('setCurrentTime', fTime); }
      return;
    }
    if (action === 'toggle') vid.paused ? vid.play().catch(() => {}) : vid.pause();
    else if (action === 'back') vid.currentTime = Math.max(0, vid.currentTime - 10);
    else if (action === 'fwd') vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
  }

  /* -------------------------- drawing window ------------------------- */
  const annotEl = $('#annot'), annotBody = $('#annotBody');
  let annotMode = 'over'; // "over" = on top of the video, "win" = floating window
  function openAnnot(auto) {
    annotEl.hidden = false; $('#annotBar').hidden = false; $('#annotBtn').classList.add('on');
    layoutAnnot();
    if (auto) toast('Drawing from the tablet — drawing window opened');
    else if (isFrame() && annotMode === 'over') toast('Drawing over the video. Close the drawing (or press D) to click the player again.');
  }
  function closeAnnot() { annotEl.hidden = true; $('#annotBar').hidden = true; $('#annotBtn').classList.remove('on'); }
  $('#annotBtn').onclick = () => (annotEl.hidden ? openAnnot() : closeAnnot());
  $('#abClose').onclick = closeAnnot;
  $('#abMode').onclick = () => {
    annotMode = annotMode === 'over' ? 'win' : 'over';
    annotEl.className = 'annot ' + annotMode;
    if (annotMode === 'win') {
      const sr = vstage.getBoundingClientRect();
      annotEl.style.width = '520px'; annotEl.style.height = '330px';
      annotEl.style.left = Math.max(10, sr.width - 620) + 'px'; annotEl.style.top = Math.max(70, sr.height - 440) + 'px';
      annot.setBg('white');
      toast('Floating window: the video keeps playing behind it');
    } else { annot.setBg('none'); toast('Drawing directly over the video'); }
    layoutAnnot();
  };
  function videoRect() {
    const sw = vstage.clientWidth, sh = vstage.clientHeight;
    const a = (!isFrame() && vid.videoWidth && vid.videoHeight) ? vid.videoWidth / vid.videoHeight : (state.videoAspect || 16 / 9);
    const k = Math.min(sw / a, sh);
    const w = a * k, h = k;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
  }
  function layoutFrame() {
    if (frame.hidden) return;
    const r = videoRect();
    Object.assign(frame.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }
  new ResizeObserver(layoutFrame).observe(vstage);
  function layoutAnnot() {
    if (view !== 'video' || annotEl.hidden) return;
    if (annotMode === 'over') {
      const r = videoRect();
      Object.assign(annotEl.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      annot.fit(r.w, r.h);
    } else {
      annot.fit(annotBody.clientWidth, annotBody.clientHeight);
    }
  }
  new ResizeObserver(layoutAnnot).observe(vstage);
  new ResizeObserver(() => { if (annotMode === 'win') layoutAnnot(); }).observe(annotEl);

  // drag the floating window
  (() => {
    const head = $('#annotHead'); let d = null;
    head.addEventListener('pointerdown', (e) => {
      const r = annotEl.getBoundingClientRect();
      d = { id: e.pointerId, ox: e.clientX - r.left, oy: e.clientY - r.top, sr: vstage.getBoundingClientRect() };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!d || d.id !== e.pointerId) return;
      const x = Math.min(Math.max(0, e.clientX - d.sr.left - d.ox), d.sr.width - 80);
      const y = Math.min(Math.max(0, e.clientY - d.sr.top - d.oy), d.sr.height - 40);
      annotEl.style.left = x + 'px'; annotEl.style.top = y + 'px';
    });
    head.addEventListener('pointerup', () => (d = null));
  })();

  // PC drawing tools (mouse / pen tablet on the PC)
  const PCOL = ['#e5383b', '#fcbf49', '#2a9d8f', '#1d4ed8', '#ffffff', '#1b1b1f'];
  const PSIZE = { pen: [3, 6, 12], highlighter: [18, 30, 46], eraser: [20, 44, 90] };
  const ptool = { name: 'pen', color: PCOL[0], sizeIdx: 1 };
  const mine = [];
  PCOL.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'ab-sw'; b.style.background = c; b.dataset.c = c; b.title = c;
    b.onclick = () => { ptool.color = c; if (ptool.name === 'eraser') setPTool('pen'); paintPTools(); };
    $('#abColors').append(b);
  });
  [0, 1, 2].forEach((i) => {
    const b = document.createElement('button');
    b.className = 'ab-size'; b.innerHTML = `<i style="width:${5 + i * 5}px;height:${5 + i * 5}px"></i>`;
    b.onclick = () => { ptool.sizeIdx = i; paintPTools(); };
    $('#abSizes').append(b);
  });
  document.querySelectorAll('[data-ptool]').forEach((b) => (b.onclick = () => setPTool(b.dataset.ptool)));
  function setPTool(n) { ptool.name = n; paintPTools(); }
  function paintPTools() {
    document.querySelectorAll('[data-ptool]').forEach((b) => b.classList.toggle('on', b.dataset.ptool === ptool.name));
    document.querySelectorAll('.ab-sw').forEach((b) => b.classList.toggle('on', b.dataset.c === ptool.color));
    document.querySelectorAll('.ab-size').forEach((b, i) => b.classList.toggle('on', i === ptool.sizeIdx));
  }
  paintPTools();

  let drawing = null;
  const r1 = (v) => Math.round(v * 10) / 10;
  annot.ink.addEventListener('pointerdown', (e) => {
    if (drawing || e.button > 0) return;
    e.preventDefault();
    annot.ink.setPointerCapture(e.pointerId);
    const rect = annot.ink.getBoundingClientRect();
    const [x, y] = annot.toVirtual(e.clientX, e.clientY, rect);
    const id = BL.uid();
    const p = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;
    const obj = { id, type: 'stroke', tool: ptool.name, color: ptool.color, size: PSIZE[ptool.name][ptool.sizeIdx], pts: [r1(x), r1(y), p] };
    const ev = { t: 'begin', layer: 'video', obj };
    annot.apply(ev); send(ev);
    drawing = { id, pointerId: e.pointerId, rect, lx: x, ly: y };
  });
  annot.ink.addEventListener('pointermove', (e) => {
    if (!drawing || e.pointerId !== drawing.pointerId) return;
    const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    const pts = [];
    for (const ce of list) {
      const [x, y] = annot.toVirtual(ce.clientX, ce.clientY, drawing.rect);
      if (Math.hypot(x - drawing.lx, y - drawing.ly) < 1.2) continue;
      pts.push(r1(x), r1(y), ce.pointerType === 'pen' ? Math.round((ce.pressure || 0.5) * 100) / 100 : 0.5);
      drawing.lx = x; drawing.ly = y;
    }
    if (pts.length) { const ev = { t: 'pts', layer: 'video', id: drawing.id, pts }; annot.apply(ev); send(ev); }
  });
  const endDraw = (e) => {
    if (!drawing || e.pointerId !== drawing.pointerId) return;
    const ev = { t: 'end', layer: 'video', id: drawing.id };
    annot.apply(ev); send(ev); mine.push(drawing.id); drawing = null;
    state.layers.video = annot.objects;
  };
  annot.ink.addEventListener('pointerup', endDraw);
  annot.ink.addEventListener('pointercancel', endDraw);

  $('#abUndo').onclick = () => {
    while (mine.length) {
      const id = mine.pop();
      if (annot.get(id)) { const ev = { t: 'remove', layer: 'video', id }; annot.apply(ev); send(ev); return; }
    }
    toast('Nothing to undo here (use Undo on the tablet for tablet drawings)');
  };
  $('#abClear').onclick = () => {
    if (!annot.objects.length) return;
    const ev = { t: 'clear', layer: 'video' }; annot.apply(ev); state.layers.video = annot.objects; send(ev);
  };
  $('#abShot').onclick = () => {
    if (!hasVideo) return;
    const drawingOnly = () => {
      download(annot.composite(Math.max(1, 1600 / annot.size.w), annotMode === 'win' ? 'white' : 'none'), 'drawing');
      toast('Websites do not let Chrome copy their video picture — saved your drawing only');
    };
    if (isFrame() || !vid.videoWidth) { drawingOnly(); return; }
    const W = Math.min(vid.videoWidth, 1920), H = Math.round(W * vid.videoHeight / vid.videoWidth);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(vid, 0, 0, W, H);
    ctx.drawImage(annot.composite(W / annot.size.w, 'none'), 0, 0, W, H);
    try { c.toDataURL('image/png'); } catch { drawingOnly(); return; }
    download(c, 'video-frame');
  };

  /* ------------------------------ misc ------------------------------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (view === 'video' && hasVideo) {
      if (e.code === 'Space' && e.target !== vid) { e.preventDefault(); remoteVideo('toggle'); }
      if (e.key.toLowerCase() === 'd') annotEl.hidden ? openAnnot() : closeAnnot();
    }
    if (e.key === 'Escape' && !aiModal.hidden) { aiModal.hidden = true; return; }
    if (e.key === 'Escape' && !document.fullscreenElement && view !== 'menu' && annotEl.hidden) show('menu');
  });
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  paintStatus();
  connect();
})();
