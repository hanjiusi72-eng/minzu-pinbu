/* 民族拼布图鉴 · 前端交互（含编辑模式） */
(function () {
  'use strict';
  const DATA = window.DATA;
  const GROUPS = DATA.groups;
  const byId = {};
  GROUPS.forEach(g => { g.itemById = {}; g.items.forEach(it => { byId[it.id] = { g, it }; g.itemById[it.id] = it; }); });
  const baseTitle = {};   // id -> 原始标题（回收站恢复用）
  const baseGroup = {};   // id -> group
  GROUPS.forEach(g => g.items.forEach(it => { baseTitle[it.id] = it.title; baseGroup[it.id] = g; }));
  // thumb -> 原图路径（编辑覆盖层里存的旧图路径可能已因换图失效，按 thumb 映射修正）
  const SRC_BY_THUMB = {};
  GROUPS.forEach(g => g.items.forEach(it => it.images.forEach(im => { if (im.thumb) SRC_BY_THUMB[im.thumb] = im.src; })));

  const app = document.getElementById('app');
  const viewer = document.getElementById('viewer');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* 页内确认 / 输入对话框（替代原生 confirm/prompt，避免阻塞与误触） */
  function miniModal(html) {
    return new Promise(res => {
      const d = document.createElement('div');
      d.className = 'mini-modal';
      d.innerHTML = `<div class="mini-box">${html}</div>`;
      document.body.appendChild(d);
      const done = v => { d.remove(); res(v); };
      d.querySelectorAll('[data-mm]').forEach(b =>
        b.addEventListener('click', () => {
          const inp = d.querySelector('.mini-input');
          done(b.dataset.mm === 'ok' ? (inp ? inp.value : true) : (inp ? null : false));
        }));
      const inp = d.querySelector('.mini-input');
      if (inp) { inp.focus(); inp.select(); inp.addEventListener('keydown', e => { if (e.key === 'Enter') d.querySelector('[data-mm="ok"]').click(); }); }
    });
  }
  const showConfirm = msg => miniModal(`<p class="mini-msg">${esc(msg)}</p><div class="mini-btns"><button class="mb danger" data-mm="ok">确定</button><button class="mb" data-mm="no">取消</button></div>`);
  const showPrompt = (msg, val) => miniModal(`<p class="mini-msg">${esc(msg)}</p><input class="mini-input" value="${esc(val == null ? '' : val)}"><div class="mini-btns"><button class="mb ok" data-mm="ok">确定</button><button class="mb" data-mm="no">取消</button></div>`);
  const EDITABLE = ['title', 'subtitle', 'code', 'note', 'meta', 'body', 'captions', 'images'];
  const pick = it => { const o = {}; EDITABLE.forEach(k => { o[k] = it[k]; }); return o; };

  /* ================= 编辑覆盖层 ================= */
  const OVR_KEY = 'minzu-pinbu-overrides-v1';
  let OVR = { items: {}, deleted: [], savedAt: 0 };
  let serverSave = false;
  let editMode = false;
  let saveTimer = null;

  async function loadOverrides() {
    // 托管版本（GitHub Pages / ?readonly=1）为纯静态只读：隐藏编辑入口
    if (/(^|\.)github\.io$/.test(location.hostname) || new URLSearchParams(location.search).has('readonly'))
      document.body.classList.add('readonly');
    try {
      const info = await fetch('/api/info', { cache: 'no-store' });
      if (info.ok) { const o = await info.json(); if (o && o.readonly) document.body.classList.add('readonly'); }
    } catch (e) { /* file:// 或旧版服务器：无此接口 */ }
    try {
      const ls = localStorage.getItem(OVR_KEY);
      if (ls) { const o = JSON.parse(ls); if ((o.savedAt || 0) > OVR.savedAt) OVR = o; }
    } catch (e) { /* ignore */ }
    try {
      const r = await fetch('js/overrides.json', { cache: 'no-store' });
      if (r.ok) {
        const o = await r.json();
        if ((o.savedAt || 0) >= OVR.savedAt) { OVR = o; serverSave = true; }
      }
    } catch (e) { /* file:// 或无文件：仅用本地 */ }
    applyOverrides();
  }

  function applyOverrides() {
    for (const g of GROUPS) {
      g.items = g.items.filter(it => !OVR.deleted.includes(it.id));
      g.items.forEach(it => {
        const p = OVR.items[it.id];
        if (p) {
          for (const k of EDITABLE) if (p[k] !== undefined) it[k] = p[k];
          if (p.images) it.images.forEach(im => { const s = SRC_BY_THUMB[im.thumb]; if (s) im.src = s; });
        }
      });
      g.itemById = {};
      g.items.forEach(it => { g.itemById[it.id] = it; });
      g.atlas.categories.forEach(c => { c.ids = c.ids.filter(id => g.itemById[id]); });
      (g.chapters || []).forEach(ch => {
        if (ch.image_items) ch.image_items = ch.image_items.filter(id => g.itemById[id]);
      });
      g.stats.items = g.items.length;
      g.stats.images = g.items.reduce((a, it) => a + it.images.length, 0);
    }
  }

  function record(it) { OVR.items[it.id] = pick(it); scheduleSave(); }

  function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 450); }

  async function saveNow() {
    OVR.savedAt = Date.now();
    let localOk = true, remoteOk = null;
    try { localStorage.setItem(OVR_KEY, JSON.stringify(OVR)); } catch (e) { localOk = false; }
    try {
      const r = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(OVR),
      });
      remoteOk = r.ok;
      if (remoteOk) serverSave = true;
    } catch (e) { remoteOk = null; }
    setSaveStatus(localOk && remoteOk !== false);
  }

  function setSaveStatus(ok) {
    let el = document.getElementById('saveStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'saveStatus';
      document.body.appendChild(el);
    }
    el.textContent = ok
      ? (serverSave ? '✓ 已保存（本地 + 服务器）' : '✓ 已保存到本地浏览器')
      : '✗ 保存失败';
    el.classList.toggle('err', !ok);
    el.classList.add('show');
    clearTimeout(setSaveStatus._t);
    setSaveStatus._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  async function removeItem(g, id) {
    const ok = await showConfirm('确定删除该条目吗？可在编辑模式的「回收站」中恢复。');
    if (!ok) return;
    if (!OVR.deleted.includes(id)) OVR.deleted.push(id);
    g.items = g.items.filter(it => it.id !== id);
    delete g.itemById[id];
    g.stats.items = g.items.length;
    g.stats.images = g.items.reduce((a, it) => a + it.images.length, 0);
    g.atlas.categories.forEach(c => { c.ids = c.ids.filter(x => x !== id); });
    (g.chapters || []).forEach(ch => { if (ch.image_items) ch.image_items = ch.image_items.filter(x => x !== id); });
    scheduleSave();
    closeViewer();
    rerenderCurrent();
  }

  function restoreItem(id) {
    OVR.deleted = OVR.deleted.filter(x => x !== id);
    delete OVR.items[id];
    const g = baseGroup[id];
    if (g) {
      const orig = byId[id] && byId[id].it;
      if (orig && !g.items.some(x => x.id === id)) {
        g.items.push(orig);
        g.itemById[id] = orig;
        g.stats.items = g.items.length;
        g.stats.images = g.items.reduce((a, it) => a + it.images.length, 0);
        g.atlas.categories.forEach(c => {
          if (orig.tags.some(t => t === c.key)) c.ids.push(id);
        });
      }
    }
    scheduleSave();
    rerenderCurrent();
  }

  /* ================= 路由 ================= */
  let currentTab = 'works';
  let currentGroup = null;
  function route() {
    closeViewer();
    const h = location.hash || '#/';
    const m = h.match(/^#\/g\/(\w+)(?:\/(\w+))?/);
    if (m) {
      const g = GROUPS.find(x => x.id === m[1]);
      if (g) { currentGroup = g; currentTab = m[2] || 'works'; renderGroup(g, currentTab); return; }
    }
    currentGroup = null;
    renderHome();
  }
  function rerenderCurrent() {
    if (currentGroup) renderGroup(currentGroup, currentTab);
    else renderHome();
  }
  window.addEventListener('hashchange', route);

  /* ================= 编辑模式开关 ================= */
  function toggleEdit() {
    editMode = !editMode;
    document.body.classList.toggle('editmode', editMode);
    rerenderCurrent();
    const btn = document.getElementById('editToggle');
    if (btn) {
      btn.textContent = editMode ? '✓ 完成编辑' : '✎ 编辑模式';
      btn.classList.toggle('on', editMode);
    }
  }

  /* ================= 首页 ================= */
  function coverOf(g) {
    const cat = g.atlas.categories.find(c => c.key === 'back') || g.atlas.categories[0];
    const pick = (cat && g.itemById[cat.ids[0]]) || g.items.find(it => it.images[0]) || g.items[0];
    return pick && pick.images[0];
  }
  function renderHome() {
    document.title = '民族拼布图鉴 · 七民族拼布/布贴/背扇影像档案';
    const totalItems = GROUPS.reduce((a, g) => a + g.stats.items, 0);
    const totalImgs = GROUPS.reduce((a, g) => a + g.stats.images, 0);
    const cards = GROUPS.map((g, i) => {
      const cov = coverOf(g);
      return `<div class="gcard" data-g="${g.id}" style="--g-accent:${g.accent}">
        <div class="cover">${cov ? `<img src="${cov.thumb}" alt="${esc(g.name)}">` : ''}
          <span class="num">0${i + 1}</span></div>
        <div class="bar" style="background:${g.accent}"></div>
        <div class="info">
          <h3>${esc(g.name)}拼布<small>${esc(g.region)}</small></h3>
          <p>${esc(g.intro)}</p>
          <div class="meta"><span>藏品 <b>${g.stats.items}</b> 件</span><span>影像 <b>${g.stats.images}</b> 幅</span></div>
        </div>
      </div>`;
    }).join('');
    app.innerHTML = `
      <div class="quilt-strip">${'<span></span>'.repeat(8)}</div>
      <div class="topbar"><div class="topbar-in">
        <div class="brand"><span class="mark"></span>民族拼布图鉴</div>
        <div class="crumb">七个民族 · 拼布 / 布贴 / 背扇影像档案</div>
        <div class="spacer"></div>
        <button class="edit-btn" id="editToggle">${editMode ? '✓ 完成编辑' : '✎ 编辑模式'}</button>
      </div></div>
      <header class="hero">
        <h1>百衲 · 千纹</h1>
        <div class="sub">苗 · 侗 · 壮 · 水 · 白 · 汉 · 毛南 —— 七民族拼布工艺影像档案</div>
        <p class="lede">这里整理归档了七个民族的拼布相关影像与考据：点开一个民族即可逐件浏览藏品照片，双击照片可直达原始著录页面；每个民族还配有「拼布图谱」——按品类归档图像、梳理工艺特点，并结合馆藏著录与文献加以阐释。</p>
        <div class="stitch"></div>
        <div class="hero-stats">
          <div><b>${GROUPS.length}</b>民族</div>
          <div><b>${totalItems}</b>藏品条目</div>
          <div><b>${totalImgs}</b>影像</div>
        </div>
      </header>
      <main class="group-grid">${cards}</main>
      <div class="about"><div class="panel">
        <h4>使用说明</h4>
        点击民族卡片进入其档案页 → 「藏品」标签下可按品类筛选、逐件翻看照片；<b>双击照片</b>即打开照片的来源网页（馆藏著录页 / 文献页）；「图谱」标签汇集该民族拼布 · 布贴 · 背扇的品类归类、专题章节（工艺流程、纹样体系、特征对比表）与文献来源。<br>
        <b>✎ 编辑模式</b>：可编辑标题 / 说明 / 分析文字与图片名称、删除单张图片或整个条目（删除内容可在回收站恢复），修改自动保存。
      </div></div>
      <footer>本页由「民族拼布」系列 PPT（共七册、约四百页）整理构建 · 影像版权归原作者与各著录机构所有<br>仅用于学习与研究 · 检索整理日期 2026-10 ~ 2026-11</footer>
    `;
    app.querySelectorAll('.gcard').forEach(el =>
      el.addEventListener('click', () => { location.hash = '#/g/' + el.dataset.g; }));
    document.getElementById('editToggle').addEventListener('click', toggleEdit);
  }

  /* ================= 民族页 ================= */
  function renderGroup(g, tab) {
    document.title = g.name + '拼布 · 民族拼布图鉴';
    app.innerHTML = `
      <div class="quilt-strip">${'<span></span>'.repeat(8)}</div>
      <div class="topbar"><div class="topbar-in">
        <div class="brand" id="homeBtn"><span class="mark"></span>民族拼布图鉴</div>
        <div class="crumb">/ ${esc(g.name)}拼布</div>
        <div class="spacer"></div>
        ${editMode ? `<span class="crumb recycle-info" id="recycleInfo">回收站 ${OVR.deleted.filter(id => baseGroup[id] && baseGroup[id].id === g.id).length} 件</span>` : ''}
        <button class="edit-btn" id="editToggle">${editMode ? '✓ 完成编辑' : '✎ 编辑模式'}</button>
        <button class="back-btn" id="backBtn">← 返回总览</button>
      </div></div>
      <header class="ghead" style="--g-accent:${g.accent};--g-soft:${g.accent2}22">
        <div class="ghead-in">
          <span class="tag">${esc(g.region)}</span>
          <h2>${esc(g.name)}<span>拼布</span></h2>
          <p class="intro">${esc(g.intro)}</p>
          <div class="gtabs">
            <button data-tab="works" class="${tab === 'works' ? 'on' : ''}">藏品浏览<span class="cnt">${g.stats.items}</span></button>
            <button data-tab="atlas" class="${tab === 'atlas' ? 'on' : ''}">拼布图谱</button>
          </div>
        </div>
      </header>
      <main id="gmain"></main>
      <footer>影像版权归原作者与各著录机构所有 · 仅用于学习与研究</footer>
    `;
    document.getElementById('homeBtn').addEventListener('click', () => { location.hash = '#/'; });
    document.getElementById('backBtn').addEventListener('click', () => { location.hash = '#/'; });
    document.getElementById('editToggle').addEventListener('click', toggleEdit);
    app.querySelectorAll('.gtabs button').forEach(b =>
      b.addEventListener('click', () => { location.hash = `#/g/${g.id}/${b.dataset.tab}`; }));
    if (tab === 'atlas') renderAtlas(g); else renderWorks(g);
  }

  /* ================= 藏品网格 ================= */
  function renderWorks(g) {
    const main = document.getElementById('gmain');
    const recycleIds = editMode ? OVR.deleted.filter(id => baseGroup[id] && baseGroup[id].id === g.id) : [];
    main.innerHTML = `<div class="works">
      ${editMode && recycleIds.length ? `<div class="recycle-bar">回收站（${recycleIds.length} 件，删除的条目可恢复）：
        <div class="recycle-list">${recycleIds.map(id =>
          `<span class="recycle-item">${esc(baseTitle[id] || id)}<button data-restore="${id}" title="恢复">↺</button></span>`).join('')}</div>
      </div>` : ''}
      <div class="chips" id="chips"></div><div class="grid" id="grid"></div></div>`;
    if (editMode && recycleIds.length) {
      main.querySelectorAll('[data-restore]').forEach(b =>
        b.addEventListener('click', () => restoreItem(b.dataset.restore)));
    }
    const cats = g.atlas.categories;
    const chips = document.getElementById('chips');
    const grid = document.getElementById('grid');
    let cur = 'all';
    function draw() {
      const items = cur === 'all' ? g.items : g.items.filter(it => it.tags.some(t => cur === t));
      grid.innerHTML = items.map(it => `
        <div class="card" data-id="${it.id}">
          <div class="ph">${it.images[0] ? `<img loading="lazy" src="${it.images[0].thumb}" alt="">` : '<span class="noimg">暂无图片</span>'}
            ${it.images.length > 1 ? `<span class="mcnt">⊞ ${it.images.length}</span>` : ''}</div>
          <div class="cap">
            <div class="t">${esc(it.title)}</div>
            <div class="s">${esc(it.subtitle || (it.sources[0] ? it.source_labels[0] : ''))}</div>
          </div>
          <div class="card-tools">
            <button class="ct-edit" data-edit="${it.id}" title="编辑">✎</button>
            <button class="ct-del" data-del="${it.id}" title="删除条目">🗑</button>
          </div>
        </div>`).join('') || `<div class="empty">该品类下暂无条目</div>`;
      grid.querySelectorAll('.card').forEach(c =>
        c.addEventListener('click', ev => {
          if (ev.target.closest('.card-tools')) return;
          openViewer(g, c.dataset.id);
        }));
      grid.querySelectorAll('[data-edit]').forEach(b =>
        b.addEventListener('click', () => { openViewer(g, b.dataset.edit, true); }));
      grid.querySelectorAll('[data-del]').forEach(b =>
        b.addEventListener('click', () => removeItem(g, b.dataset.del)));
    }
    chips.innerHTML = `<button class="chip on" data-c="all">全部<span class="n">${g.items.length}</span></button>` +
      cats.map(c => `<button class="chip" data-c="${c.key}">${esc(c.name)}<span class="n">${c.ids.length}</span></button>`).join('');
    chips.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      cur = ch.dataset.c;
      chips.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === ch));
      draw();
    }));
    gridRedraw = () => draw();
    draw();
  }

  /* ================= 图谱页 ================= */
  function renderAtlas(g) {
    const A = g.atlas;
    const main = document.getElementById('gmain');
    const miniGrid = ids => `<div class="cat-grid">${ids.map(id => {
      const it = g.itemById[id];
      if (!it || !it.images[0]) return '';
      return `<div class="m" data-id="${id}"><img loading="lazy" src="${it.images[0].thumb}" alt=""><div class="t">${esc(it.title)}</div></div>`;
    }).join('')}</div>`;
    const chapters = (g.chapters || []).map(c => {
      const steps = c.steps && c.steps.length ? `<div class="steps">${c.steps.map(s =>
        `<div class="step"><span class="sn">${esc(s.n)}</span><b>${esc(s.name)}</b><p>${esc(s.desc)}</p></div>`).join('')}</div>` : '';
      const pairs = c.pairs && c.pairs.length ? `<div class="pair-cards">${c.pairs.map(p =>
        `<div class="pair-card"><b>${esc(p.label)}</b><p>${esc(p.text)}</p></div>`).join('')}</div>` : '';
      let table = '';
      if (c.table) {
        table = `<table><caption>${esc(c.table.title)}</caption><thead><tr>${c.table.cols.map(x => `<th>${esc(x)}</th>`).join('')}</tr></thead>
          <tbody>${c.table.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      }
      const bullets = c.bullets && c.bullets.length ? `<ul class="bullets">${c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
      const mini = c.image_items && c.image_items.length ? `<div class="ch-mini">${miniGrid(c.image_items)}</div>` : '';
      const foot = c.foot ? `<div class="foot-note">${esc(c.foot)}</div>` : '';
      return `<div class="chapter"><div class="ch-head"><h4>${esc(c.title)}</h4>${c.subtitle ? `<div class="chs">${esc(c.subtitle)}</div>` : ''}</div>
        <div class="ch-body">${steps}${pairs}${table}${bullets}${mini}${foot}</div></div>`;
    }).join('');
    const cats = A.categories.map(c => `
      <div class="cat-block">
        <div class="cb-head"><h4>${esc(c.name)}</h4><span class="cn">${c.ids.length} 件</span></div>
        <div class="cb-blurb">${esc(c.blurb)}</div>
        ${miniGrid(c.ids.slice(0, 24))}
        ${c.ids.length > 24 ? `<div class="foot-note">…完整清单可在「藏品浏览」中按品类筛选查看（共 ${c.ids.length} 件）</div>` : ''}
      </div>`).join('');
    const refsDocs = A.refs_docs && A.refs_docs.length ? `<ul>${A.refs_docs.map(r => `<li>文献 · ${esc(r)}</li>`).join('')}</ul>` : '';
    const museums = A.museums && A.museums.length ? `<ul>${A.museums.map(m => `<li>著录机构 · ${esc(m)}</li>`).join('')}</ul>` : '';
    main.innerHTML = `<div class="atlas">
      <section class="syn">
        <h3 class="sec">综述 · 拼布特点分析<span class="no">SYNTHESIS</span></h3>
        ${A.synthesis.map(p => `<p>${esc(p)}</p>`).join('')}
      </section>
      ${g.chapters && g.chapters.length ? `<section>
        <h3 class="sec">专题章节 · 工艺与纹样<span class="no">CHAPTERS</span></h3>
        ${chapters}
      </section>` : ''}
      <section>
        <h3 class="sec">品类图谱 · 影像归类<span class="no">CATEGORIES</span></h3>
        ${cats}
      </section>
      <section>
        <h3 class="sec">文献与来源<span class="no">REFERENCES</span></h3>
        <div class="refs">
          ${refsDocs}
          ${museums}
          <div class="note-line">${esc(A.refs_note)}</div>
        </div>
      </section>
    </div>`;
    main.querySelectorAll('[data-id]').forEach(el =>
      el.addEventListener('click', () => openViewer(g, el.dataset.id)));
  }

  /* ================= 大图浏览 ================= */
  const V = { g: null, items: [], idx: 0, imgIdx: 0, edit: false };
  let gridRedraw = null;

  function openViewer(g, itemId, edit) {
    V.g = g;
    V.items = g.items;
    V.idx = g.items.findIndex(it => it.id === itemId);
    if (V.idx < 0) return;
    V.imgIdx = 0;
    V.edit = editMode || !!edit;
    buildViewer();
    viewer.hidden = false;
    document.body.style.overflow = 'hidden';
    show();
  }
  function closeViewer() {
    if (!viewer || viewer.hidden) return;
    viewer.hidden = true;
    viewer.innerHTML = '';
    document.body.style.overflow = '';
    if (gridRedraw) gridRedraw();
  }
  document.addEventListener('keydown', keyHandler);
  function keyHandler(e) {
    if (!viewer || viewer.hidden || editMode && viewer.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      if (e.key === 'Escape' && viewer && !viewer.hidden) { closeViewer(); }
      return;
    }
    if (e.key === 'Escape') closeViewer();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  }

  function buildViewer() {
    viewer.innerHTML = `
      <div class="v-top">
        <span class="vt-cnt" id="vtCnt"></span>
        <span class="vt-title" id="vtTitle"></span>
        <span class="spacer"></span>
        ${V.edit ? `<button class="icon-btn danger" id="vDel">🗑 删除条目</button>` : ''}
        ${V.edit ? `<button class="icon-btn on" id="vDone">✓ 完成</button>` : `<button class="icon-btn" id="vEdit">✎ 编辑</button>`}
        <button class="icon-btn" id="vAtlas">图谱</button>
        <button class="icon-btn close" id="vClose" title="关闭 (Esc)">✕</button>
      </div>
      <div class="v-main">
        <div class="v-stage">
          <span class="imgnum" id="vImgNum"></span>
          <button class="v-nav prev" id="vPrev">‹</button>
          <button class="v-nav next" id="vNext">›</button>
          <div class="imgwrap" id="vWrap" title="双击打开来源页面"><img id="vimg" alt=""></div>
          <div class="v-imgcap" id="vImgCap" hidden></div>
          <div class="v-thumbs" id="vThumbs" hidden></div>
          <div class="dblhint">双击照片 <b>↗ 直达原始著录网页</b> · ← → 键翻看本件照片，翻完换上 / 下一件</div>
        </div>
        <aside class="v-panel" id="vPanel"></aside>
      </div>`;
    document.getElementById('vClose').addEventListener('click', closeViewer);
    document.getElementById('vPrev').addEventListener('click', () => step(-1));
    document.getElementById('vNext').addEventListener('click', () => step(1));
    document.getElementById('vAtlas').addEventListener('click', () => {
      location.hash = `#/g/${V.g.id}/atlas`;
    });
    if (V.edit) {
      document.getElementById('vDone').addEventListener('click', () => { V.edit = false; buildViewer(); show(); });
      document.getElementById('vDel').addEventListener('click', () => removeItem(V.g, V.items[V.idx].id));
    } else {
      document.getElementById('vEdit').addEventListener('click', () => { V.edit = true; buildViewer(); show(); });
    }
    document.getElementById('vWrap').addEventListener('dblclick', () => {
      const it = V.items[V.idx];
      if (it.sources && it.sources.length) window.open(it.sources[V.imgIdx % it.sources.length] || it.sources[0], '_blank');
    });
  }

  function step(d) {
    // 同一藏品有多张照片时，先在照片之间翻看，翻到头再切换上/下一件藏品
    const it = V.items[V.idx];
    if (it && it.images.length > 1) {
      const ni = V.imgIdx + d;
      if (ni >= 0 && ni < it.images.length) { V.imgIdx = ni; show(); return; }
    }
    const n = V.items.length;
    V.idx = (V.idx + d + n) % n;
    V.imgIdx = 0;
    show();
  }

  function show() {
    const it = V.items[V.idx];
    if (!it) { closeViewer(); return; }
    if (V.imgIdx >= it.images.length) V.imgIdx = 0;
    document.getElementById('vtCnt').textContent = `${V.idx + 1} / ${V.items.length} 件 · ${V.g.name}`;
    document.getElementById('vtTitle').textContent = it.title;
    const img = document.getElementById('vimg');
    const cur = it.images[V.imgIdx];
    img.src = cur ? cur.src : '';
    img.style.background = '#f5f1e8';
    const numEl = document.getElementById('vImgNum');
    numEl.textContent = it.images.length > 1 ? `图 ${V.imgIdx + 1}/${it.images.length}` : '';
    const capEl = document.getElementById('vImgCap');
    if (cur && cur.caption) { capEl.hidden = false; capEl.textContent = cur.caption; } else { capEl.hidden = true; }
    // thumbs
    const th = document.getElementById('vThumbs');
    if (it.images.length > 1) {
      th.hidden = false;
      th.innerHTML = it.images.map((im, i) => `
        <span class="vthumb ${i === V.imgIdx ? 'on' : ''}" data-i="${i}">
          <img src="${im.thumb}" data-jump="${i}" title="${esc(im.caption || '')}">
          ${V.edit ? `<button class="thumb-x" data-delimg="${i}" title="删除这张图片">✕</button>` : ''}
        </span>`).join('');
    } else { th.hidden = true; th.innerHTML = ''; }
    renderPanel(it);
  }

  function renderPanel(it) {
    const P = document.getElementById('vPanel');
    if (!P) return;
    if (V.edit) return renderPanelEdit(it, P);
    const catNames = (it.tags || []).map(t => {
      const c = V.g.atlas.categories.find(c => c.key === t);
      return c ? c.name : '';
    }).filter(Boolean).join(' · ');
    P.innerHTML = `
      ${it.subtitle ? `<div class="p-sub">${esc(it.subtitle)}</div>` : ''}
      <h3>${esc(it.title)}</h3>
      ${it.code ? `<span class="p-code">${esc(it.code)}</span>` : ''}
      ${catNames ? `<div class="p-code" style="margin-top:8px">${esc(catNames)}</div>` : ''}
      ${(it.meta || []).length ? `<div class="meta-list">${it.meta.map(m => {
        const parts = String(m).split(/[\u3000\s]{2,}/);
        const k = parts.length >= 2 ? esc(parts[0]) : '';
        const v = esc(parts.slice(1).join(' ') || m);
        return `<div class="row"><span class="k">${k || '著录'}</span><span class="v">${v}</span></div>`;
      }).join('')}</div>` : ''}
      ${(it.body || []).map(b => b.label
        ? `<div class="body-block"><div class="blabel">${esc(b.label)}</div><p>${esc(b.text)}</p></div>`
        : `<div class="body-block"><p>${esc(b.text)}</p></div>`).join('')}
      ${(it.captions || []).length ? `<div class="body-block">${it.captions.map(c => `<p>◦ ${esc(c)}</p>`).join('')}</div>` : ''}
      <div class="src-box">
        <div class="src-t">来 源</div>
        ${it.sources && it.sources.length
          ? it.sources.map((u, i) => `<a class="src-link" href="${esc(u)}" target="_blank" rel="noopener">↗ ${esc(it.source_labels[i] || u)}${it.sources.length > 1 ? `（${i + 1}）` : ''}</a>`).join('')
          : `<div class="src-none">该条目未附来源链接（原 PPT 未提供）</div>`}
      </div>
      ${it.note ? `<div class="note-p">${esc(it.note)}</div>` : ''}
    `;
    P.scrollTop = 0;
  }

  /* ---------- 编辑面板 ---------- */
  function renderPanelEdit(it, P) {
    P.innerHTML = `
      <div class="pe-head">✎ 编辑条目 <span class="pe-hint">修改自动保存</span></div>
      <label class="pe-f"><span>名称（标题）</span><input id="peTitle" value="${esc(it.title)}"></label>
      <label class="pe-f"><span>副标题 / 类别标注</span><input id="peSub" value="${esc(it.subtitle)}" placeholder="可留空"></label>
      <label class="pe-f"><span>编号</span><input id="peCode" value="${esc(it.code || '')}" placeholder="如 A01 / Z03"></label>
      <div class="pe-sec">图集（${it.images.length} 张）</div>
      <div id="peImgs"></div>
      <button class="pe-add" id="peAddCap">＋ 为当前图添加名称</button>
      <div class="pe-sec">著录信息</div>
      <div id="peMeta"></div>
      <button class="pe-add" id="peAddMeta">＋ 添加著录行</button>
      <div class="pe-sec">分析说明</div>
      <div id="peBody"></div>
      <button class="pe-add" id="peAddBlock">＋ 添加分析段落</button>
      ${(it.captions || []).length ? `<div class="pe-sec">图注列表</div><div id="peCaps"></div>` : ''}
      <div class="pe-sec">备注</div>
      <label class="pe-f"><textarea id="peNote" rows="3" placeholder="背景说明等">${esc(it.note || '')}</textarea></label>
      <div class="pe-sec">来源链接</div>
      <div id="peSrcs"></div>
    `;
    const $ = sel => P.querySelector(sel);

    function bindInput(sel, fn) {
      const el = $(sel);
      if (!el) return;
      el.addEventListener('input', () => { fn(el.value); record(it); });
    }
    bindInput('#peTitle', v => { it.title = v; document.getElementById('vtTitle').textContent = v; });
    bindInput('#peSub', v => { it.subtitle = v; });
    bindInput('#peCode', v => { it.code = v; });
    bindInput('#peNote', v => { it.note = v; });

    /* 图集 */
    function drawImgs() {
      const box = $('#peImgs');
      box.innerHTML = it.images.map((im, i) => `
        <div class="pe-img" data-i="${i}">
          <img src="${im.thumb}">
          <div class="pe-img-r">
            <input data-imgcap="${i}" value="${esc(im.caption || '')}" placeholder="图片名称 / 图注">
            <button class="pe-x" data-delimg="${i}" title="删除这张图片">✕ 删除图片</button>
          </div>
        </div>`).join('') || '<div class="pe-empty">所有图片均已删除。</div>';
      box.querySelectorAll('[data-imgcap]').forEach(inp =>
        inp.addEventListener('input', () => { it.images[+inp.dataset.imgcap].caption = inp.value; record(it); }));
      box.querySelectorAll('[data-delimg]').forEach(btn =>
        btn.addEventListener('click', async () => {
          const ok = await showConfirm('确定删除这张图片吗？（自动保存；删除整条目可回收站恢复，单张图片删除不可恢复）');
          if (!ok) return;
          if (!btn.isConnected) return;
          const i = +btn.dataset.delimg;
          if (!(i >= 0 && i < it.images.length)) return;
          it.images.splice(i, 1);
          if (V.imgIdx >= it.images.length) V.imgIdx = 0;
          record(it);
          drawImgs();
          show();
        }));
    }
    drawImgs();
    $('#peAddCap').addEventListener('click', async () => {
      const cur = it.images[V.imgIdx];
      if (!cur) return;
      const name = await showPrompt('为当前大图设置名称 / 图注：', cur.caption || '');
      if (name === null) return;
      cur.caption = name;
      record(it);
      drawImgs();
      show();
    });

    /* 著录 */
    function drawMeta() {
      const box = $('#peMeta');
      box.innerHTML = (it.meta || []).map((m, i) => `
        <div class="pe-row">
          <input data-meta="${i}" value="${esc(m)}">
          <button class="pe-x" data-delmeta="${i}" title="删除此行">✕</button>
        </div>`).join('') || '<div class="pe-empty">暂无著录信息。</div>';
      box.querySelectorAll('[data-meta]').forEach(inp =>
        inp.addEventListener('input', () => { it.meta[+inp.dataset.meta] = inp.value; record(it); }));
      box.querySelectorAll('[data-delmeta]').forEach(btn =>
        btn.addEventListener('click', () => {
          if (!btn.isConnected) return;
          const i = +btn.dataset.delmeta;
          if (!(i >= 0 && i < it.meta.length)) return;
          it.meta.splice(i, 1); record(it); drawMeta();
        }));
    }
    if (!Array.isArray(it.meta)) it.meta = [];
    drawMeta();
    $('#peAddMeta').addEventListener('click', () => {
      it.meta.push('');
      record(it);
      drawMeta();
      const ins = $('#peMeta').querySelectorAll('input');
      if (ins.length) ins[ins.length - 1].focus();
    });

    /* 分析段落 */
    function drawBody() {
      const box = $('#peBody');
      box.innerHTML = (it.body || []).map((b, i) => `
        <div class="pe-block">
          <div class="pe-block-head">
            <input class="pe-blabel" data-blabel="${i}" value="${esc(b.label || '')}" placeholder="小标题（可留空）">
            <button class="pe-x" data-delbody="${i}" title="删除此段">✕</button>
          </div>
          <textarea data-btext="${i}" rows="3">${esc(b.text || '')}</textarea>
        </div>`).join('') || '<div class="pe-empty">暂无分析文字。</div>';
      box.querySelectorAll('[data-blabel]').forEach(inp =>
        inp.addEventListener('input', () => { it.body[+inp.dataset.blabel].label = inp.value; record(it); }));
      box.querySelectorAll('[data-btext]').forEach(t =>
        t.addEventListener('input', () => { it.body[+t.dataset.btext].text = t.value; record(it); }));
      box.querySelectorAll('[data-delbody]').forEach(btn =>
        btn.addEventListener('click', () => {
          if (!btn.isConnected) return;
          const i = +btn.dataset.delbody;
          if (!(i >= 0 && i < it.body.length)) return;
          it.body.splice(i, 1); record(it); drawBody();
        }));
    }
    if (!Array.isArray(it.body)) it.body = [];
    drawBody();
    $('#peAddBlock').addEventListener('click', () => { it.body.push({ label: '', text: '' }); record(it); drawBody(); const ts = $('#peBody').querySelectorAll('textarea'); if (ts.length) ts[ts.length - 1].focus(); });

    /* 图注列表 */
    if ((it.captions || []).length) {
      const box = $('#peCaps');
      box.innerHTML = it.captions.map((c, i) => `
        <div class="pe-row">
          <input data-cap="${i}" value="${esc(c)}">
          <button class="pe-x" data-delcap="${i}" title="删除">✕</button>
        </div>`).join('');
      box.querySelectorAll('[data-cap]').forEach(inp =>
        inp.addEventListener('input', () => { it.captions[+inp.dataset.cap] = inp.value; record(it); }));
      box.querySelectorAll('[data-delcap]').forEach(btn =>
        btn.addEventListener('click', () => {
          if (!btn.isConnected) return;
          const i = +btn.dataset.delcap;
          if (!(i >= 0 && i < it.captions.length)) return;
          it.captions.splice(i, 1); record(it); renderPanelEdit(it, P);
        }));
    }

    /* 来源（只读展示，可复制） */
    const srcBox = $('#peSrcs');
    srcBox.innerHTML = (it.sources && it.sources.length)
      ? it.sources.map(u => `<div class="pe-src">${esc(u)}</div>`).join('')
      : '<div class="pe-empty">该条目暂无来源链接。</div>';
    P.scrollTop = 0;
  }
  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  route();
  loadOverrides().then(() => { if (!viewer.hidden) show(); rerenderCurrent(); });
})();
