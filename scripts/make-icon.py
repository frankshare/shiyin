#!/usr/bin/env python3
# 生成 Melody 图标：原图放大裁剪为底 + 深墨玻璃音符覆盖层
import base64
from PIL import Image

ASSETS = r"E:\zcode\workspace\Melody\全网音乐桌面应用\assets"

# 1) 原图等比放大 cover 裁剪到 1024×1024
img = Image.open(f"{ASSETS}\\icon-base.png").convert("RGB")
w, h = img.size
scale = max(1024 / w, 1024 / h)
img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
left = (img.width - 1024) // 2
top = (img.height - 1024) // 2
img = img.crop((left, top, left + 1024, top + 1024))
img.save(f"{ASSETS}\\icon-base-1024.png")
b64 = base64.b64encode(open(f"{ASSETS}\\icon-base-1024.png", "rb").read()).decode()

# 2) SVG：底图 + 音符覆盖层（squircle 裁切）
svg = """<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="squircle">
      <path d="M0 512 C0 137 137 0 512 0 S1024 137 1024 512 887 1024 512 1024 0 887 0 512 Z"/>
    </clipPath>
    <radialGradient id="noteHalo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#1A0B52" stop-opacity="0.42"/>
      <stop offset="0.72" stop-color="#1A0B52" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#1A0B52" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="noteGlass" x1="0" y1="0" x2="0.15" y2="1">
      <stop offset="0" stop-color="#3A1E9E" stop-opacity="0.94"/>
      <stop offset="0.55" stop-color="#2A1478" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#1C0C5A" stop-opacity="0.88"/>
    </linearGradient>
    <linearGradient id="headInk" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#3A1E9E"/>
      <stop offset="1" stop-color="#1C0C5A"/>
    </linearGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="20"/>
    </filter>
    <filter id="soft2" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
  </defs>

  <g clip-path="url(#squircle)">
    <image x="0" y="0" width="1024" height="1024" xlink:href="data:image/png;base64,__B64__"/>

    <!-- 音符背后光晕（提升可读性） -->
    <circle cx="512" cy="500" r="330" fill="url(#noteHalo)"/>
    <ellipse cx="512" cy="830" rx="225" ry="40" fill="#1A0B52" opacity="0.4" filter="url(#soft)"/>

    <!-- 深墨玻璃音符 + 白高光边 -->
    <g stroke-linecap="round">
      <g fill="none" stroke="#1C0C5A" stroke-opacity="0.5">
        <path d="M386 372 L386 636" stroke-width="54"/>
        <path d="M672 312 L672 582" stroke-width="54"/>
        <path d="M386 372 L672 312" stroke-width="68"/>
      </g>
      <g fill="none" stroke="url(#noteGlass)" stroke-width="46">
        <path d="M386 372 L386 636"/>
        <path d="M672 312 L672 582"/>
        <path d="M386 372 L672 312" stroke-width="60"/>
      </g>
      <g fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="4">
        <path d="M364 372 L364 636"/>
        <path d="M650 312 L650 582"/>
        <path d="M362 346 L678 284"/>
      </g>
    </g>
    <ellipse cx="358" cy="664" rx="76" ry="56" fill="url(#headInk)" transform="rotate(-16 358 664)"/>
    <ellipse cx="358" cy="664" rx="76" ry="56" fill="none" stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="4" transform="rotate(-16 358 664)"/>
    <ellipse cx="644" cy="610" rx="76" ry="56" fill="url(#headInk)" transform="rotate(-16 644 610)"/>
    <ellipse cx="644" cy="610" rx="76" ry="56" fill="none" stroke="#FFFFFF" stroke-opacity="0.8" stroke-width="4" transform="rotate(-16 644 610)"/>
    <ellipse cx="332" cy="638" rx="28" ry="13" fill="#FFFFFF" opacity="0.92" filter="url(#soft)" transform="rotate(-16 332 638)"/>
    <ellipse cx="618" cy="584" rx="24" ry="11" fill="#FFFFFF" opacity="0.85" filter="url(#soft)" transform="rotate(-16 618 584)"/>
    <ellipse cx="484" cy="310" rx="140" ry="30" fill="#FFFFFF" opacity="0.35" filter="url(#soft2)" transform="rotate(-11 484 310)"/>

    <path d="M 830 150 Q 839 175 864 184 Q 839 193 830 218 Q 821 193 796 184 Q 821 175 830 150 Z" fill="#FFFFFF" opacity="0.95"/>
  </g>
</svg>
""".replace("__B64__", b64)

with open(f"{ASSETS}\\icon.svg", "w", encoding="utf-8") as f:
    f.write(svg)
print("icon.svg 已生成（嵌入底图 + 音符），大小:", len(svg) // 1024, "KB")
