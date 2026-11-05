/* ============================================================
 * 屠雅（SHINYWAY IELTS）· 雅思阅读核心词汇 背单词网站
 * 纯前端 / localStorage 持久化 / 支持 Web Speech 发音
 * 结构：70 个 List，每个 List 16 词（共 1118）
 * 功能：学习台 / 闪卡背诵 / 拼写练习 / 艾宾浩斯复习 / 重点强化
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 基础工具 ---------- */
  const $page = document.getElementById('page');
  const TABS = ['dash', 'study', 'spell', 'review', 'key'];
  const KEY = 'ielts_workbench_v1';
  const DAY = 86400000;
  // 艾宾浩斯间隔（天）：1/2/4/7/15/30，之后视为长期记忆
  const INTERVALS = [1, 2, 4, 7, 15, 30];
  // 单词 -> 词条 快速查表（用于选项点击后展示中文释义）
  const WORD_MAP = (function () { const m = {}; WORDS.forEach(w => { m[w.word.toLowerCase()] = w; }); return m; })();

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function wordById(id) { return WORDS[id - 1]; }
  function listById(li) { return LISTS[li - 1]; }
  function listWordIds(li) { return (LISTS[li - 1] || { words: [] }).words; }

  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) { document.body.classList.add('no-tts'); return; }
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US'; u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  }

  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 1600);
  }

  /* 点击蓝色单词弹出：释义 + 音标 + 拼读发音 */
  function showWordPop(id) {
    const w = wordById(id);
    if (!w) return;
    let pop = document.getElementById('wordPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'wordPop';
      pop.className = 'word-pop';
      document.body.appendChild(pop);
    }
    pop.innerHTML = `
      <div class="wp-mask" id="wpMask"></div>
      <div class="wp-card">
        <button class="wp-x" id="wpX" aria-label="关闭">✕</button>
        <div class="wp-word">${esc(w.word)} <button class="wp-spk" id="wpSpk" title="朗读发音">🔊</button></div>
        <div class="wp-ph">/${esc(w.phonetic)}/</div>
        <div class="wp-pos">${esc(w.pos)}</div>
        <div class="wp-mean">${esc(w.meaning)}</div>
        ${w.example ? `<div class="wp-ex">${esc(w.example)}</div>` : ''}
      </div>`;
    pop.classList.add('show');
    pop.querySelector('#wpX').onclick = hideWordPop;
    pop.querySelector('#wpMask').onclick = hideWordPop;
    pop.querySelector('#wpSpk').onclick = (e) => { e.stopPropagation(); speak(w.word); };
  }
  function hideWordPop() {
    const pop = document.getElementById('wordPop');
    if (pop) pop.classList.remove('show');
  }

  /* ---------- 状态 ---------- */
  let S = load();
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  S.words = S.words || {};     // id -> {known, stage, next, first}
  S.key = S.key || {};         // id -> {src, at}
  S.settings = S.settings || { daily: 3 };

  function ws(id) { return S.words[id] || { known: false, stage: 0, next: 0, first: 0 }; }
  function isKnown(id) { const w = S.words[id]; return !!(w && w.known); }
  function knownCountIn(ids) { return ids.filter(isKnown).length; }

  function markKnown(id) {
    const w = S.words[id] || { known: false, stage: 0, next: 0, first: Date.now() };
    w.known = true; w.stage = 6; w.next = Number.MAX_SAFE_INTEGER; w.first = w.first || Date.now();
    S.words[id] = w; save();
  }
  function markUnknown(id, src) {
    const now = Date.now();
    const w = S.words[id] || { known: false, stage: 0, next: 0, first: now };
    w.known = false; w.stage = 0; w.next = now + INTERVALS[0] * DAY; w.first = w.first || now;
    S.words[id] = w;
    S.key[id] = { src: src || 'flash', at: now };
    save();
  }
  function reviewRecall(id, remembered) {
    const now = Date.now();
    const w = S.words[id] || { known: false, stage: 0, next: 0, first: now };
    w.first = w.first || now;
    if (remembered) {
      w.stage = Math.min(w.stage + 1, INTERVALS.length);
      w.next = w.stage >= INTERVALS.length ? Number.MAX_SAFE_INTEGER : now + INTERVALS[w.stage] * DAY;
      if (w.stage >= INTERVALS.length) { w.known = true; delete S.key[id]; }
    } else {
      w.stage = 0; w.next = now + INTERVALS[0] * DAY; w.known = false;
      S.key[id] = { src: 'review', at: now };
    }
    S.words[id] = w; save();
  }
  function dueWords() {
    const now = Date.now();
    return WORDS.filter(w => { const s = S.words[w.id]; return s && !s.known && s.next <= now; })
      .map(w => w.id);
  }

  /* ---------- UI 状态 ---------- */
  const ui = {
    tab: 'dash',
    studyList: null, q: [], qi: 0,
    spellList: null, spellMode: 'read',
    quiz: null,
  };

  /* ---------- 列表选择器 ---------- */
  function listPickerHTML(onpickLabel) {
    let cards = '';
    for (let li = 1; li <= LISTS.length; li++) {
      const ids = listWordIds(li);
      const k = knownCountIn(ids);
      const pct = Math.round(k / ids.length * 100);
      const done = k === ids.length;
      cards += `<button class="lp-card ${done ? 'done' : ''}" data-list="${li}">
        <div class="lp-no">${li}</div>
        <div class="lp-bar"><i style="width:${pct}%"></i></div>
        <div class="lp-meta">${k}/${ids.length}</div>
      </button>`;
    }
    return `<div class="lp-head">${onpickLabel}</div><div class="lp-grid">${cards}</div>`;
  }

  /* ---------- 学习台 ---------- */
  function firstUnfinishedList() {
    for (let li = 1; li <= LISTS.length; li++) {
      const ids = listWordIds(li);
      if (knownCountIn(ids) < ids.length) return li;
    }
    return 1;
  }
  function renderDash() {
    const total = WORDS.length;
    const known = WORDS.filter(w => isKnown(w.id)).length;
    const keyN = Object.keys(S.key).length;
    const due = dueWords().length;
    const start = firstUnfinishedList();
    const rec = [start, start + 1, start + 2].filter(n => n <= LISTS.length);

    const recCards = rec.map(li => {
      const ids = listWordIds(li);
      const k = knownCountIn(ids);
      return `<button class="rec-card" data-list="${li}">
        <div class="rec-no">List ${li}</div>
        <div class="rec-meta">${ids.length} 词 · 已掌握 ${k}</div>
        <div class="rec-go">去学习 →</div>
      </button>`;
    }).join('');

    $page.innerHTML = `
      <section class="dash">
        <div class="hero">
          <div class="ring" style="--p:${Math.round(known / total * 100)}">
            <div class="ring-c"><b>${known}</b><small>/ ${total}</small></div>
          </div>
          <div class="hero-info">
            <h2>屠雅</h2>
            <p>已掌握 <b>${known}</b> 词 · 重点 <b>${keyN}</b> 词 · 待复习 <b>${due}</b></p>
            <p class="hero-sub">每天 3 个 List，约 24 天刷完一轮</p>
          </div>
        </div>

        <div class="actions">
          <button class="btn primary" id="goStudy">📇 背单词</button>
          <button class="btn" id="goSpell">✍️ 语境</button>
          <button class="btn" id="goReview">🔁 复习${due ? ` (${due})` : ''}</button>
          <button class="btn" id="goKey">⭐ 重点${keyN ? ` (${keyN})` : ''}</button>
        </div>

        <h3 class="sec-t">📅 今日推荐</h3>
        <div class="rec-row">${recCards}</div>

        <h3 class="sec-t">📚 全部 List（${LISTS.length}）</h3>
        <div class="lp-grid">
          ${LISTS.map(li => {
            const ids = listWordIds(li.id);
            const k = knownCountIn(ids);
            const pct = Math.round(k / ids.length * 100);
            const done = k === ids.length;
            return `<button class="lp-card ${done ? 'done' : ''}" data-list="${li.id}">
              <div class="lp-no">${li.id}</div>
              <div class="lp-bar"><i style="width:${pct}%"></i></div>
              <div class="lp-meta">${k}/${ids.length}</div>
            </button>`;
          }).join('')}
        </div>
      </section>`;

    $page.querySelector('#goStudy').onclick = () => switchTab('study');
    $page.querySelector('#goSpell').onclick = () => { ui.spellList = null; ui.spellMode = 'read'; switchTab('spell'); };
    $page.querySelector('#goReview').onclick = () => switchTab('review');
    $page.querySelector('#goKey').onclick = () => switchTab('key');
    $page.querySelectorAll('.rec-card,.lp-card').forEach(b => {
      b.onclick = () => startStudy(+b.dataset.list);
    });
  }

  /* ---------- 背单词（闪卡） ---------- */
  function startStudy(li) {
    ui.studyList = li;
    ui.q = listWordIds(li).slice();
    ui.qi = 0;
    renderStudy();
  }
  function renderStudy() {
    if (!ui.studyList || !ui.q.length) {
      $page.innerHTML = `<section class="picker"><h3 class="sec-t">选择要背诵的 List</h3>${listPickerHTML('点击任意 List 开始背诵')}</section>`;
      $page.querySelectorAll('.lp-card').forEach(b => b.onclick = () => startStudy(+b.dataset.list));
      return;
    }
    if (ui.qi >= ui.q.length) {
      const li = ui.studyList;
      $page.innerHTML = `<section class="done-screen">
        <div class="done-emoji">🎉</div>
        <h2>List ${li} 背诵完成</h2>
        <p>共 ${ui.q.length} 词。去「复习」巩固，或继续下一个 List。</p>
        <div class="actions">
          <button class="btn primary" id="nextList">下一个 List</button>
          <button class="btn" id="backDash">返回学习台</button>
        </div></section>`;
      $page.querySelector('#nextList').onclick = () => { const n = Math.min(ui.studyList + 1, LISTS.length); startStudy(n); };
      $page.querySelector('#backDash').onclick = () => switchTab('dash');
      return;
    }
    const id = ui.q[ui.qi];
    const w = wordById(id);
    const total = ui.q.length, cur = ui.qi + 1;
    $page.innerHTML = `
      <section class="study">
        <div class="study-top">
          <span>List ${ui.studyList}</span>
          <span>${cur} / ${total}</span>
          <button class="x" id="exitStudy">✕</button>
        </div>
        <div class="prog"><i style="width:${cur / total * 100}%"></i></div>
        <div class="card flip" id="card">
          <div class="card-face front">
            <div class="word">${esc(w.word)}</div>
            <div class="hint">点击卡片看释义 · 🔊 朗读</div>
          </div>
          <div class="card-face back">
            <div class="word">${esc(w.word)} <button class="spk" id="spk">🔊</button></div>
            <div class="ph">/${esc(w.phonetic)}/</div>
            <div class="pos">${esc(w.pos)}</div>
            <div class="mean">${esc(w.meaning)}</div>
            <div class="ex">${esc(w.example)}</div>
          </div>
        </div>
        <div class="study-btns">
          <button class="btn bad" id="no">😣 不认识</button>
          <button class="btn good" id="yes">😎 认识</button>
        </div>
      </section>`;

    const card = $page.querySelector('#card');
    card.onclick = (e) => {
      if (e.target.id === 'spk') return;
      card.classList.toggle('flipped');
    };
    $page.querySelector('#spk').onclick = (e) => { e.stopPropagation(); speak(w.word); };
    $page.querySelector('#exitStudy').onclick = () => switchTab('dash');
    $page.querySelector('#yes').onclick = () => { markKnown(id); ui.qi++; renderStudy(); };
    $page.querySelector('#no').onclick = () => { markUnknown(id, 'flash'); ui.qi++; renderStudy(); };
  }

  /* ---------- 语境拼写（阅读 + 挖空） ---------- */
  function startSpell(li) {
    ui.spellList = li;
    ui.spellMode = 'read';
    renderSpell();
  }
  function getArticle(li) {
    return ARTICLES.find(a => a.list === li) || null;
  }
  function spellWordMap(li) {
    const m = {};
    listWordIds(li).forEach(id => { const w = wordById(id); m[w.word.toLowerCase()] = id; });
    return m;
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // 阅读模式：高亮文中所有目标词（可点击发音）
  function renderArticleHL(en, li) {
    const map = spellWordMap(li);
    const words = Object.keys(map);
    if (!words.length) return esc(en);
    const re = new RegExp('\\b(' + words.sort((a, b) => b.length - a.length).map(escapeRe).join('|') + ')\\b', 'gi');
    return en.replace(re, m => `<span class="tw" data-word="${esc(m)}" data-id="${map[m.toLowerCase()]}">${esc(m)}</span>`);
  }
  function renderSpell() {
    if (!ui.spellList) {
      $page.innerHTML = `<section class="picker"><h3 class="sec-t">选择要学习的 List</h3>${listPickerHTML('语境拼写：先读短文熟悉单词，再挖空默写')}</section>`;
      $page.querySelectorAll('.lp-card').forEach(b => b.onclick = () => startSpell(+b.dataset.list));
      return;
    }
    const li = ui.spellList;
    const art = getArticle(li);
    if (!art) {
      $page.innerHTML = `<section class="empty"><div style="font-size:42px">📄</div><p>该 List 暂未生成短文。</p><button class="btn primary" id="b">返回学习台</button></section>`;
      $page.querySelector('#b').onclick = () => switchTab('dash');
      return;
    }
    if (ui.spellMode === 'read') return renderSpellRead(li, art);
    return renderSpellCloze(li, art);
  }
  function renderSpellRead(li, art) {
    $page.innerHTML = `
      <section class="spell-read">
        <div class="study-top">
          <span>List ${li} · 阅读</span>
          <button class="x" id="exit">✕</button>
        </div>
        <div class="art-head">
          <div class="art-title">${esc(art.title)}</div>
          <div class="art-title-cn">${esc(art.titleCn)}</div>
        </div>
        <div class="article-body" id="abody">${renderArticleHL(art.en, li)}</div>
        <div class="art-tools">
          <button class="btn" id="toggleCn">🌐 看中文</button>
        </div>
        <div class="article-cn hidden" id="acn">${art.cn.split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}</div>
        <div class="study-btns">
          <button class="btn" id="back">← 选 List</button>
          <button class="btn primary" id="toCloze">✍️ 开始挖空拼写</button>
        </div>
      </section>`;
    $page.querySelectorAll('#abody .tw').forEach(sp => sp.onclick = () => showWordPop(+sp.dataset.id));
    $page.querySelector('#exit').onclick = () => switchTab('dash');
    $page.querySelector('#back').onclick = () => { ui.spellList = null; renderSpell(); };
    $page.querySelector('#toggleCn').onclick = () => $page.querySelector('#acn').classList.toggle('hidden');
    $page.querySelector('#toCloze').onclick = () => { ui.spellMode = 'cloze'; renderSpell(); };
  }
  function renderSpellCloze(li, art) {
    const map = spellWordMap(li);
    const words = Object.keys(map);
    const en = art.en;
    // 每个目标词只挖第一个出现位置，避免重复挖同一词
    const matches = [];
    words.forEach(w => {
      const rx = new RegExp('\\b' + escapeRe(w) + '\\b', 'i');
      const m = rx.exec(en);
      if (m) matches.push({ index: m.index, len: m[0].length, word: w, id: map[w] });
    });
    matches.sort((a, b) => a.index - b.index);
    let html = '', cursor = 0;
    matches.forEach((mt, i) => {
      html += esc(en.slice(cursor, mt.index));
      html += `<input class="cloze-in" id="cl${i}" data-idx="${i}" data-ans="${esc(mt.word)}" data-id="${mt.id}" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" />`
        + `<button class="cloze-bulb" data-id="${mt.id}" title="看中文释义" aria-label="提示">💡</button>`;
      cursor = mt.index + mt.len;
    });
    html += esc(en.slice(cursor));
    $page.innerHTML = `
      <section class="spell-cloze">
        <div class="study-top">
          <span>List ${li} · 挖空拼写</span>
          <button class="x" id="exit">✕</button>
        </div>
        <div class="cloze-wrap">
          <div class="cloze-passage article-body">${html}</div>
        </div>
        <div class="study-btns">
          <button class="btn" id="backRead">← 返回阅读</button>
          <button class="btn primary" id="check">检查答案</button>
        </div>
        <div class="cloze-fb hidden" id="fb"></div>
      </section>`;
    $page.querySelectorAll('.cloze-bulb').forEach(b => b.onclick = () => showWordPop(+b.dataset.id));
    $page.querySelector('#exit').onclick = () => switchTab('dash');
    $page.querySelector('#backRead').onclick = () => { ui.spellMode = 'read'; renderSpell(); };
    $page.querySelector('#check').onclick = () => {
      let correct = 0; const total = matches.length; let wrong = 0;
      matches.forEach((mt, i) => {
        const inp = $page.querySelector('#cl' + i);
        const v = inp.value.trim();
        const ok = v.toLowerCase() === mt.word.toLowerCase();
        inp.classList.toggle('ok', ok);
        inp.classList.toggle('bad', !ok);
        if (ok) correct++; else { wrong++; markUnknown(mt.id, 'spell'); }
        const pa = inp.parentElement;
        let ans = pa ? pa.querySelector('.cloze-ans-' + i) : null;
        if (!ok) {
          if (!ans) {
            ans = document.createElement('span');
            ans.className = 'cloze-ans cloze-ans-' + i;
            ans.textContent = '正确答案：' + mt.word;
            if (pa) pa.insertAdjacentElement('afterend', ans);
            else inp.insertAdjacentElement('afterend', ans);
          }
        } else if (ans) { ans.remove(); }
      });
      const fb = $page.querySelector('#fb');
      fb.classList.remove('hidden');
      fb.className = 'cloze-fb ' + (wrong === 0 ? 'good' : 'bad');
      fb.innerHTML = `共 ${total} 空，写对 <b>${correct}</b> 个，写错 <b>${wrong}</b> 个。${wrong ? ' 错词已加入重点复习。' : ' 全部正确，太棒了！'}`;
      fb.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    const first = $page.querySelector('.cloze-in');
    if (first) setTimeout(() => first.focus(), 60);
  }

  /* ---------- 艾宾浩斯复习 ---------- */
  function renderReview() {
    const due = dueWords();
    if (!due.length) {
      $page.innerHTML = `<section class="empty">
        <div style="font-size:42px">🔁</div>
        <p>暂时没有待复习的词。</p>
        <p class="muted">背诵或拼写答错的词会按 1/2/4/7/15/30 天节奏回到这里。</p>
        <button class="btn primary" id="b">返回学习台</button></section>`;
      $page.querySelector('#b').onclick = () => switchTab('dash');
      return;
    }
    // 复习队列（每次进入重新取，避免状态变更后错位）
    ui._reviewQ = due;
    ui._reviewIdx = 0;
    drawReviewCard();
  }
  function drawReviewCard() {
    const q = ui._reviewQ;
    if (ui._reviewIdx >= q.length) {
      $page.innerHTML = `<section class="done-screen">
        <div class="done-emoji">🎉</div>
        <h2>本轮复习完成</h2>
        <p>共复习 ${q.length} 词。</p>
        <button class="btn primary" id="b">返回学习台</button></section>`;
      $page.querySelector('#b').onclick = () => switchTab('dash');
      return;
    }
    const id = q[ui._reviewIdx];
    const w = wordById(id);
    const cur = ui._reviewIdx + 1, total = q.length;
    $page.innerHTML = `
      <section class="study">
        <div class="study-top"><span>复习</span><span>${cur} / ${total}</span><button class="x" id="x">✕</button></div>
        <div class="prog"><i style="width:${cur / total * 100}%"></i></div>
        <div class="card flip" id="card">
          <div class="card-face front"><div class="word">${esc(w.word)}</div><div class="hint">点击看释义 · 🔊 朗读</div></div>
          <div class="card-face back">
            <div class="word">${esc(w.word)} <button class="spk" id="spk">🔊</button></div>
            <div class="ph">/${esc(w.phonetic)}/</div>
            <div class="pos">${esc(w.pos)}</div>
            <div class="mean">${esc(w.meaning)}</div>
            <div class="ex">${esc(w.example)}</div>
          </div>
        </div>
        <div class="study-btns">
          <button class="btn bad" id="forget">😣 忘了</button>
          <button class="btn good" id="remember">😎 记得</button>
        </div>
      </section>`;
    const card = $page.querySelector('#card');
    card.onclick = (e) => { if (e.target.id === 'spk') return; card.classList.toggle('flipped'); };
    $page.querySelector('#spk').onclick = (e) => { e.stopPropagation(); speak(w.word); };
    $page.querySelector('#x').onclick = () => switchTab('dash');
    $page.querySelector('#remember').onclick = () => { reviewRecall(id, true); ui._reviewIdx++; drawReviewCard(); };
    $page.querySelector('#forget').onclick = () => { reviewRecall(id, false); ui._reviewIdx++; drawReviewCard(); };
  }

  /* ---------- 重点强化（多选） ---------- */
  function pickDistractors(ansId, n) {
    const ans = wordById(ansId);
    const pool = WORDS.filter(x => x.id !== ansId && x.list === ans.list);
    const base = pool.length >= n ? pool : WORDS.filter(x => x.id !== ansId);
    const shuffled = base.slice().sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n).map(x => x.word);
  }
  function startQuiz() {
    const ids = Object.keys(S.key).map(Number);
    if (!ids.length) { toast('重点词库为空'); return; }
    const items = ids.map(id => {
      const w = wordById(id);
      const opts = pickDistractors(id, 3);
      opts.push(w.word);
      opts.sort(() => Math.random() - 0.5);
      return { id, meaning: w.meaning, answer: w.word, opts };
    });
    ui.quiz = { items, idx: 0, score: 0, picked: null };
    drawQuiz();
  }
  function drawQuiz() {
    const q = ui.quiz;
    if (!q) { renderKey(); return; }
    if (q.idx >= q.items.length) {
      const pct = Math.round(q.score / q.items.length * 100);
      $page.innerHTML = `<section class="done-screen">
        <div class="done-emoji">${pct >= 80 ? '🏆' : '💪'}</div>
        <h2>强化完成</h2>
        <p>正确率 <b>${pct}%</b>（${q.score}/${q.items.length}）</p>
        <div class="actions">
          <button class="btn primary" id="again">再来一轮</button>
          <button class="btn" id="back">返回重点</button>
        </div></section>`;
      $page.querySelector('#again').onclick = () => startQuiz();
      $page.querySelector('#back').onclick = () => renderKey();
      return;
    }
    const it = q.items[q.idx];
    const cur = q.idx + 1, total = q.items.length;
    const optsHTML = it.opts.map((o, idx) => {
      const w = WORD_MAP[o.toLowerCase()];
      return `<button class="opt" data-w="${esc(o)}" data-id="${w ? w.id : ''}" data-i="${idx}">${esc(o)}</button>`
        + `<div class="opt-mean hidden" id="om${idx}">${w ? esc(w.meaning) : ''}</div>`;
    }).join('');
    $page.innerHTML = `
      <section class="quiz">
        <div class="study-top"><span>重点强化</span><span>${cur} / ${total}</span><button class="x" id="x">✕</button></div>
        <div class="prog"><i style="width:${cur / total * 100}%"></i></div>
        <div class="quiz-q">“${esc(it.meaning)}” 对应的单词是？</div>
        <div class="opts" id="opts">${optsHTML}</div>
        <div class="quiz-fb hidden" id="fb"></div>
        <div class="study-btns"><button class="btn primary hidden" id="next">下一题 →</button></div>
      </section>`;
    const optsBox = $page.querySelector('#opts');
    const fb = $page.querySelector('#fb');
    const nextBtn = $page.querySelector('#next');
    $page.querySelector('#x').onclick = () => renderKey();
    optsBox.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        if (!q.picked) {
          // 首次作答：判定正误
          q.picked = btn.dataset.w;
          const correct = q.picked === it.answer;
          if (correct) q.score++;
          optsBox.querySelectorAll('.opt').forEach(b => {
            if (b.dataset.w === it.answer) b.classList.add('right');
            else if (b === btn) b.classList.add('wrong');
          });
          fb.classList.remove('hidden');
          fb.className = 'quiz-fb ' + (correct ? 'good' : 'bad');
          fb.innerHTML = correct ? '✓ 答对了！点其他选项可看释义' : `✗ 正确答案：<b>${esc(it.answer)}</b> · 点其他选项可看释义`;
          nextBtn.classList.remove('hidden');
          save();
        } else {
          // 已作答：点击任意选项展开/收起其中文释义
          const om = $page.querySelector('#om' + btn.dataset.i);
          if (om) om.classList.toggle('hidden');
        }
      };
    });
    nextBtn.onclick = () => { q.idx++; q.picked = null; drawQuiz(); };
  }
  function renderKey() {
    const ids = Object.keys(S.key).map(Number);
    if (!ids.length) {
      $page.innerHTML = `<section class="empty">
        <div style="font-size:42px">⭐</div>
        <p>重点词库为空。</p>
        <p class="muted">背诵时「不认识」或拼写写错的词会自动加入这里。</p>
        <button class="btn primary" id="b">返回学习台</button></section>`;
      $page.querySelector('#b').onclick = () => switchTab('dash');
      return;
    }
    const rows = ids.map(id => {
      const w = wordById(id); const k = S.key[id];
      const srcLabel = { flash: '背诵', spell: '拼写', review: '复习' }[k.src] || '复习';
      return `<div class="key-row">
        <div class="key-w">${esc(w.word)} <span class="key-ph">/${esc(w.phonetic)}/</span></div>
        <div class="key-m">${esc(w.pos)} ${esc(w.meaning)}</div>
        <span class="tag">${srcLabel}</span>
        <button class="key-del" data-id="${id}">移除</button>
      </div>`;
    }).join('');
    $page.innerHTML = `<section class="key">
      <div class="key-head">
        <h3 class="sec-t">⭐ 重点词（${ids.length}）</h3>
        <button class="btn primary" id="quiz">开始强化</button>
      </div>
      <div class="key-list">${rows}</div>
    </section>`;
    $page.querySelector('#quiz').onclick = () => startQuiz();
    $page.querySelectorAll('.key-del').forEach(b => b.onclick = () => {
      delete S.key[+b.dataset.id]; save(); renderKey();
    });
  }

  /* ---------- Tab 切换 ---------- */
  function switchTab(tab) {
    ui.tab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'dash') renderDash();
    else if (tab === 'study') renderStudy();
    else if (tab === 'spell') renderSpell();
    else if (tab === 'review') renderReview();
    else if (tab === 'key') renderKey();
    $page.scrollTop = 0;
  }

  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => switchTab(t.dataset.tab);
  });

  // 启动
  switchTab('dash');
  // 暴露给调试
  window.__IELTS__ = { S, WORDS, LISTS, ARTICLES, _test: { startSpell, renderSpell, renderSpellRead, renderSpellCloze, getArticle, spellWordMap, showWordPop, hideWordPop, startQuiz, renderKey, startStudy } };
})();
