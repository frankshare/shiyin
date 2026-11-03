'use strict';
/* 拾音 — 渲染层逻辑 */
const $ = (sel) => document.querySelector(sel);
const audio = $('#audio');

const PLATFORM_NAMES = { netease: '网易云', kuwo: '酷我', kugou: '酷狗', migu: '咪咕' };

// 封面加载失败时的占位图（内联 SVG 音符）
const PLACEHOLDER_COVER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 84"><rect width="84" height="84" rx="10" fill="#26262e"/><path d="M52 20v29.5a9.5 9.5 0 1 1-4-7.75V28l-14 4v25.5a9.5 9.5 0 1 1-4-7.75V26l22-6z" fill="#4a4a56"/></svg>`
  );
window.PLACEHOLDER_COVER = PLACEHOLDER_COVER;

// 封面加载失败统一换占位图（捕获阶段，CSP 友好）
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.classList.contains('r-cover') && !img.src.startsWith('data:')) {
      img.src = PLACEHOLDER_COVER;
    }
  },
  true
);

const state = {
  platform: 'kuwo',
  keyword: '',
  page: 1,
  results: [],          // 当前搜索结果
  hasMore: false,
  view: 'search',
  queue: [],
  queueIndex: -1,
  current: null,        // 正在播放的 track（可能被兜底替换过）
  playing: false,
  loadingTrack: false,
  mode: localStorage.getItem('melody-mode') || 'list', // list | single | shuffle
  favorites: [],
  recent: [],
  lyric: [],            // [{t, text}]
  lyricIndex: -1,
  viewBeforeLyrics: 'search',
  seekLock: false,
};

/* ---------------- 工具 ---------------- */
const keyOf = (t) => `${t.platform}:${t.id}`;
const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, isError = false, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function updateRangeFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--fill', pct + '%');
}

/* ---------------- 存储 ---------------- */
async function loadStore() {
  const s = await window.melody.storeGet();
  state.favorites = s.favorites || [];
  state.recent = s.recent || [];
  if (s.settings) {
    state.platform = s.settings.platform || 'netease';
    if (typeof s.settings.volume === 'number') audio.volume = s.settings.volume;
    applyTheme(s.settings.theme || 'dark');
  }
  $('#volume').value = Math.round(audio.volume * 100);
  updateRangeFill($('#volume'));
  renderBadges();
}
const persist = {
  favorites: () => window.melody.storeSet('favorites', state.favorites),
  recent: () => window.melody.storeSet('recent', state.recent),
  settings: () =>
    window.melody.storeSet('settings', {
      platform: state.platform,
      volume: audio.volume,
      mode: state.mode,
      theme: document.body.dataset.theme || 'dark',
    }),
};

function renderBadges() {
  $('#fav-count').textContent = state.favorites.length || '';
}

/* ---------------- 视图切换 ---------------- */
document.querySelectorAll('.nav-item').forEach((el) => {
  el.addEventListener('click', () => switchView(el.dataset.view));
});
function switchView(view) {
  // 歌词是独立"正在播放"视图：记住来路，便于返回
  if (view !== 'lyrics' && view !== state.view) state.viewBeforeLyrics = view;
  state.view = view;
  const navView = view === 'lyrics' ? state.viewBeforeLyrics || 'search' : view;
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.view === navView));
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  $(`#view-${view}`).classList.add('active');
  $('#btn-lyric').classList.toggle('active', view === 'lyrics');
  if (view === 'queue') renderQueue();
  if (view === 'fav') renderFav();
  if (view === 'recent') renderRecent();
  if (view === 'dl') { renderDl(); refreshDlInfo(); }
  if (view === 'lyrics') tickLyric(audio.currentTime, true);
  $('#empty-hint').hidden = !(view === 'search' && !state.results.length);
}

/* ---------------- 搜索 ---------------- */
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch(true);
});
$('#platform-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  state.platform = chip.dataset.platform;
  persist.settings();
  if (state.keyword) doSearch(true);
});
$('#load-more').addEventListener('click', () => doSearch(false));

