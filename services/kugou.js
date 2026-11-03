'use strict';
// 酷狗音乐
const { fetchJson, md5 } = require('./http');

async function search(keyword, page = 1, pageSize = 30) {
  if (!keyword) return { tracks: [], total: 0 };
  const url =
    `http://msearchcdn.kugou.com/api/v3/search/song?pagesize=${pageSize}` +
    `&keyword=${encodeURIComponent(keyword)}&page=${page}`;
  const json = await fetchJson(url);
  const info = (json.data && json.data.info) || [];
  const tracks = info.map((s) => {
    const parsed = String(s.filename || '').replace(/、/g, ' / ');
    const idx = parsed.indexOf(' - ');
    const artist = idx > -1 ? parsed.slice(0, idx) : '';
    const title = idx > -1 ? parsed.slice(idx + 3) : parsed;
    return {
      platform: 'kugou',
      id: s.hash,
      hash: s.hash,
      title: title.replace(/\.(mp3|flac|m4a|ape)$/i, ''),
      artist,
      album: s.album_name || '',
      durationMs: (Number(s.duration) || 0) * 1000,
      cover: pickCover(s),
      vip: false,
    };
  });
  return { tracks, total: (json.data && json.data.total) || tracks.length };
}

function pickCover(s) {
  return (
    s.sizable_cover ||
    s.album_sizable_cover ||
    s.cover ||
    s.albumcover ||
    ''
  );
}

// 播放直链：getSongInfo → 三种 tracker 变体（参考 music-lib 公开实现）
async function resolveUrl(track) {
  const hash = (track.hash || track.id || '').toUpperCase();
  // 1) m.kugou getSongInfo（部分歌曲返回空 url）
  try {
    const json = await fetchJson(
      `http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${hash}`
    );
    const url = json && json.url;
    if (url && /^https?:\/\//.test(url)) return { url, size: Number(json.fileSize) || 0 };
  } catch {
    /* 落到下一个 */
  }
  // 2) tracker 变体
  const variants = [
    `https://trackercdn.kugou.com/i/v2/?cdnBackup=1&behavior=download&pid=1&cmd=21&appid=1001&hash=${hash}&key=${md5(hash + 'kgcloudv2')}`,
    `http://trackercdnbj.kugou.com/i/v2/?cmd=23&pid=1&behavior=download&hash=${hash}&key=${md5(hash + 'kgcloudv2')}`,
    `http://trackercdn.kugou.com/i/?cmd=4&pid=1&forceDown=0&vip=1&hash=${hash}&key=${md5(hash + 'kgcloud')}`,
  ];
  for (const u of variants) {
    try {
      const json = await fetchJson(u, { timeoutMs: 7000 });
      const list = Array.isArray(json && json.url) ? json.url : json && json.url ? [json.url] : [];
      if (list.length && list[0]) {
        return {
          url: list.find((x) => x.startsWith('https')) || list[0],
          size: Number(json.fileSize) || 0,
        };
      }
    } catch {
      /* 尝试下一个变体 */
    }
  }
  return { url: null, size: 0 };
}

async function lyric(track) {
  const hash = track.hash || track.id;
  const s = await fetchJson(
    `http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&hash=${hash}`
  );
  const cand = (s.candidates && s.candidates[0]) || null;
  if (!cand) return { lyric: '', trans: '' };
  const d = await fetchJson(
    `http://lyrics.kugou.com/download?ver=1&client=pc&id=${cand.id}&fmt=lrc`
  );
  const content = d && d.content;
  if (!content) return { lyric: '', trans: '' };
  return { lyric: Buffer.from(content, 'base64').toString('utf-8'), trans: '' };
}

module.exports = { search, resolveUrl, lyric };
