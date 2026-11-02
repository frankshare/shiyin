'use strict';
// 第三轮：酷狗带签名 songinfo + 咪咕替代端点
const { platforms } = require('../services');
const { DEFAULT_UA, md5 } = require('../services/http');
const { randomUUID } = require('node:crypto');

const KG_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

(async () => {
  const kw = '晴天 周杰伦';
  const h = { 'User-Agent': DEFAULT_UA };

  // --- kugou wwwapi songinfo（排序参数 + salt 签名）---
  const kg1 = (await platforms.kugou.search(kw, 1, 2)).tracks[0];
  const hash = kg1.hash.toUpperCase();
  const uuid = randomUUID().replace(/-/g, '');
  const clienttime = Math.floor(Date.now() / 1000).toString();
  const params = {
    appid: '1014',
    clienttime,
    clientver: '8990',
    dfid: '-',
    encrypt_error: '',
    hash,
    mid: uuid,
    platid: '4',
    srcappid: '2919',
    uuid,
  };
  const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('');
  const key = md5(sorted + KG_SALT);
  const qs = new URLSearchParams({ ...params, key }).toString();
  const ku = `https://wwwapi.kugou.com/play/songinfo?${qs}`;
  try {
    const r = await fetch(ku, { headers: h });
    const j = await r.json();
    console.log('kugou songinfo status:', j.status, 'err_code:', j.err_code);
    console.log('kugou play_url:', j.data && j.data.play_url);
    console.log('kugou album_img:', j.data && j.data.album_img);
  } catch (e) {
    console.log('kugou songinfo ERROR:', e.message);
  }

  // --- migu：带 referer 的 resourceinfo + read_PlayUrlInfo ---
  const mg1 = (await platforms.migu.search(kw, 1, 2)).tracks[0];
  const cid = mg1.copyrightId || mg1.id;
  const mh = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    Referer: 'https://m.music.migu.cn/v3',
  };
  try {
    const r = await fetch(`https://app.pd.nf.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${cid}&resourceType=0`, { headers: mh });
    const j = await r.json();
    const res0 = (j.resource && j.resource[0]) || {};
    console.log('\nmigu app.pd resourceinfo audioUrl:', res0.audioUrl || '(无)');
  } catch (e) {
    console.log('\nmigu app.pd ERROR:', e.message);
  }
  for (const ep of [
    `https://c.musicapp.migu.cn/MIGUM2.0/v2.1/content/read_PlayUrlInfo.do?copyrightId=${cid}&resourceType=0&toneStatus=1`,
    `https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/interact/getSongAndMvUrl.do?contentId=${cid}&resourceType=2`,
  ]) {
    try {
      const r = await fetch(ep, { headers: mh });
      const t = await r.text();
      console.log('\nmigu', ep.slice(30, 80), '→', t.slice(0, 300));
    } catch (e) {
      console.log('\nmigu', ep.slice(30, 80), 'ERROR:', e.message);
    }
  }
})();