/* 相关度排序：精确标题 + 歌手命中置顶，其余保持平台原序 */
function relevanceSort(tracks, keyword) {
  const toks = String(keyword).toLowerCase().split(/\s+/).filter(Boolean);
  if (!toks.length) return tracks;
  const score = (t) => {
    const title = String(t.title || '').toLowerCase();
    const artist = String(t.artist || '').toLowerCase();
    let s = 0;
    if (toks[0]) {
      if (title === toks[0]) s += 4;
      else if (title.includes(toks[0])) s += 2;
    }
    if (toks[1] && artist.includes(toks[1])) s += 2;
    return -s;
  };
  return tracks
    .map((t, i) => [t, i])
    .sort((a, b) => score(a[0]) - score(b[0]) || a[1] - b[1])
    .map((x) => x[0]);
}

async function doSearch(reset) {
  const kw = $('#search-input').value.trim();
  if (!kw) return;
  if (reset) {
    state.keyword = kw;
    state.page = 1;
    state.results = [];
  }
  $('#load-more').hidden = true;
  $('#result-meta').textContent = '搜索中…';
  try {
    if (state.platform === 'all') {
      const names = Object.keys(PLATFORM_NAMES);
      const settled = await Promise.allSettled(
        names.map((p) => window.melody.search({ platform: p, keyword: state.keyword, page: state.page, pageSize: 20 }))
      );
      let merged = [];
      const errors = [];
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value.ok) merged = merged.concat(r.value.tracks);
        else errors.push(PLATFORM_NAMES[names[i]]);
      });
      // 全部模式下去重：同平台同 id
      const seen = new Set();
      merged = merged.filter((t) => (seen.has(keyOf(t)) ? false : (seen.add(keyOf(t)), true)));
      merged = relevanceSort(merged, state.keyword);
      state.results = reset ? merged : state.results.concat(merged);
      state.hasMore = false;
      $('#result-meta').textContent = errors.length
        ? `「${state.keyword}」${errors.join('、')}源暂不可用，其余共 ${state.results.length} 条`
        : `「${state.keyword}」共 ${state.results.length} 条`;
    } else {
      const r = await window.melody.search({ platform: state.platform, keyword: state.keyword, page: state.page, pageSize: 30 });
      if (!r.ok) throw new Error(r.error);
      const sorted = relevanceSort(r.tracks, state.keyword);
      state.results = reset ? sorted : state.results.concat(sorted);
      state.hasMore = state.results.length < Math.min(r.total, 500);
      $('#result-meta').textContent = `「${state.keyword}」${PLATFORM_NAMES[state.platform]} 共 ${r.total} 条`;
    }
    state.page += 1;
    renderSearch();
  } catch (err) {
    $('#result-meta').textContent = '';
    toast('搜索失败：' + err.message, true);
  }
  $('#empty-hint').hidden = !(state.view === 'search' && !state.results.length);
}

function rowHTML(t, i, opts = {}) {
  const liked = state.favorites.some((f) => keyOf(f) === keyOf(t));
  const playing = state.current && keyOf(state.current) === keyOf(t) && t.__via;
  const platTag = opts.showPlatform && t.__via ? `<span class="plat-tag">${t.__via}</span>` : '';
  return `
  <div class="row ${playing ? 'playing' : ''} ${liked ? 'liked-row' : ''}" data-i="${opts.realIndex ?? i}" data-list="${opts.listName || 'search'}">
    <div class="r-idx">${i + 1}</div>
    <img class="r-cover" src="${esc(t.cover)}" alt="" loading="lazy" />
    <div class="r-main">
      <div class="r-title">${esc(t.title)}${platTag}</div>
      <div class="r-artist">${esc(t.artist) || '未知歌手'}</div>
    </div>
    <div class="r-album">${esc(t.album)}</div>
    <div class="r-dur">${t.durationMs ? fmtTime(t.durationMs / 1000) : '--:--'}</div>
    <div class="r-actions">
      <button class="icon-btn act-like ${liked ? 'liked' : ''}" title="我喜欢">
        <svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.7-10-9.3C.5 8 2.5 4.5 6 4.5c2.2 0 4 1.3 6 3.6 2-2.3 3.8-3.6 6-3.6 3.5 0 5.5 3.5 4 7.2C19.5 16.3 12 21 12 21z"/></svg>
      </button>
      <button class="icon-btn act-dl" title="下载">
        <svg viewBox="0 0 24 24"><path d="M12 4v10m0 0l-4-4m4 4l4-4M5 19h14"/></svg>
      </button>
    </div>
  </div>`;
}

