'use strict';
// 调试三平台取链原始返回
const { platforms } = require('../services');
const { DEFAULT_UA } = require('../services/http');

const show = (label, v) => console.log(`\n== ${label} ==\n`, typeof v === 'string' ? v.slice(0, 500) : JSON.stringify(v, null, 1).slice(0, 800));

(async () => {
  const kw = '晴天 周杰伦';
  const h = { 'User-Agent': DEFAULT_UA };

  // --- kuwo ---
  const kw1 = (await platforms.kuwo.search(kw, 1, 3)).tracks[0];
  show('kuwo track', kw1 && { id: kw1.id, title: kw1.title });
  try {
    const r = await fetch(`https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${kw1.id}&type=1`, {
      headers: { ...h, Referer: 'https://www.kuwo.cn/', Origin: 'https://www.kuwo.cn' },
    });
    show('kuwo www.playUrl status ' + r.status, await r.text());
  } catch (e) { show('kuwo www.playUrl ERROR', e.message); }
  try {
    const r = await fetch(`https://antiserver.kuwo.cn/anti.s?type=convert_url&rid=${kw1.id}&format=mp3|aac&response=url`, { headers: h });
    show('kuwo antiserver status ' + r.status, await r.text());
  } catch (e) { show('kuwo antiserver ERROR', e.message); }

  // --- kugou ---
  const kg1 = (await platforms.kugou.search(kw, 1, 3)).tracks[0];
  show('kugou track', kg1 && { hash: kg1.hash, title: kg1.title });
  try {
    const crypto = require('node:crypto');
    const key = crypto.createHash('md5').update(kg1.hash + 'kgcloudv2').digest('hex');
    const r = await fetch(`http://trackercdn.kugou.com/i/v2/?key=${key}&hash=${kg1.hash}&br=hq&appid=1005&pid=2&cmd=25&behavior=play`, { headers: h });
    show('kugou tracker status ' + r.status, await r.text());
  } catch (e) { show('kugou tracker ERROR', e.message); }

  // --- migu ---
  const mg1 = (await platforms.migu.search(kw, 1, 3)).tracks[0];
  show('migu track', mg1 && { cid: mg1.copyrightId, title: mg1.title });
  try {
    const r = await fetch(`https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${mg1.copyrightId}&resourceType=0`, { headers: h });
    const t = await r.text();
    show('migu resourceinfo status ' + r.status, t);
  } catch (e) { show('migu resourceinfo ERROR', e.message); }
})();
