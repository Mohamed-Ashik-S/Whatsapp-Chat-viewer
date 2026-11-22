(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var PAGE = 300;

  var chats = [];          // loaded chats
  var cur = null;          // open chat
  var lo = 0, hi = 0;      // rendered message window [lo, hi)
  var query = '';
  var matches = [], matchPos = -1;
  var dbOk = false;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function reEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function uid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  function initial(s) { var t = (s || '?').trim(); return (t.charAt(0) || '?').toUpperCase(); }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDay(ts) { return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  function fmtShort(ts) { return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' }); }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function baseName(p) { return String(p).split('/').pop().toLowerCase(); }

  var toastTimer = 0;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 4000);
  }

  /* ---------- storage (IndexedDB, optional) ---------- */
  var DB = {
    db: null,
    open: function () {
      return new Promise(function (resolve) {
        try {
          var req = indexedDB.open('chat-archive', 1);
          req.onupgradeneeded = function () { req.result.createObjectStore('chats', { keyPath: 'id' }); };
          req.onsuccess = function () { DB.db = req.result; dbOk = true; resolve(true); };
          req.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    },
    tx: function (mode, fn) {
      return new Promise(function (resolve, reject) {
        try {
          var t = DB.db.transaction('chats', mode);
          var store = t.objectStore('chats');
          var r = fn(store);
          t.oncomplete = function () { resolve(r && r.result); };
          t.onerror = t.onabort = function () { reject(t.error); };
        } catch (e) { reject(e); }
      });
    },
    all: function () { return dbOk ? DB.tx('readonly', function (s) { return s.getAll(); }) : Promise.resolve([]); },
    put: function (rec) { return dbOk ? DB.tx('readwrite', function (s) { return s.put(rec); }) : Promise.resolve(); },
    del: function (id) { return dbOk ? DB.tx('readwrite', function (s) { return s.delete(id); }) : Promise.resolve(); }
  };

  /* ---------- loading an export ---------- */
  function readText(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(r.error || new Error('Could not read file')); };
      r.readAsText(blob);
    });
  }

  function isZip(name, blob) { return /\.zip$/i.test(name) || blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed'; }

  async function extract(blob, fileName) {
    if (!isZip(fileName, blob)) return { text: await readText(blob), media: new Map() };
    var zip = await JSZip.loadAsync(blob);
    var txtEntries = [], media = new Map();
    zip.forEach(function (path, entry) {
      if (entry.dir) return;
      if (/\.txt$/i.test(path)) txtEntries.push(entry);
      else media.set(baseName(path), entry);
    });
    if (!txtEntries.length) throw new Error('No chat text file found inside the zip.');
    var best = txtEntries.find(function (e) { return /(^|\/)_chat\.txt$/i.test(e.name); }) || txtEntries[0];
    return { text: await best.async('string'), media: media };
  }

  function build(rec, text, media) {
    var parsed = WAParser.parse(text, { order: rec.meta.order });
    if (!parsed.messages.length) throw new Error('No WhatsApp messages found in this file.');
    var title = WAParser.titleFromFilename(rec.fileName);
    var c = {
      id: rec.id, fileName: rec.fileName, size: rec.size, blob: rec.blob, meta: rec.meta,
      title: title, messages: parsed.messages, senders: parsed.senders, order: parsed.order,
      media: media, urls: new Map(), added: rec.added
    };
    if (!c.meta.me) {
      var other = parsed.senders.filter(function (s) { return title && s.toLowerCase() === title.toLowerCase(); })[0];
      var mine = parsed.senders.filter(function (s) { return s !== other; })[0];
      c.meta.me = mine || parsed.senders[1] || parsed.senders[0] || '';
    }
    return c;
  }

  function otherName(c) {
    if (c.title) return c.title;
    var o = c.senders.filter(function (s) { return s !== c.meta.me; })[0];
    return o || c.senders[0] || 'Chat';
  }

  async function importFile(file) {
    var ex = await extract(file, file.name);
    var existing = chats.filter(function (c) { return c.fileName === file.name && c.size === file.size; })[0];
    var rec = {
      id: existing ? existing.id : uid(), fileName: file.name, size: file.size, blob: file,
      meta: existing ? existing.meta : {}, added: Date.now()
    };
    var c = build(rec, ex.text, ex.media);
    if (existing) chats[chats.indexOf(existing)] = c; else chats.push(c);
    try { await DB.put({ id: c.id, fileName: c.fileName, size: c.size, blob: c.blob, meta: c.meta, added: c.added }); }
    catch (e) { toast('Added, but it could not be saved for next time.'); }
    return c;
  }

  async function importFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var last = null, ok = 0;
    for (var i = 0; i < list.length; i++) {
      try { last = await importFile(list[i]); ok++; }
      catch (e) { toast('Could not open ' + list[i].name + ': ' + (e && e.message ? e.message : 'unknown error')); }
    }
    renderList();
    if (ok === 1 && last) openChat(last.id);
    else if (ok > 1) toast(ok + ' chats added.');
  }

  async function restore() {
    await DB.open();
    var recs = [];
    try { recs = await DB.all(); } catch (e) { recs = []; }
    recs.sort(function (a, b) { return (a.added || 0) - (b.added || 0); });
    for (var i = 0; i < recs.length; i++) {
      try {
        var ex = await extract(recs[i].blob, recs[i].fileName);
        chats.push(build(recs[i], ex.text, ex.media));
      } catch (e) { /* skip unreadable record */ }
    }
    renderList();
  }

  /* ---------- chat list ---------- */
  function lastReal(c) {
    for (var i = c.messages.length - 1; i >= 0; i--) if (!c.messages[i].system) return c.messages[i];
    return c.messages[c.messages.length - 1];
  }
  function preview(m) {
    if (!m) return '';
    if (m.media) return m.text ? m.text.split('\n')[0] : 'Media';
    return m.text.split('\n')[0];
  }

  function renderList() {
    var el = $('list');
    $('empty').hidden = chats.length > 0;
    var sorted = chats.slice().sort(function (a, b) { return lastReal(b).ts - lastReal(a).ts; });
    el.innerHTML = sorted.map(function (c) {
      var nm = otherName(c), m = lastReal(c);
      return '<button class="row' + (cur && cur.id === c.id ? ' active' : '') + '" type="button" data-id="' + esc(c.id) + '">' +
        '<div class="avatar" style="background:hsl(' + hue(nm) + ' 45% 42%)">' + esc(initial(nm)) + '</div>' +
        '<div class="meta"><div class="top"><span class="nm">' + esc(nm) + '</span><span class="dt">' + esc(fmtShort(m.ts)) + '</span></div>' +
        '<div class="pv">' + esc(preview(m)) + '</div></div></button>';
    }).join('');
  }

  /* ---------- chat view ---------- */
  function openChat(id) {
    var c = chats.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    cur = c;
    query = ''; matches = []; matchPos = -1;
    $('q').value = ''; $('hits').textContent = ''; $('searchBar').hidden = true;
    var nm = otherName(c);
    $('chatAvatar').textContent = initial(nm);
    $('chatAvatar').style.background = 'hsl(' + hue(nm) + ' 45% 42%)';
    $('chatName').textContent = nm;
    $('chatSub').textContent = c.messages.length.toLocaleString() + ' messages, ' + fmtShort(c.messages[0].ts) + ' to ' + fmtShort(c.messages[c.messages.length - 1].ts);
    $('chatbar').hidden = false; $('placeholder').hidden = true; $('msgs').hidden = false;
    document.body.classList.add('chat-open');
    hi = c.messages.length; lo = Math.max(0, hi - PAGE);
    renderMsgs();
    $('msgs').scrollTop = $('msgs').scrollHeight;
    renderList();
  }

  function closeChat() {
    document.body.classList.remove('chat-open');
    if (window.matchMedia('(max-width: 799px)').matches) {
      cur = null;
      $('chatbar').hidden = true; $('msgs').hidden = true; $('placeholder').hidden = false;
      renderList();
    }
  }

  function fmt(text) {
    var re = query ? new RegExp('(' + reEsc(query) + ')', 'ig') : null;
    function hl(s) {
      var e = esc(s);
      if (!re) return e;
      return s.split(re).map(function (part, i) { return i % 2 ? '<mark>' + esc(part) + '</mark>' : esc(part); }).join('');
    }
    var out = '', last = 0, m, url = /https?:\/\/[^\s<]+/gi;
    while ((m = url.exec(text))) {
      out += hl(text.slice(last, m.index));
      var u = m[0].replace(/[).,;!?]+$/, '');
      out += '<a href="' + esc(u) + '" rel="noopener">' + hl(u) + '</a>';
      last = m.index + u.length;
      url.lastIndex = last;
    }
    return out + hl(text.slice(last));
  }

  function kindOf(name) {
    var ext = (name.split('.').pop() || '').toLowerCase();
    if (/^(jpe?g|png|webp|gif|bmp|heic)$/.test(ext)) return 'image';
    if (/^(mp4|3gp|mov|webm|mkv)$/.test(ext)) return 'video';
    if (/^(opus|ogg|m4a|mp3|aac|wav|amr)$/.test(ext)) return 'audio';
    return 'file';
  }

  function mediaHtml(c, m) {
    if (!m.media) return '';
    var f = m.media.file;
    if (f && c.media.has(baseName(f))) return '<div class="media" data-file="' + esc(f) + '"></div>';
    return '<div class="chip">' + (f ? 'Not included: ' + esc(f) : 'Media not included') + '</div>';
  }

  function renderMsgs() {
    var c = cur, out = [], lastDay = '', group = c.senders.length > 2;
    if (lo > 0) out.push('<button class="more" type="button" data-act="earlier">Load earlier messages (' + lo.toLocaleString() + ' more)</button>');
    for (var i = lo; i < hi; i++) {
      var m = c.messages[i], dk = dayKey(m.ts);
      if (dk !== lastDay) { out.push('<div class="day"><span>' + esc(fmtDay(m.ts)) + '</span></div>'); lastDay = dk; }
      if (m.system) { out.push('<div class="sys" data-i="' + i + '">' + fmt(m.text) + '</div>'); continue; }
      var mine = m.sender === c.meta.me;
      out.push('<div class="msg ' + (mine ? 'me' : 'them') + '" data-i="' + i + '"><div class="bub">' +
        (group && !mine ? '<div class="who">' + esc(m.sender) + '</div>' : '') +
        mediaHtml(c, m) +
        (m.text ? '<div class="t">' + fmt(m.text) + '</div>' : '') +
        '<span class="tm">' + esc(fmtTime(m.ts)) + '</span></div></div>');
    }
    if (hi < c.messages.length) out.push('<button class="more" type="button" data-act="later">Load later messages (' + (c.messages.length - hi).toLocaleString() + ' more)</button>');
    $('msgs').innerHTML = out.join('');
    hydrate();
  }

  /* lazy media: only decode files that scroll into view */
  var io = null;
  function hydrate() {
    var nodes = $('msgs').querySelectorAll('.media[data-file]');
    if (!('IntersectionObserver' in window)) { Array.prototype.forEach.call(nodes, loadMedia); return; }
    if (io) io.disconnect();
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { io.unobserve(en.target); loadMedia(en.target); } });
    }, { root: $('msgs'), rootMargin: '400px' });
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
  }

  async function mediaUrl(c, file) {
    var key = baseName(file);
    if (c.urls.has(key)) return c.urls.get(key);
    var entry = c.media.get(key);
    if (!entry) return null;
    var kind = kindOf(file), ext = (file.split('.').pop() || '').toLowerCase();
    var mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
      mp4: 'video/mp4', '3gp': 'video/3gpp', mov: 'video/quicktime', webm: 'video/webm',
      opus: 'audio/ogg', ogg: 'audio/ogg', m4a: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', wav: 'audio/wav' }[ext] || '';
    var blob = await entry.async('blob');
    var url = URL.createObjectURL(mime ? new Blob([blob], { type: mime }) : blob);
    c.urls.set(key, url);
    return kind === 'file' ? null : url;
  }

  async function loadMedia(node) {
    var file = node.getAttribute('data-file'), c = cur;
    if (!c || node.firstChild) return;
    var kind = kindOf(file);
    if (kind === 'file') { node.innerHTML = '<div class="chip">Attachment: ' + esc(file) + '</div>'; return; }
    try {
      var url = await mediaUrl(c, file);
      if (!url || cur !== c) return;
      var el = document.createElement(kind === 'image' ? 'img' : kind);
      el.src = url;
      if (kind === 'image') { el.loading = 'lazy'; el.alt = file; }
      else { el.controls = true; el.preload = 'metadata'; if (kind === 'video') el.setAttribute('playsinline', ''); }
      node.appendChild(el);
    } catch (e) { node.innerHTML = '<div class="chip">Could not load ' + esc(file) + '</div>'; }
  }

  /* ---------- search and jump ---------- */
  function ensureVisible(idx) {
    if (idx >= lo && idx < hi) return;
    lo = Math.max(0, idx - 100); hi = Math.min(cur.messages.length, idx + 200);
    renderMsgs();
  }
  function goTo(idx, flash) {
    ensureVisible(idx);
    var box = $('msgs'), el = box.querySelector('[data-i="' + idx + '"]');
    if (!el) return;
    var prev = box.querySelector('.hit'); if (prev) prev.classList.remove('hit');
    if (flash) el.classList.add('hit');
    box.scrollTop = el.offsetTop - box.clientHeight / 3;
  }

  function runSearch() {
    query = $('q').value.trim();
    matches = []; matchPos = -1;
    if (query && cur) {
      var q = query.toLowerCase();
      for (var i = 0; i < cur.messages.length; i++) {
        var m = cur.messages[i];
        if (m.text.toLowerCase().indexOf(q) !== -1 || (m.media && m.media.file && m.media.file.toLowerCase().indexOf(q) !== -1)) matches.push(i);
      }
    }
    $('hits').textContent = query ? (matches.length ? '0/' + matches.length : 'None') : '';
    renderMsgs();
    if (matches.length) stepMatch(-1);
  }
  function stepMatch(dir) {
    if (!matches.length) return;
    matchPos = matchPos < 0 ? (dir < 0 ? matches.length - 1 : 0) : (matchPos + dir + matches.length) % matches.length;
    $('hits').textContent = (matchPos + 1) + '/' + matches.length;
    goTo(matches[matchPos], true);
  }
  function jumpToDate(value) {
    if (!value || !cur) return;
    var p = value.split('-'), t = new Date(+p[0], +p[1] - 1, +p[2]).getTime(), msgs = cur.messages, idx = -1;
    for (var i = 0; i < msgs.length; i++) if (msgs[i].ts >= t) { idx = i; break; }
    if (idx < 0) { toast('No messages on or after that date.'); return; }
    goTo(idx, true);
  }

  /* ---------- options sheet ---------- */
  function openSheet(title, buttons, note) {
    $('sheetTitle').textContent = title;
    var body = $('sheetBody'); body.innerHTML = '';
    buttons.forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn' + (b.danger ? ' danger' : ''); btn.textContent = b.label;
      btn.addEventListener('click', function () { closeSheet(); b.run(); });
      body.appendChild(btn);
    });
    if (note) { var p = document.createElement('div'); p.className = 'note'; p.textContent = note; body.appendChild(p); }
    $('sheetWrap').hidden = false;
  }
  function closeSheet() { $('sheetWrap').hidden = true; }

  function chatMenu() {
    if (!cur) return;
    var c = cur;
    var orderLabel = { dmy: 'day/month', mdy: 'month/day', ymd: 'year first' }[c.order];
    openSheet(otherName(c), [
      { label: 'Swap sides (messages you sent show on the right)', run: function () {
          var o = c.senders.filter(function (s) { return s !== c.meta.me; })[0];
          if (o) { c.meta.me = o; persist(c); renderMsgs(); $('msgs').scrollTop = $('msgs').scrollHeight; }
        } },
      { label: 'Dates look wrong? Switch to ' + (c.order === 'mdy' ? 'day/month' : 'month/day'), run: function () { reorder(c, c.order === 'mdy' ? 'dmy' : 'mdy'); } },
      { label: 'Remove this chat from the app', danger: true, run: function () { removeChat(c); } }
    ], 'Date order in use: ' + orderLabel + '. Removing a chat only deletes the copy inside this app, not your original file.');
  }

  async function reorder(c, order) {
    try {
      c.meta.order = order;
      var ex = await extract(c.blob, c.fileName);
      var n = build({ id: c.id, fileName: c.fileName, size: c.size, blob: c.blob, meta: c.meta, added: c.added }, ex.text, ex.media);
      chats[chats.indexOf(c)] = n; cur = n;
      persist(n); openChat(n.id);
    } catch (e) { toast('Could not re-read this chat.'); }
  }
  function persist(c) {
    DB.put({ id: c.id, fileName: c.fileName, size: c.size, blob: c.blob, meta: c.meta, added: c.added }).catch(function () { /* ignore */ });
  }
  async function removeChat(c) {
    c.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
    chats = chats.filter(function (x) { return x !== c; });
    try { await DB.del(c.id); } catch (e) { /* ignore */ }
    cur = null;
    $('chatbar').hidden = true; $('msgs').hidden = true; $('placeholder').hidden = false;
    document.body.classList.remove('chat-open');
    renderList();
  }

  /* ---------- wiring ---------- */
  $('addBtn').addEventListener('click', function () { $('picker').value = ''; $('picker').click(); });
  $('picker').addEventListener('change', function (e) { importFiles(e.target.files); });
  $('list').addEventListener('click', function (e) {
    var row = e.target.closest('.row'); if (row) openChat(row.getAttribute('data-id'));
  });
  $('backBtn').addEventListener('click', closeChat);
  $('menuBtn').addEventListener('click', chatMenu);
  $('sheetClose').addEventListener('click', closeSheet);
  $('sheetWrap').addEventListener('click', function (e) { if (e.target === $('sheetWrap')) closeSheet(); });
  $('searchBtn').addEventListener('click', function () {
    var bar = $('searchBar'); bar.hidden = !bar.hidden;
    if (!bar.hidden) $('q').focus();
    else { $('q').value = ''; runSearch(); }
  });
  var searchTimer = 0;
  $('q').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 250); });
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); stepMatch(e.shiftKey ? -1 : 1); } });
  $('nextHit').addEventListener('click', function () { stepMatch(1); });
  $('prevHit').addEventListener('click', function () { stepMatch(-1); });
  $('jumpDate').addEventListener('change', function (e) { jumpToDate(e.target.value); });
  $('msgs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b || !cur) return;
    var box = $('msgs'), before = box.scrollHeight;
    if (b.getAttribute('data-act') === 'earlier') {
      lo = Math.max(0, lo - PAGE); renderMsgs(); box.scrollTop += box.scrollHeight - before;
    } else { hi = Math.min(cur.messages.length, hi + PAGE); renderMsgs(); }
  });

  // Drag and drop (desktop browsers)
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files) importFiles(e.dataTransfer.files);
  });

  // Called by the Android shell when the back button is pressed. True means handled.
  window.__back = function () {
    if (!$('sheetWrap').hidden) { closeSheet(); return true; }
    if (!$('searchBar').hidden) { $('searchBar').hidden = true; $('q').value = ''; runSearch(); return true; }
    if (document.body.classList.contains('chat-open') && window.matchMedia('(max-width: 799px)').matches) { closeChat(); return true; }
    return false;
  };

  renderList();
  restore().catch(function () { toast('Saved chats could not be loaded.'); });
})();