function renderSearch() {
  $('#search-list').innerHTML = state.results
    .map((t, i) => rowHTML(t, i, { showPlatform: true, realIndex: i }))
    .join('');
  $('#load-more').hidden = !state.hasMore;
}

/* 列表事件代理（双击播放 / 收藏 / 下载） */
function bindList(selector, getList) {
  $(selector).addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const list = getList();
    const track = list[Number(row.dataset.i)];
    if (!track) return;
    if (e.target.closest('.act-like')) return toggleFav(track);
    if (e.target.closest('.act-dl')) return downloadTrack(track);
  });
  $(selector).addEventListener('dblclick', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const list = getList();
    const track = list[Number(row.dataset.i)];
    if (track) playFromList(list, Number(row.dataset.i));
  });
}
bindList('#search-list', () => state.results);
bindList('#queue-list', () => state.queue);
bindList('#fav-list', () => state.favorites);
bindList('#recent-list', () => state.recent);

/* ---------------- 收藏 / 最近 ---------------- */
function toggleFav(track) {
  const i = state.favorites.findIndex((f) => keyOf(f) === keyOf(track));
  if (i > -1) {
    state.favorites.splice(i, 1);
    toast('已从「我喜欢」移除');
  } else {
    state.favorites.unshift({ ...track, likedAt: Date.now() });
    toast('已加入「我喜欢」');
  }
  persist.favorites();
  renderBadges();
  markLikeUI();
  if (state.view === 'fav') renderFav();
  syncPlayerFavBtn();
}

function markLikeUI() {
  document.querySelectorAll('.row').forEach((row) => {
    const listName = row.dataset.list;
    const list =
      listName === 'search' ? state.results : listName === 'queue' ? state.queue : listName === 'fav' ? state.favorites : state.recent;
    const t = list[Number(row.dataset.i)];
    if (!t) return;
    const liked = state.favorites.some((f) => keyOf(f) === keyOf(t));
    row.classList.toggle('liked-row', liked);
    const btn = row.querySelector('.act-like');
    if (btn) btn.classList.toggle('liked', liked);
  });
}

function pushRecent(track) {
  state.recent = [{ ...track, playedAt: Date.now() }, ...state.recent.filter((t) => keyOf(t) !== keyOf(track))].slice(0, 100);
  persist.recent();
}

function renderFav() {
  $('#fav-list').innerHTML = state.favorites.length
    ? state.favorites.map((t, i) => rowHTML(t, i, { showPlatform: true })).join('')
    : emptyRow('还没有喜欢的歌曲，双击任意歌曲开始听');
  markLikeUI();
}
function renderRecent() {
  $('#recent-list').innerHTML = state.recent.length
    ? state.recent.map((t, i) => rowHTML(t, i, { showPlatform: true })).join('')
    : emptyRow('暂无播放记录');
  markLikeUI();
}
function renderQueue() {
  $('#queue-list').innerHTML = state.queue.length
    ? state.queue.map((t, i) => rowHTML(t, i, { showPlatform: true })).join('')
    : emptyRow('队列为空，去搜索页双击歌曲吧');
  markLikeUI();
}
const emptyRow = (text) => `<div class="r-empty" style="text-align:center;color:var(--text-3);padding:60px 0">${esc(text)}</div>`;

$('#clear-queue').addEventListener('click', () => {
  state.queue = state.current ? [state.current] : [];
  state.queueIndex = state.current ? 0 : -1;
  renderQueue();
  toast('队列已清空');
});

/* ---------------- 播放 ---------------- */
function playFromList(list, index) {
  state.queue = list.slice();
  state.queueIndex = index;
  playCurrent(list[index]);
}

