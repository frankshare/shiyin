# Melody 拾音

Mac 风格（液态玻璃 + 多主题）的全网音乐搜索与播放桌面应用。Electron + 原生 JS，无构建步骤。

> 仅供个人学习与听歌使用，请勿用于商业用途；各平台接口为社区公开的非官方接口，随时可能变化。

## 功能

### 搜索与播放
- **多平台聚合搜索**：酷我 / 网易云 / 酷狗 / 咪咕，支持"全部"聚合 + 结果去重 + 客户端相关度排序（原版置顶）
- **跨平台自动兜底**：本平台取不到完整音频（VIP / 试听片段）时自动在其它平台找同首歌，播放条标注实际音源
- **试听片段识别**：按 文件大小/时长 估算码率，低于 8KB/s 判为片段并自动换源
- **音质优先**：咪咕 无损 FLAC → 320K → 128K（借鉴 music-dl 的音质策略）
- **播放容错**：链接失效自动重取并恢复进度；彻底失败自动跳下一首
- **系统媒体按键**：MediaSession 集成（媒体浮层 / 键盘媒体键播放暂停切歌）

### 歌词
- 独立"正在播放"视图：大封面 + Apple Music 式大字滚动歌词
- **歌词跨平台互备**：主源无词时自动换源取词
- **点击歌词定位**：点任意一句直接跳到该处播放
- 播放条 / 侧栏迷你卡 / 任务栏标题同步

### 下载队列
- 行内下载无需先播放（自动解析链接），入队顺序执行
- 实时进度条 / 取消 / 重试 / 清除已完成 / 在文件夹中显示
- **歌词 .lrc 与封面随下**（借鉴 music-dl 的 `--lyrics --cover`）
- 下载目录可更改，文件命名 `歌手 - 标题.扩展名`，冲突自动加序号

### 应用体验
- **关窗到托盘**：✕ 隐藏窗口，后台继续播放；托盘菜单可恢复 / 退出；二次启动唤回
- **五套低饱和主题**：星空（默认，带银河星野）/ 雾蓝 / 灰玫 / 苔原 / 晨雾，即点即换并持久化
- 液态玻璃悬浮播放条、播放队列 / 我喜欢 / 最近播放（本地 JSON 持久化）
- 快捷键：空格播放暂停、←→ 快退快进 5s、↑↓ 音量、Esc 退出歌词页

## 平台能力现状（2026-11 实测）

| 平台 | 搜索 | 播放直链 | 说明 |
|------|------|----------|------|
| 酷我 | ✅ 相关度最好 | ⚠️ 热门歌为 11s 试听片段 | 默认搜索源，播放靠兜底 |
| 咪咕 | ✅ | ✅ 匿名可取完整曲（SQ/HQ） | 主要播放源（兜底首选） |
| 网易云 | ✅ | ⚠️ 免费歌全曲 / VIP 无链 | 歌词兜底源 |
| 酷狗 | ✅ | ❌ 匿名接口已全面付费墙 | 仅搜索，播放靠兜底 |

## 运行 / 分发给朋友

**直接发给朋友（推荐）**：把 `dist/Melody-SheYin-0.2.0.exe`（约 77MB 单文件）发过去，双击即用，无需安装、无需 Node。

自己打包：

```cmd
npm install
npm run dist      REM 产出 dist/Melody-SheYin-<版本>.exe
```

开发模式：

```cmd
npm install
Melody.cmd        REM 或 npx electron .
```

资源占用参考（Windows x64）：打包 exe 77MB；运行时常驻 4 个进程，工作集合计约 300–350MB（Electron 常规水位，Chromium 内核所致）。

### 应用图标

图标设计源文件为 `assets/shiyin/icon-shiyin.svg`（"拾音"概念：托起发光音符的手 + 声波，原创设计，已入库），多尺寸 PNG 在同目录。更换图标：改该 SVG 后用 Chrome headless 栅格化，再转 .ico 即可。也可用 `scripts/make-icon.py` 以任意方形图做底 + 音符覆盖生成（该脚本读取的 `assets/icon-base.png` 属版权素材，不入库）。

## 结构

```
main.js            Electron 主进程（窗口 / 托盘 / IPC / 歌词兜底）
downloads.js       下载队列管理器（顺序执行 / 进度 / 取消重试 / 歌词封面随下）
preload.js         contextBridge 安全桥
services/          各平台 API（Node fetch 自实现，可独立测试）
  http.js          请求助手（超时 / UA / HEAD 探测 / md5）
  netease.js kuwo.js kugou.js migu.js
  index.js         注册表 + 跨平台兜底 + 片段校验
renderer/          UI（液态玻璃 / 多主题 / 歌词视图 / 下载管理）
scripts/           make-icon.py 图标合成；test-services.js 四平台连通性测试；debug*.js 排错脚本
assets/            图标产物（不入库，见上）
```

## 致谢

接口方案与功能思路参考了这些开源项目：

- [zonemeen/musicn](https://github.com/zonemeen/musicn) — 各平台搜索/取链端点
- [guohuiyuan/music-lib](https://github.com/guohuiyuan/music-lib) — 咪咕安卓端 listen-url、酷狗 tracker 变体
- [0xHJK/music-dl](https://github.com/0xHJK/music-dl) — 歌词/封面随下、音质无损优先策略
- [ddd702/music-downloader](https://github.com/ddd702/music-downloader)

实现代码均为本项目重写。
