# -*- coding: utf-8 -*-
"""Generate ikon PWA FotoDown (gradient violet->cyan + glyph foto & panah bawah)."""
from PIL import Image, ImageDraw
from pathlib import Path
import math

OUT = Path(r"E:\FotoDown\icons")
OUT.mkdir(parents=True, exist_ok=True)

VIOLET = (124, 92, 255)
CYAN = (34, 211, 238)
INK = (11, 13, 18, 255)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size * 0.62) + (y / size * 0.38)
            t = min(1.0, max(0.0, t))
            r = int(VIOLET[0] + (CYAN[0] - VIOLET[0]) * t)
            g = int(VIOLET[1] + (CYAN[1] - VIOLET[1]) * t)
            b = int(VIOLET[2] + (CYAN[2] - VIOLET[2]) * t)
            px[x, y] = (r, g, b)
    return img


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    S = size * 2  # render 2x lalu downscale biar tajam
    base = gradient(S).convert("RGBA")

    if maskable:
        canvas = base                        # penuh, glyph dikecilkan ke safe zone
        pad = 0.20
    else:
        # sudut membulat (squircle-ish)
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.235), fill=255)
        canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        canvas.paste(base, (0, 0), mask)
        pad = 0.10

    d = ImageDraw.Draw(canvas)
    inset = S * pad
    box = [inset, inset, S - inset, S - inset]
    w = box[2] - box[0]
    h = box[3] - box[1]

    # bingkai foto
    stroke = max(2, int(w * 0.075))
    d.rounded_rectangle(
        [box[0], box[1] + h * 0.10, box[2], box[3] - h * 0.22],
        radius=int(w * 0.16), outline=INK, width=stroke
    )

    # gunung / bukit
    fx0, fy0 = box[0] + w * 0.10, box[1] + h * 0.10
    fx1, fy1 = box[2] - w * 0.10, box[3] - h * 0.22 - h * 0.10
    mid_y = (fy0 + fy1) / 2
    d.polygon(
        [(fx0, fy1), (fx0 + (fx1 - fx0) * 0.33, mid_y - h * 0.02),
         (fx0 + (fx1 - fx0) * 0.55, fy1 - (fy1 - mid_y) * 0.25),
         (fx0 + (fx1 - fx0) * 0.75, mid_y + h * 0.03), (fx1, fy1)],
        fill=INK,
    )
    # matahari
    r = w * 0.055
    cx, cy = fx1 - w * 0.20, fy0 + h * 0.14
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=INK)

    # panah ke bawah (simbol kompres)
    ax = S / 2
    a_top = box[3] - h * 0.02
    a_bot = box[3] - h * 0.16
    d.line([(ax, a_top - h * 0.13), (ax, a_bot)], fill=INK, width=stroke)
    hw = w * 0.085
    d.polygon([(ax - hw, a_bot - hw * 0.7), (ax + hw, a_bot - hw * 0.7), (ax, a_bot + hw * 0.85)], fill=INK)

    return canvas.resize((size, size), Image.LANCZOS)


for sz in (192, 512):
    make_icon(sz).save(OUT / f"icon-{sz}.png", optimize=True)
make_icon(512, maskable=True).save(OUT / "icon-maskable-512.png", optimize=True)
print("ikon dibuat:", [p.name for p in sorted(OUT.iterdir())])