async function playCurrent(track) {
  if (!track) return;
  if (state.loadingTrack) return;
  state.loadingTrack = true;
  state.current = track;
  updatePlayerMeta(track, '加载中…');
  highlightPlaying();
  try {
    const r = await window.melody.resolve(track);
    if (!r.ok) throw new Error(r.error || '无法播放');
    const finalTrack = r.track && keyOf(r.track) !== keyOf(track) ? r.track : track;
    finalTrack.__via = PLATFORM_NAMES[r.via] || r.via;
    finalTrack.__playUrl = r.url;
    if (keyOf(finalTrack) !== keyOf(track)) {
      finalTrack.__fallbackFrom = PLATFORM_NAMES[track.platform] || track.platform;
    }
    state.current = finalTrack;
    // 替换队列中的条目，保持队列指针正确
    const qi = state.queue.findIndex((t) => keyOf(t) === keyOf(track));
    if (qi > -1) {
      state.queue[qi] = finalTrack;
      state.queueIndex = qi;
    }
    audio.src = finalTrack.__playUrl;
    await audio.play();
    updatePlayerMeta(finalTrack);
    pushRecent(finalTrack);
    syncPlayerFavBtn();
    highlightPlaying();
    loadLyric(finalTrack);
    persist.settings();
  } catch (err) {
    updatePlayerMeta(state.current, '播放失败');
    toast('播放失败：' + err.message, true);
  } finally {
    state.loadingTrack = false;
  }
}

function updatePlayerMeta(track, sub) {
  $('#pl-title').textContent = track.title || '未在播放';
  $('#pl-artist').textContent =
    sub || [track.artist, track.__via ? `${track.__via}音源` : ''].filter(Boolean).join(' · ') || '拾音';
  $('#pl-cover').src = track.cover || '';
  $('#now-mini').hidden = false;
  $('#now-mini-cover').src = track.cover || '';
  $('#now-mini-title').textContent = track.title || '';
  $('#now-mini-artist').textContent = track.artist || '';
  $('#ly-title').textContent = track.title || '';
  $('#ly-artist').textContent = track.artist || '';
  $('#ly-cover').src = track.cover || '';
  const srcEl = $('#ly-src');
  if (srcEl) srcEl.textContent = track.__via ? `音源：${track.__via}` : '';
  document.title = track.title ? `${track.title} - 拾音` : '拾音';
  // 系统媒体浮层（MediaSession）
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        artwork: track.cover ? [{ src: track.cover, sizes: '512x512' }] : [],
      });
    } catch {}
  }
}

if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => nextTrack(false, true));
    navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(false));
  } catch {}
}

function highlightPlaying() {
  document.querySelectorAll('.row').forEach((row) => {
    const listName = row.dataset.list;
    const list =
      listName === 'search' ? state.results : listName === 'queue' ? state.queue : listName === 'fav' ? state.favorites : state.recent;
    const t = list[Number(row.dataset.i)];
    row.classList.toggle('playing', !!t && !!state.current && keyOf(t) === keyOf(state.current));
  });
  if (state.view === 'queue') renderQueue();
}

function syncPlayerFavBtn() {
  const liked = state.current && state.favorites.some((f) => keyOf(f) === keyOf(state.current));
  $('#btn-fav-player').classList.toggle('liked', !!liked);
}

/* ---------------- 音频事件 ---------------- */
audio.addEventListener('play', () => {
  state.playing = true;
  $('#ic-play').style.display = 'none';
  $('#ic-pause').style.display = '';
});
audio.addEventListener('pause', () => {
  state.playing = false;
  $('#ic-play').style.display = '';
  $('#ic-pause').style.display = 'none';
});
audio.addEventListener('ended', () => nextTrack(true));
audio.addEventListener('playing', () => {
  failStreak = 0;
  retryDone = false;
});

// 播放链接失效自动重取一次；仍失败则自动跳下一首
let retryDone = false;
let failStreak = 0;
function autoSkip() {
  failStreak += 1;
  if (state.queue.length > 1 && failStreak <= state.queue.length) {
    toast('这首播不了，自动切下一首');
    setTimeout(() => nextTrack(false), 900);
  } else {
    toast('播放失败', true);
  }
}
audio.addEventListener('error', () => {
  if (!audio.src || !state.current || state.loadingTrack) return;
  if (!retryDone) {
    retryDone = true;
    const at = audio.currentTime || 0;
    const t = state.current;
    toast('播放链接失效，重新获取…');
    window.melody
      .resolve(t)
      .then((r) => {
        if (r.ok) {
          audio.src = r.url;
          audio.currentTime = at;
          audio.play().catch(autoSkip);
        } else {
          autoSkip();
        }
      })
      .catch(autoSkip);
  } else {
    autoSkip();
  }
});
audio.addEventListener('timeupdate', () => {
  if (state.seekLock) return;
  const d = audio.duration || 0;
  $('#time-cur').textContent = fmtTime(audio.currentTime);
  $('#time-total').textContent = fmtTime(d);
  const p = d ? (audio.currentTime / d) * 1000 : 0;
  $('#progress').value = p;
  updateRangeFill($('#progress'));
  tickLyric(audio.currentTime);
});

