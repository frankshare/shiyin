'use strict';
// 服务层连通性测试：node scripts\test-services.js [关键词]
const { platforms, resolveWithFallback } = require('../services');

const kw = process.argv[2] || '晴天 周杰伦';
const fmtDur = (ms) => (ms ? `${(ms / 1000 / 60).toFixed(1)}min` : '-');

async function testPlatform(name, svc) {
  const out = { platform: name, ok: false };
  try {
    const t0 = Date.now();
    const { tracks, total } = await svc.search(kw, 1, 5);
    out.searchMs = Date.now() - t0;
    out.total = total;
    out.first = tracks[0]
      ? `${tracks[0].title} | ${tracks[0].artist} | ${fmtDur(tracks[0].durationMs)} | cover:${tracks[0].cover ? 'Y' : 'N'}`
      : '(空)';
    if (tracks[0]) {
      const r = await svc.resolveUrl(tracks[0]);
      out.resolved = r.url ? 'YES' : 'NO';
      if (r.url) {
        const t1 = Date.now();
        const head = await fetch(r.url, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
        out.probe = `${head.status} ${head.headers.get('content-type') || ''} in ${Date.now() - t1}ms`;
        await head.arrayBuffer().catch(() => {});
      }
    }
    out.ok = true;
  } catch (e) {
    out.error = e.message;
  }
  return out;
}

(async () => {
  console.log('关键词:', kw, '\n');
  for (const [name, svc] of Object.entries(platforms)) {
    const r = await testPlatform(name, svc);
    console.log(JSON.stringify(r, null, 1));
  }
  // 跨平台兜底测试：构造一个假“不可播”的网易云曲目，看能否在别家找到
  try {
    const { tracks } = await platforms.netease.search(kw, 1, 1);
    if (tracks[0]) {
      const fb = await resolveWithFallback({ ...tracks[0], platform: 'netease' }, () => {});
      console.log('\n跨平台兜底:', fb ? `成功 → ${fb.platform} ${fb.url.slice(0, 60)}...` : '失败');
    }
  } catch (e) {
    console.log('\n跨平台兜底异常:', e.message);
  }
})();
