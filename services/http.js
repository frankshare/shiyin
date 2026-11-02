'use strict';
// 通用 HTTP 助手：带超时与浏览器 UA 的 JSON 请求
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchJson(url, { headers = {}, timeoutMs = 9000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_UA, ...headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// HEAD 探测文件大小，判断是否可播/可下
async function probeSize(url, { headers = {}, timeoutMs = 6000 } = {}) {
  if (!url) return 0;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': DEFAULT_UA, ...headers },
      signal: ctrl.signal,
    });
    const len = parseInt(res.headers.get('content-length') || '', 10);
    return res.ok && Number.isFinite(len) ? len : 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

const md5 = (s) => require('node:crypto').createHash('md5').update(s).digest('hex');

module.exports = { DEFAULT_UA, fetchJson, probeSize, md5 };