$('#btn-play').addEventListener('click', () => {
  if (!audio.src) {
    if (state.results.length) playFromList(state.results, 0);
    return;
  }
  audio.paused ? audio.play() : audio.pause();
});
$('#btn-prev').addEventListener('click', () => nextTrack(false, true));
$('#btn-next').addEventListener('click', () => nextTrack(false));
$('#btn-fav-player').addEventListener('click', () => state.current && toggleFav(state.current));
$('#btn-dl').addEventListener('click', () => state.current && downloadTrack(state.current));

$('#progress').addEventListener('input', (e) => {
  state.seekLock = true;
  updateRangeFill(e.target);
  $('#time-cur').textContent = fmtTime((e.target.value / 1000) * (audio.duration || 0));
});
$('#progress').addEventListener('change', (e) => {
  if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
  state.seekLock = false;
});
$('#volume').addEventListener('input', (e) => {
  audio.volume = e.target.value / 100;
  updateRangeFill(e.target);
  persist.settings();
});

/* 播放模式 */
const MODE_ICONS = {
  list: '<path d="M4 7h11M4 12h11M4 17h7" /><path d="M18 8v8l4-4z" fill="currentColor" stroke="none"/>',
  single: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5a9.5 9.5 0 1 0 9.5 9.5"/><path d="M21.5 12V7m0 5h-5" transform="rotate(45 12 12)"/>',
  shuffle: '<path d="M3 7h4l10 10h4M3 17h4M17 7h4"/><path d="M19 5l2 2-2 2M19 15l2 2-2 2"/>',
};
function renderModeIcon() {
  $('#ic-mode').innerHTML = MODE_ICONS[state.mode] || MODE_ICONS.list;
  $('#btn-mode').title = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' }[state.mode];
}
$('#btn-mode').addEventListener('click', () => {
  state.mode = { list: 'single', single: 'shuffle', shuffle: 'list' }[state.mode];
  localStorage.setItem('melody-mode', state.mode);
  renderModeIcon();
  toast({ list: '列表循环', single: '单曲循环', shuffle: '随机播放' }[state.mode]);
});

