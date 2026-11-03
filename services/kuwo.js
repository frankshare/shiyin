'use strict';
// 酷我音乐
const { fetchJson } = require('./http');

async function search(keyword, page = 1, pageSize = 30) {
  const url =
    `https://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(keyword)}` +
    `&pn=${page - 1}&rn=${pageSize}&vipver=1&ft=music&encoding=utf8&rformat=json&mobi=1`;
  const json = await fetchJson(url, { headers: { Referer: 'https://www.kuwo.cn/' } });
  const list = json.abslist || [];
  const tracks = list.map((it) => ({
    platform: 'kuwo',
    id: String(it.DC_TARGETID || it.id || ''),
    title: it.NAME || it.name || '',
    artist: (it.ARTIST || it.artist || '').replace(/&/g, ' / '),
    album: it.ALBUM || it.album || '',
    durationMs: (Number(it.DURATION) || 0) * 1000,
    cover: pickCover(it),
    vip: it.isListenLimit === 1 || it.payInfo ? true : false,
  }));
  return { tracks, total: Number(json.TOTAL) || tracks.length };
}

function pickCover(it) {
  const c =
    it.web_albumpic_short ||
    it.albumpic ||
    it.hts_AVARTM ||
    (it.web_albumpic && it.web_albumpic.replace('_120', '_500')) ||
    '';
  if (!c) return '';
  return c.startsWith('http') ? c : 'https://img4.kuwo.cn/star/albumcover/' + c;
}

// 播放直链：antiserver 返回纯文本直链；www 接口需登录态，仅作尝试
async function resolveUrl(track) {
  // 1) antiserver（纯文本 mp3 直链，实测可用）
  try {
    const r = await fetch(
      `https://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${track.id}&format=mp3|aac&response=url`,
      { headers: { 'User-Agent': UA_KUWO } }
    );
    const text = (await r.text()).trim();
    if (r.ok && /^https?:\/\//.test(text)) return { url: text, size: 0 };
  } catch {
    /* 落到下一个 */
  }
  // 2) www 接口
  try {
    const json = await fetchJson(
      `https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${track.id}&type=1`,
      {
        headers: { Referer: 'https://www.kuwo.cn/', Origin: 'https://www.kuwo.cn' },
        timeoutMs: 7000,
      }
    );
    const url = json && json.data && json.data.url;
    if (url) return { url, size: 0 };
  } catch {
    /* 全部失败 */
  }
  return { url: null, size: 0 };
}

const UA_KUWO =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function lyric(track) {
  const json = await fetchJson(
    `https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${track.id}`
  );
  const rows = (json.data && json.data.lrclist) || [];
  const lrc = rows
    .map((r) => {
      const t = Number(r.time) || 0;
      const m = String(Math.floor(t / 60)).padStart(2, '0');
      const s = String(Math.floor(t % 60)).padStart(2, '0');
      const cs = String(Math.round((t % 1) * 100)).padStart(2, '0');
      return `[${m}:${s}.${cs}]${r.lineLyric}`;
    })
    .join('\n');
  return { lyric: lrc, trans: '' };
}

module.exports = { search, resolveUrl, lyric };
