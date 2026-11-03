'use strict';
// 网易云音乐（weapi 加密算法为社区公开方案，参考开源项目 musicn）
const { fetchJson } = require('./http');
const { createCipheriv, publicEncrypt, randomBytes, constants } = require('node:crypto');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36';
const UA_HEADERS = { 'User-Agent': UA };

// ---- weapi 加密（公开算法）----
const IV = Buffer.from('0102030405060708');
const PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud');
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PUBLIC_KEY =
  '-----BEGIN PUBLIC KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB\n-----END PUBLIC KEY-----';

const aesCbc = (buf, key) => {
  const c = createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([c.update(buf), c.final()]);
};

function weapi(obj) {
  const text = JSON.stringify(obj);
  const secret = randomBytes(16).map((n) => BASE62.charCodeAt(n % 62));
  const params = aesCbc(Buffer.from(aesCbc(Buffer.from(text), PRESET_KEY).toString('base64')), secret).toString('base64');
  const padded = Buffer.concat([Buffer.alloc(128 - secret.length), secret]);
  const encSecKey = publicEncrypt({ key: PUBLIC_KEY, padding: constants.RSA_NO_PADDING }, padded.reverse()).toString('hex');
  return { params, encSecKey };
}

async function search(keyword, page = 1, pageSize = 30) {
  // 旧版 web 搜索接口（匿名可用）；相关度由渲染层 relevanceSort 兜底
  const offset = (page - 1) * pageSize;
  const url =
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}` +
    `&type=1&limit=${pageSize}&offset=${offset}`;
  const json = await fetchJson(url, { headers: { Referer: 'https://music.163.com' } });
  const songs = (json.result && json.result.songs) || [];
  const total = (json.result && json.result.songCount) || songs.length;

  // 批量补封面（album.picUrl）
  let coverMap = {};
  if (songs.length) {
    try {
      const ids = songs.map((s) => s.id).filter(Boolean);
      const dUrl =
        `https://music.163.com/api/song/detail/?id=${songs[0].id}` +
        `&ids=${encodeURIComponent(JSON.stringify(ids))}`;
      const detail = await fetchJson(dUrl, { headers: { Referer: 'https://music.163.com' } });
      coverMap = Object.fromEntries(
        (detail.songs || []).map((s) => [s.id, (s.album && s.album.picUrl) || ''])
      );
    } catch {
      coverMap = {};
    }
  }

  const tracks = songs.map((s) => ({
    platform: 'netease',
    id: String(s.id),
    title: s.name,
    artist: (s.artists || []).map((a) => a.name).join(' / '),
    album: (s.album && s.album.name) || '',
    durationMs: Number(s.duration) || 0,
    cover: coverMap[s.id] || (s.album && s.album.picUrl) || '',
    vip: s.fee === 1,
  }));
  return { tracks, total };
}

// 拿播放直链（匿名可取部分歌曲；VIP/灰色返回 null）
async function resolveUrl(track) {
  const url =
    `https://music.163.com/api/song/enhance/player/url/v1?id=${track.id}` +
    `&ids=[${track.id}]&level=standard&encodeType=mp3`;
  const json = await fetchJson(url, { headers: { Referer: 'https://music.163.com', ...UA_HEADERS } });
  const d = (json.data && json.data[0]) || {};
  if (!d.url || !d.size) return { url: null, size: 0 };
  return { url: d.url, size: d.size };
}

async function lyric(track) {
  const json = await fetchJson(
    `https://music.163.com/api/song/lyric?id=${track.id}&lv=1&kv=1&tv=-1`,
    { headers: UA_HEADERS }
  );
  return { lyric: json.lrc && json.lrc.lyric || '', trans: json.tlyric && json.tlyric.lyric || '' };
}

module.exports = { search, resolveUrl, lyric };