function nextTrack(auto = false, prev = false) {
  if (!state.queue.length) return;
  if (auto && state.mode === 'single') {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  let idx;
  if (state.mode === 'shuffle' && state.queue.length > 1) {
    do {
      idx = Math.floor(Math.random() * state.queue.length);
    } while (idx === state.queueIndex);
  } else {
    idx = prev ? state.queueIndex - 1 : state.queueIndex + 1;
    if (idx >= state.queue.length) idx = 0;
    if (idx < 0) idx = state.queue.length - 1;
  }
  state.queueIndex = idx;
  playCurrent(state.queue[idx]);
}

/* ---------------- 正在播放 / 歌词视图 ---------------- */
function toggleLyricsView() {
  switchView(state.view === 'lyrics' ? state.viewBeforeLyrics || 'search' : 'lyrics');
}
$('#btn-lyric').addEventListener('click', toggleLyricsView);
$('#ly-back').addEventListener('click', toggleLyricsView);
$('#pl-cover').addEventListener('click', () => switchView('lyrics'));
document.querySelector('.pl-meta').addEventListener('click', () => switchView('lyrics'));

// 点击歌词跳转到该句
$('#ly-scroll').addEventListener('click', (e) => {
  const line = e.target.closest('.ly-line');
  if (!line || line.classList.contains('empty-lyric')) return;
  const l = state.lyric[Number(line.dataset.i)];
  if (l && Number.isFinite(l.t) && audio.duration && l.t <= audio.duration) {
    audio.currentTime = l.t;
    tickLyric(l.t, true);
  }
});

async function loadLyric(track) {
  state.lyric = [];
  state.lyricIndex = -1;
  $('#ly-scroll').innerHTML = '<div class="ly-line">歌词加载中…</div>';
  try {
    const r = await window.melody.lyric(track);
    const raw = r.lyric || '';
    const lines = parseLRC(raw);
    state.lyric = lines;
    $('#ly-scroll').innerHTML = lines.length
      ? lines.map((l, i) => `<div class="ly-line" data-i="${i}">${esc(l.text) || '&nbsp;'}</div>`).join('')
      : '<div class="ly-line empty-lyric">暂无歌词</div>';
  } catch {
    $('#ly-scroll').innerHTML = '<div class="ly-line empty-lyric">暂无歌词</div>';
  }
}

function parseLRC(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const times = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!times.length) continue;
    const content = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of times) {
      const t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + (m[3] ? parseInt(m[3].padEnd(3, '0'), 10) / 1000 : 0);
      out.push({ t, text: content });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

function tickLyric(cur, force = false) {
  if (!state.lyric.length) return;
  if (state.view !== 'lyrics' && !force) return;
  let idx = -1;
  for (let i = 0; i < state.lyric.length; i++) {
    if (state.lyric[i].t <= cur + 0.2) idx = i;
    else break;
  }
  if (idx === state.lyricIndex && !force) return;
  state.lyricIndex = idx;
  document.querySelectorAll('.ly-line').forEach((el) => {
    const i = Number(el.dataset.i);
    el.classList.toggle('active', i === idx);
    el.classList.toggle('past', i < idx);
  });
  const active = $(`.ly-line[data-i="${idx}"]`);
  if (active) {
    const box = $('#ly-scroll');
    box.scrollTo({ top: active.offsetTop - box.clientHeight * 0.35, behavior: 'smooth' });
  }
}

/* ---------------- 下载队列 ---------------- */
state.downloads = [];
const DL_STATUS = { queued: '排队中', downloading: '下载中', done: '已完成', failed: '失败', canceled: '已取消' };
const prevStatus = new Map();

function renderDl() {
  const box = $('#dl-list');
  if (!box) return;
  if (!state.downloads.length) {
    box.innerHTML = emptyRow('队列为空 — 在歌曲上点下载按钮即可加入队列');
    return;
  }
  box.innerHTML = state.downloads
    .map((d) => {
      const pct = d.total ? Math.min(100, (d.received / d.total) * 100) : d.status === 'done' ? 100 : 0;
      const sizeTxt = d.total
        ? `${(d.received / 1048576).toFixed(1)} / ${(d.total / 1048576).toFixed(1)}MB`
        : d.status === 'done'
          ? '已完成'
          : '';
      const errTxt = d.status === 'failed' && d.error ? ` · ${esc(d.error)}` : '';
      const actions =
        d.status === 'downloading' || d.status === 'queued'
          ? `<button class="icon-btn dl-cancel" data-id="${d.id}" title="取消"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`
          : d.status === 'failed' || d.status === 'canceled'
            ? `<button class="icon-btn dl-retry" data-id="${d.id}" title="重试"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/></svg></button>`
            : `<button class="icon-btn dl-show" data-id="${d.id}" title="在文件夹中显示"><svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>`;
      return `
      <div class="dl-item">
        <img src="${esc(d.cover)}" alt="" />
        <div class="dl-main">
          <div class="dl-title">${esc(d.title)}</div>
          <div class="dl-sub">${esc(d.artist)}${d.platform ? ' · ' + esc(d.platform) : ''}</div>
        </div>
        <div class="dl-progress">
          <div class="dl-bar"><i style="width:${pct}%"></i></div>
          <div class="dl-status ${d.status}">${DL_STATUS[d.status] || d.status}${sizeTxt ? ' · ' + sizeTxt : ''}${errTxt}</div>
        </div>
        <div class="dl-actions">${actions}</div>
      </div>`;
    })
    .join('');
  // 状态变化 toast
  for (const d of state.downloads) {
    const prev = prevStatus.get(d.id);
    if (prev && prev !== 'done' && d.status === 'done') toast(`已下载：${d.artist} - ${d.title}`);
    prevStatus.set(d.id, d.status);
  }
  const active = state.downloads.filter((d) => ['queued', 'downloading'].includes(d.status)).length;
  $('#dl-count').textContent = active || '';
}

function bindDlList() {
  $('#dl-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.classList.contains('dl-cancel')) window.melody.downloadCancel(btn.dataset.id);
    else if (btn.classList.contains('dl-retry')) window.melody.downloadRetry(btn.dataset.id);
    else if (btn.classList.contains('dl-show')) {
      const d = state.downloads.find((x) => x.id === btn.dataset.id);
      if (d) window.melody.downloadShowItem(d.filePath);
    }
  });
}
window.melody.onDownloadState((items) => {
  state.downloads = items || [];
  renderDl();
});

