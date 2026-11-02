'use strict';
// 平台注册表 + 跨平台兜底
const { probeSize } = require('./http');
const netease = require('./netease');
const kuwo = require('./kuwo');
const kugou = require('./kugou');
const migu = require('./migu');

const platforms = { netease, kuwo, kugou, migu };
const platformNames = {
  netease: '网易云',
  kuwo: '酷我',
  kugou: '酷狗',
  migu: '咪咕',
};

// 规范化标题用于跨平台匹配
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[（(【\[].*?[)）\]】]/g, '')
    .replace(/[\s'"·,，。.\-—_&]+/g, '');

// 校验解析结果：探测大小 + 试听片段识别（码率异常低 = 片段）
async function validateResolution(track, r) {
  if (!r || !r.url) return null;
  const size = r.size || (await probeSize(r.url));
  const durSec = (Number(track.durationMs) || 0) / 1000;
  let clip = false;
  if (size && durSec > 90 && size / durSec < 8000) clip = true; // <8KB/s 必为片段
  if (!durSec && size && size < 300000) clip = true;            // 无时长但 <300KB 也可疑
  return { url: r.url, size, clip };
}

function matchTrack(list, track) {
  const t = norm(track.title);
  const a = norm(track.artist).split('/')[0];
  return (
    // 1. 标题+歌手都匹配
    list.find((x) => norm(x.title) === t && (!a || norm(x.artist).includes(a))) ||
    // 2. 标题包含+歌手匹配
    list.find((x) => norm(x.title).includes(t) && (!a || norm(x.artist).includes(a))) ||
    // 3. 兜底：仅标题完全一致
    list.find((x) => norm(x.title) === t) ||
    null
  );
}

// 依次尝试其它平台拿完整歌曲（咪咕优先：匿名可取全曲）
async function resolveWithFallback(track, log) {
  const order = ['migu', 'netease', 'kuwo', 'kugou'].filter((p) => p !== track.platform);
  let suspect = null;
  for (const p of order) {
    try {
      const svc = platforms[p];
      const kw = `${track.artist ? track.artist.split('/')[0] + ' ' : ''}${track.title}`;
      const { tracks } = await svc.search(kw, 1, 5);
      const hit = matchTrack(tracks, track);
      if (!hit) continue;
      const r = await svc.resolveUrl(hit);
      const v = await validateResolution({ ...hit, durationMs: hit.durationMs || track.durationMs }, r);
      if (!v) continue;
      if (v.clip) {
        if (!suspect) suspect = { ...hit, url: v.url, size: v.size, via: p, clip: true };
        continue;
      }
      return { ...hit, url: v.url, size: v.size, via: p };
    } catch (e) {
      if (log) log(`${p} 兜底失败: ${e.message}`);
    }
  }
  return suspect; // 全是片段时返回最优嫌疑，由调用方决定
}

module.exports = { platforms, platformNames, resolveWithFallback, validateResolution, matchTrack, norm };
