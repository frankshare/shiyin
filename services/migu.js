'use strict';
// 咪咕音乐
const { fetchJson, probeSize } = require('./http');

async function search(keyword, page = 1, pageSize = 30) {
  const url =
    `https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=${encodeURIComponent(keyword)}` +
    `&pageNo=${page}&pageSize=${pageSize}&searchSwitch=${encodeURIComponent('{song:1}')}`;
  const json = await fetchJson(url);
  const result = (json.songResultData && json.songResultData.result) || [];
  const total = (json.songResultData && json.songResultData.totalCount) || result.length;
  const tracks = result.map((s) => ({
    platform: 'migu',
    id: s.copyrightId || s.contentId || '',
    copyrightId: s.copyrightId || '',
    contentId: s.contentId || s.content_id || '',
    songId: s.songId || '',
    albumId: s.albumId || (s.albums && s.albums[0] && s.albums[0].id) || '',
    title: s.name || s.songName || '',
    artist: (s.singers || s.artists || []).map((a) => a.name).join(' / '),
    album: s.album || (s.albums && s.albums[0] && s.albums[0].name) || '',
    durationMs: parseDur(s.duration || s.length || (s.tones && s.tones[0] && s.tones[0].duration)),
    cover: (s.imgItems && s.imgItems[0] && s.imgItems[0].img) || '',
    vip: s.payInfo ? true : false,
  }));
  return { tracks, total };
}

function parseDur(d) {
  const n = Number(d);
  if (!n) return 0;
  // 咪咕可能是秒或毫秒，按量级判断
  return n < 10000 ? n * 1000 : n;
}

// 播放直链：安卓端 listen-url 接口（HQ 优先，PQ 兜底），参考 music-lib 的公开实现
const MIGU_LISTEN_URL = 'https://c.musicapp.migu.cn/MIGUM2.0/v2.1/content/listen-url';
const MIGU_HEADERS = {
  'User-Agent': 'Android_migu/7.41.13 okhttp/3.12.13',
  channel: '0146832',
  version: '7.41.13',
  Referer: 'https://music.migu.cn/',
};
const MIGU_TONE_PATHS = {
  ZQ24: '歌曲下载/flac_24bit',
  ZQ32: '歌曲下载/wav_32bit',
  SQ: '歌曲下载/flac',
  HQ: '标清高清/MP3_320_16_Stero',
  PQ: '标清高清/MP3_128_16_Stero',
  LQ: '全曲试听/Mp3_64_22_16',
};

async function fetchListenUrl(track, toneFlag) {
  const cid = track.copyrightId || track.id;
  const params = new URLSearchParams({
    netType: '01',
    resourceType: '2',
    contentId: track.contentId || '',
    toneFlag,
    copyrightId: cid,
  });
  if (track.songId) params.set('songId', track.songId);
  if (track.albumId) params.set('albumId', track.albumId);
  const json = await fetchJson(`${MIGU_LISTEN_URL}?${params}`, { headers: MIGU_HEADERS });
  const url = json && json.data && json.data.url;
  if (!url) {
    const msg = (json.data && json.data.dialogInfo && json.data.dialogInfo.text) || json.info || '';
    throw new Error(msg || 'empty url');
  }
  return normalizeMiguUrl(url);
}

function normalizeMiguUrl(raw) {
  raw = String(raw).trim();
  if (raw.startsWith('//')) return 'https:' + raw;
  if (raw.startsWith('ftp://218.200.160.122:21/')) {
    return 'https://freetyst.nf.migu.cn/' + raw.slice('ftp://218.200.160.122:21/'.length);
  }
  return raw;
}

async function resolveUrl(track) {
  // 无损优先（SQ flac）→ 320k → 128k（借鉴 music-dl 音质策略）
  for (const tone of ['SQ', 'HQ', 'PQ', 'LQ']) {
    try {
      const url = await fetchListenUrl(track, tone);
      if (url) return { url, size: 0 };
    } catch {
      /* 尝试更低音质 */
    }
  }
  return { url: null, size: 0 };
}

async function lyric(track) {
  try {
    const json = await fetchJson(
      `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/lyric.do?copyrightId=${track.copyrightId || track.id}`
    );
    const raw = json.wapLyric || json.lyric || '';
    if (!raw) return { lyric: '', trans: '' };
    const text = Buffer.from(raw, 'base64').toString('utf-8');
    return { lyric: text.includes('[') ? text : '', trans: '' };
  } catch {
    return { lyric: '', trans: '' };
  }
}

async function checkPlayable(track) {
  const r = await resolveUrl(track);
  return r.url ? await probeSize(r.url) : 0;
}

module.exports = { search, resolveUrl, lyric, checkPlayable };