async function downloadTrack(track) {
  let url = track.__playUrl;
  if (!url) {
    toast('解析下载链接…');
    const r = await window.melody.resolve(track).catch(() => null);
    if (!r || !r.ok) {
      toast('取不到下载链接：' + ((r && r.error) || ''), true);
      return;
    }
    url = r.url;
  }
  const { ok, error } = await window.melody.downloadEnqueue({
    track: { title: track.title, artist: track.artist, cover: track.cover, platform: track.platform },
    url,
  });
  toast(ok ? '已加入下载队列' : '加入失败：' + (error || ''), !ok);
}

async function refreshDlInfo() {
  const { dir } = await window.melody.downloadInfo();
  const el = $('#dl-dir-row');
  if (el) el.textContent = '下载目录：' + dir;
}
$('#dl-open').addEventListener('click', () => window.melody.downloadOpenDir());
$('#dl-dir').addEventListener('click', async () => {
  const r = await window.melody.downloadChooseDir();
  if (r.ok) refreshDlInfo();
});
$('#dl-clear').addEventListener('click', () => window.melody.downloadClearFinished());
bindDlList();

/* ---------------- 窗口控制 / 快捷键 ---------------- */
$('#wc-close').addEventListener('click', () => window.melody.win('close'));
$('#wc-min').addEventListener('click', () => window.melody.win('minimize'));
$('#wc-max').addEventListener('click', () => window.melody.win('maximize'));
$('#titlebar').addEventListener('dblclick', (e) => {
  if (!e.target.closest('.wc-btn')) window.melody.win('maximize');
});
window.melody.onMaximized((maxed) => {
  $('#ic-max').style.display = maxed ? 'none' : '';
  $('#ic-restore').style.display = maxed ? '' : 'none';
});

/* ---------------- 主题 ---------------- */
const THEMES = [
  { id: 'dark', name: '星空', color: '#1b2136' },
  { id: 'midnight', name: '雾蓝', color: '#1a1e28' },
  { id: 'rose', name: '灰玫', color: '#2a2126' },
  { id: 'forest', name: '苔原', color: '#1e211d' },
  { id: 'light', name: '晨雾', color: '#e8e6df' },
];
function applyTheme(id) {
  document.body.dataset.theme = id;
  document.querySelectorAll('.theme-dot').forEach((d) => d.classList.toggle('active', d.dataset.theme === id));
}
$('#theme-row').innerHTML = THEMES.map(
  (t) => `<button class="theme-dot" data-theme="${t.id}" title="${t.name}" style="background:${t.color}"></button>`
).join('');
$('#theme-row').addEventListener('click', (e) => {
  const dot = e.target.closest('.theme-dot');
  if (!dot) return;
  applyTheme(dot.dataset.theme);
  persist.settings();
  toast(`已切换主题：${THEMES.find((t) => t.id === dot.dataset.theme).name}`);
});

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Escape' && state.view === 'lyrics') {
    switchView(state.viewBeforeLyrics || 'search');
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    $('#btn-play').click();
  } else if (e.code === 'ArrowLeft' && audio.duration) {
    audio.currentTime = Math.max(0, audio.currentTime - 5);
  } else if (e.code === 'ArrowRight' && audio.duration) {
    audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  } else if (e.code === 'ArrowUp') {
    audio.volume = Math.min(1, audio.volume + 0.05);
    $('#volume').value = audio.volume * 100;
    updateRangeFill($('#volume'));
  } else if (e.code === 'ArrowDown') {
    audio.volume = Math.max(0, audio.volume - 0.05);
    $('#volume').value = audio.volume * 100;
    updateRangeFill($('#volume'));
  }
});

/* ---------------- 启动 ---------------- */
(async () => {
  await loadStore();
  renderModeIcon();
  updateRangeFill($('#progress'));
  document.querySelector(`.chip[data-platform="${state.platform}"]`)?.classList.add('active');
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.platform === state.platform));
  switchView('search');
  $('#empty-hint').hidden = false;
})();
