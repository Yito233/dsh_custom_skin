#!/usr/bin/env python3
"""
Generate the sample backgrounds shipped in `assets/`.

Every pixel here is drawn by this script, so the samples carry the same MIT
license as the plugin and can be redistributed. They exist only to make the
first run of the plugin pleasant; nothing in the plugin depends on them.

Usage:  python scripts/make-samples.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")

WIDTH, HEIGHT = 1920, 1080


def gradient(size, top, bottom):
    """A smooth two-stop vertical gradient."""
    mask = Image.linear_gradient("L").resize(size, Image.BILINEAR)
    return ImageOps.colorize(mask, top, bottom).convert("RGB")


def soft_blob(layer, center, radius, color, alpha, blur):
    """Paint one blurred circle onto an RGBA layer."""
    x, y = center
    blob = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(blob)
    draw.ellipse(
        [x - radius, y - radius, x + radius, y + radius],
        fill=(color[0], color[1], color[2], alpha),
    )
    blob = blob.filter(ImageFilter.GaussianBlur(blur))
    layer.alpha_composite(blob)


def sample_orbit():
    """Indigo dusk with three drifting light pools — readable in both schemes."""
    base = gradient((WIDTH, HEIGHT), (24, 22, 54), (11, 16, 32))
    layer = base.convert("RGBA")
    soft_blob(layer, (int(WIDTH * 0.72), int(HEIGHT * 0.28)), 430, (56, 189, 248), 120, 160)
    soft_blob(layer, (int(WIDTH * 0.24), int(HEIGHT * 0.74)), 380, (251, 191, 36), 70, 150)
    soft_blob(layer, (int(WIDTH * 0.52), int(HEIGHT * 0.10)), 300, (167, 139, 250), 90, 140)
    return layer.convert("RGB")


def sample_dunes():
    """Warm sand ridges; the light version of the panel still reads over it."""
    base = gradient((WIDTH, HEIGHT), (253, 246, 236), (226, 205, 181))
    layer = base.convert("RGBA")
    dunes = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(dunes)
    ridges = [
        (0.62, (198, 161, 128), 190),
        (0.72, (176, 132, 96), 170),
        (0.84, (140, 98, 66), 150),
    ]
    for i, (baseline, color, alpha) in enumerate(ridges):
        points = []
        for step in range(0, WIDTH + 80, 80):
            wave = math.sin(step / 620.0 + i * 1.7) * 46 + math.cos(step / 240.0 + i) * 14
            points.append((step, int(HEIGHT * baseline) + wave))
        points.append((WIDTH, HEIGHT))
        points.append((0, HEIGHT))
        draw.polygon(points, fill=(color[0], color[1], color[2], alpha))
    dunes = dunes.filter(ImageFilter.GaussianBlur(6))
    layer.alpha_composite(dunes)
    soft_blob(layer, (int(WIDTH * 0.18), int(HEIGHT * 0.16)), 220, (255, 234, 196), 110, 130)
    return layer.convert("RGB")


def sample_haze():
    """Soft pastel haze — a quiet background for dark and light themes."""
    base = gradient((WIDTH, HEIGHT), (238, 242, 255), (231, 240, 236))
    layer = base.convert("RGBA")
    soft_blob(layer, (int(WIDTH * 0.30), int(HEIGHT * 0.35)), 420, (147, 197, 253), 96, 170)
    soft_blob(layer, (int(WIDTH * 0.74), int(HEIGHT * 0.66)), 460, (167, 243, 208), 110, 190)
    return layer.convert("RGB")


def sample_pulse():
    """A looping ring pulse, small enough to keep the repository light."""
    size = (720, 405)
    frames = []
    count = 20
    for index in range(count):
        phase = index / float(count)
        base = gradient(size, (12, 14, 26), (26, 20, 46)).convert("RGBA")
        ring = Image.new("RGBA", size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(ring)
        cx, cy = size[0] * 0.5, size[1] * 0.5
        for offset in (0.0, 0.34, 0.67):
            t = (phase + offset) % 1.0
            radius = 26 + t * 190
            alpha = int(190 * (1.0 - t) ** 1.6)
            if alpha <= 0:
                continue
            box = [cx - radius, cy - radius * 0.5, cx + radius, cy + radius * 0.5]
            draw.ellipse(box, outline=(96, 208, 255, alpha), width=max(2, int(9 * (1.0 - t)) + 2))
        ring = ring.filter(ImageFilter.GaussianBlur(2))
        base.alpha_composite(ring)
        frames.append(base.convert("RGB"))
    paletted = [frame.convert("P", palette=Image.ADAPTIVE, colors=160) for frame in frames]
    return paletted


def main():
    os.makedirs(OUT, exist_ok=True)

    ImageOps.fit(sample_orbit(), (WIDTH, HEIGHT)).save(os.path.join(OUT, "sample-orbit.png"), optimize=True)
    ImageOps.fit(sample_dunes(), (WIDTH, HEIGHT)).save(os.path.join(OUT, "sample-dunes.png"), optimize=True)
    ImageOps.fit(sample_haze(), (WIDTH, HEIGHT)).save(os.path.join(OUT, "sample-haze.webp"), quality=86)

    pulse = sample_pulse()
    pulse[0].save(
        os.path.join(OUT, "sample-pulse.gif"),
        save_all=True,
        append_images=pulse[1:],
        duration=90,
        loop=0,
        optimize=True,
        disposal=2,
    )

    for name in sorted(os.listdir(OUT)):
        path = os.path.join(OUT, name)
        with Image.open(path) as probe:
            probe.load()
            frames = getattr(probe, "n_frames", 1)
        print("%-20s %7.1f KB  %s  frames=%d" % (name, os.path.getsize(path) / 1024.0, probe.format, frames))


if __name__ == "__main__":
    main()
