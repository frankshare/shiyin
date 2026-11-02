'use strict';
// 下载队列管理器（主进程）：顺序执行、进度、取消/重试、歌词封面随下
const fs = require('fs');
const path = require('path');
const { net } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
const guessExt = (url) => {
  const clean = String(url || '').split(/[?#]/)[0];
  const m = /\.([a-z0-9]{3,5})$/i.exec(clean);
  return m ? '.' + m[1].toLowerCase() : '.mp3';
};

class DownloadManager {
  constructor() {
    this.items = new Map();
    this.order = [];
    this.currentId = null;
    this.seq = 1;
    this.win = null;
    this.ctrl = null;
  }
  setWin(win) { this.win = win; }

  sendState() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('download:state', this.list());
  }

  list() { return this.order.map((id) => this.items.get(id)).filter(Boolean); }

  uniquePath(dir, base, ext) {
    let p = path.join(dir, base + ext);
    let i = 1;
    while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
    return p;
  }

  enqueue({ track, url, dir, lyric, cover }) {
    if (!url) return null;
    const id = 'dl' + this.seq++;
    const base = sanitize(`${track.artist || '未知'} - ${track.title || '未命名'}`);
    const item = {
      id,
      title: track.title || '未命名',
      artist: track.artist || '',
      cover: track.cover || '',
      platform: track.platform || '',
      url,
      dir,
      filePath: this.uniquePath(dir, base, guessExt(url)),
      base,
      lyric: lyric || '',
      coverUrl: cover || '',
      status: 'queued',
      received: 0,
      total: 0,
      error: null,
    };
    this.items.set(id, item);
    this.order.push(id);
    this.sendState();
    this.pump();
    return item;
  }

  async pump() {
    if (this.currentId) return;
    const next = this.list().find((i) => i.status === 'queued');
    if (!next) return;
    this.currentId = next.id;
    await this.run(next);
    this.currentId = null;
    this.pump();
  }

  async run(item) {
    item.status = 'downloading';
    item.received = 0;
    item.error = null;
    this.sendState();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    let lastEmit = 0;
    const tmp = item.filePath + '.part';
    try {
      const res = await net.fetch(item.url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      if (!res.ok && res.status !== 206) throw new Error('HTTP ' + res.status);
      item.total = Number(res.headers.get('content-length')) || 0;
      const sink = fs.createWriteStream(tmp);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await new Promise((resolve, reject) => sink.write(Buffer.from(value), (err) => (err ? reject(err) : resolve())));
        item.received += value.length;
        const now = Date.now();
        if (now - lastEmit > 250) { lastEmit = now; this.sendState(); }
      }
      await new Promise((r) => sink.end(r));
      fs.renameSync(tmp, item.filePath);
      // 歌词 / 封面随下（借鉴 music-dl）
      if (item.lyric) {
        try { fs.writeFileSync(this.uniquePath(item.dir, item.base, '.lrc'), item.lyric, 'utf-8'); } catch {}
      }
      if (item.coverUrl) {
        try {
          const c = await net.fetch(item.coverUrl, { headers: { 'User-Agent': UA } });
          if (c.ok) {
            const buf = Buffer.from(await c.arrayBuffer());
            const pm = new URL(item.coverUrl).pathname;
            const ext = /\.png$/i.test(pm) ? '.png' : /\.webp$/i.test(pm) ? '.webp' : '.jpg';
            fs.writeFileSync(this.uniquePath(item.dir, item.base, ext), buf);
          }
        } catch {}
      }
      item.status = 'done';
      this.sendState();
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch {}
      if (item.status !== 'canceled') {
        item.status = 'failed';
        item.error = err.message || String(err);
      }
      this.sendState();
    }
  }

  cancel(id) {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === 'queued') {
      item.status = 'canceled';
      this.sendState();
    } else if (item.status === 'downloading') {
      item.status = 'canceled';
      if (this.ctrl) { try { this.ctrl.abort(); } catch {} }
    }
  }

  retry(id) {
    const item = this.items.get(id);
    if (!item || (item.status !== 'failed' && item.status !== 'canceled')) return;
    item.status = 'queued';
    item.received = 0;
    item.error = null;
    this.sendState();
    this.pump();
  }

  clearFinished() {
    this.order = this.order.filter((id) => {
      const it = this.items.get(id);
      if (it && ['done', 'canceled', 'failed'].includes(it.status)) {
        this.items.delete(id);
        return false;
      }
      return true;
    });
    this.sendState();
  }
}

module.exports = new DownloadManager();
