# -*- coding: utf-8 -*-
"""Ikon PWA FotoDown — charcoal + aksen lime (sesuai palet UI baru)."""
from PIL import Image, ImageDraw
from pathlib import Path

OUT = Path(r"E:\FotoDown\icons")
OUT.mkdir(parents=True, exist_ok=True)

BG = (18, 18, 21, 255)        # #121215
LIME = (201, 242, 78, 255)    # #C9F24E


def make_icon(size: int, maskable: bool = False) -> Image.Image:
    S = size * 4                      # supersample
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = 0 if maskable else int(S * 0.02)
    radius = 0 if maskable else int(S * 0.22)
    d.rounded_rectangle([pad, pad, S - pad - 1, S - pad - 1], radius=radius, fill=BG)

    inner = S * (0.30 if maskable else 0.20)
    box = [inner, inner, S - inner, S - inner]
    w = box[2] - box[0]
    h = box[3] - box[1]

    stroke = max(3, int(w * 0.075))
    d.rounded_rectangle(
        [box[0], box[1], box[2], box[1] + h * 0.62],
        radius=int(w * 0.06), outline=LIME, width=stroke
    )

    cx = S / 2
    top = box[1] + h * 0.78
    bot = box[3]
    d.line([(cx, top), (cx, bot - h * 0.16)], fill=LIME, width=stroke)
    hw = w * 0.16
    d.polygon([(cx - hw, bot - h * 0.20), (cx + hw, bot - h * 0.20), (cx, bot)], fill=LIME)

    return img.resize((size, size), Image.LANCZOS)


for sz in (192, 512):
    make_icon(sz).save(OUT / f"icon-{sz}.png", optimize=True)
make_icon(512, maskable=True).save(OUT / "icon-maskable-512.png", optimize=True)

im = Image.open(OUT / "icon-192.png").convert("RGBA")
print("ikon ok:", im.size, "| px tengah:", im.getpixel((96, 90)), "| alpha sudut:", im.getpixel((1, 1))[3])
