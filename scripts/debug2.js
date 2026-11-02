'use strict';
// 第二轮调试：酷狗替代接口 + 咪咕 audioUrl
const { platforms } = require('../services');
const { DEFAULT_UA } = require('../services/http');
const show = (label, v) =>
  console.log(`\n== ${label} ==\n`, typeof v === 'string' ? v.slice(0, 400) : JSON.stringify(v).slice(0, 600));

(async () => {
  const kw = '晴天 周杰伦';
  const h = { 'User-Agent': DEFAULT_UA };

  // --- kugou 替代接口 ---
  const kg1 = (await platforms.kugou.search(kw, 1, 3)).tracks[0];
  try {
    const r = await fetch(`http://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=${kg1.hash}`, { headers: h });
    show('kugou getSongInfo status ' + r.status, await r.text());
  } catch (e) { show('kugou getSongInfo ERROR', e.message); }
  try {
    const r = await fetch(`https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${kg1.hash}`, {
      headers: { ...h, Cookie: 'kg_mid=e7c09bf4e2ff701959e419aa6259f5e1' },
    });
    const t = await r.text();
    show('kugou getdata status ' + r.status, t.slice(0, 900));
  } catch (e) { show('kugou getdata ERROR', e.message); }

  // --- migu：打印所有结果的 audioUrl ---
  const mgAll = (await platforms.migu.search(kw, 1, 5)).tracks;
  for (const t of mgAll) {
    try {
      const r = await fetch(`https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=${t.copyrightId || t.id}&resourceType=0`, { headers: h });
      const j = await r.json();
      const res0 = (j.resource && j.resource[0]) || {};
      show(`migu ${t.title}(${t.copyrightId}) keys`, { audioUrl: res0.audioUrl, newFlags: res0.newFlags, kbps: res0.kbps, listenType: res0.listenType, Sonic: !!res0.Sonic });
    } catch (e) { show('migu ERROR ' + t.copyrightId, e.message); }
  }
})();
