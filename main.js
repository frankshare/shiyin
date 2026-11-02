'use strict';
// Melody 拾音 — Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const services = require('./services');
const dlManager = require('./downloads');

let win = null;
let tray = null;
let quitting = false;
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// ---------- 简单 JSON 存储（收藏 / 最近播放 / 设置） ----------
const storePath = () => path.join(app.getPath('userData'), 'melody-store.json');
let store = { favorites: [], recent: [], settings: { platform: 'kuwo', volume: 0.8, mode: 'list', theme: 'dark' } };

function loadStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), 'utf-8'));
    store = { ...store, ...data };
  } catch {
    /* 首次运行 */
  }
}
function saveStore() {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf-8');
  } catch (e) {
    console.error('store save failed:', e.message);
  }
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#16161b',
    title: 'Melody 拾音',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  // 关窗隐藏到托盘，后台继续播放；托盘菜单“退出”才真正退出
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
    tray.setToolTip('Melody 拾音 — 后台播放中');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主界面', click: () => { if (win) { win.show(); win.focus(); } } },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
  } catch (e) {
    console.error('tray init failed:', e.message);
  }
}

app.whenReady().then(() => {
  loadStore();
  createWindow();
  dlManager.setWin(win);
  createTray();
});
app.on('before-quit', () => {
  quitting = true;
});
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
app.on('window-all-closed', () => app.quit());

// ---------- 窗口控制 ----------
ipcMain.handle('win:minimize', () => win.minimize());
ipcMain.handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.handle('win:close', () => win.close());

// ---------- 音乐 API ----------
function fixUrl(u) {
  // 网易 CDN http → https（避免任何加载限制）
  if (u && u.startsWith('http://') && /music\.126\.net/.test(u)) return u.replace('http://', 'https://');
  return u;
}

ipcMain.handle('music:search', async (e, { platform, keyword, page, pageSize }) => {
  try {
    const svc = services.platforms[platform];
    if (!svc) throw new Error('未知平台 ' + platform);
    const r = await svc.search(keyword, page || 1, pageSize || 30);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err.message, tracks: [], total: 0 };
  }
});

ipcMain.handle('music:resolve', async (e, track) => {
  try {
    const svc = services.platforms[track.platform];
    let primary = null;
    if (svc) {
      const r = await svc.resolveUrl(track);
      primary = await services.validateResolution(track, r);
    }
    if (primary && !primary.clip) {
      return { ok: true, url: fixUrl(primary.url), via: track.platform, track };
    }
    // 本源不可播 / 试听片段 → 跨平台兜底
    const fb = await services.resolveWithFallback(track);
    if (fb && fb.url) return { ok: true, url: fixUrl(fb.url), via: fb.platform, track: fb };
    if (primary) return { ok: true, url: fixUrl(primary.url), via: track.platform, track, clip: true };
    return { ok: false, error: '各音源均取不到可播放链接' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 歌词获取（本平台 → 全平台互备），歌词视图与下载共用
async function fetchLyricWithFallback(track) {
  const tryLyric = async (platform, t) => {
    const svc = services.platforms[platform];
    if (!svc || !svc.lyric) return null;
    const r = await svc.lyric(t);
    return r && r.lyric ? r : null;
  };
  const own = await tryLyric(track.platform, track).catch(() => null);
  if (own) return own;
  const order = ['netease', 'kuwo', 'migu', 'kugou'].filter((p) => p !== track.platform);
  const kw = `${track.artist ? track.artist.split('/')[0] + ' ' : ''}${track.title}`;
  for (const p of order) {
    try {
      const { tracks } = await services.platforms[p].search(kw, 1, 5);
      const hit = services.matchTrack(tracks, track);
      if (!hit) continue;
      const r = await tryLyric(p, hit);
      if (r) return r;
    } catch {
      /* 尝试下一平台 */
    }
  }
  return { lyric: '', trans: '' };
}

ipcMain.handle('music:lyric', async (e, track) => {
  try {
    const r = await fetchLyricWithFallback(track);
    return { ok: true, ...r };
  } catch {
    return { ok: true, lyric: '', trans: '' };
  }
});

// ---------- 下载队列 ----------
function getDownloadDir() {
  return store.settings.downloadDir || path.join(app.getPath('music'), 'Melody');
}

ipcMain.handle('download:enqueue', async (e, { track, url }) => {
  if (!url) return { ok: false, error: '无下载链接' };
  const dir = getDownloadDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  let lyric = '';
  try {
    const r = await fetchLyricWithFallback(track);
    lyric = r.lyric || '';
  } catch {}
  const item = dlManager.enqueue({ track, url, dir, lyric, cover: track.cover || '' });
  return { ok: !!item, id: item && item.id, dir };
});

ipcMain.handle('download:list', () => dlManager.list());
ipcMain.handle('download:cancel', (e, id) => dlManager.cancel(id));
ipcMain.handle('download:retry', (e, id) => dlManager.retry(id));
ipcMain.handle('download:clearFinished', () => dlManager.clearFinished());
ipcMain.handle('download:info', () => ({ dir: getDownloadDir() }));
ipcMain.handle('download:openDir', async () => {
  const dir = getDownloadDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return shell.openPath(dir);
});
ipcMain.handle('download:showItem', (e, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  return true;
});
ipcMain.handle('download:chooseDir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择下载目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false };
  store.settings.downloadDir = r.filePaths[0];
  saveStore();
  return { ok: true, dir: r.filePaths[0] };
});

// ---------- 存储 ----------
ipcMain.handle('store:get', () => store);
ipcMain.handle('store:set', (e, { key, value }) => {
  store[key] = value;
  saveStore();
  return true;
});
