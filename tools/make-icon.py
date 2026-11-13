"""Render media/icon.png: a speedometer dial on a dark rounded tile."""

import math
from PIL import Image, ImageDraw

SIZE = 256
S = SIZE * 4  # supersample, then downscale for smooth edges


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Background: vertical gradient, top #1b2130 -> bottom #0d1017.
    bg = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(bg)
    top = (27, 33, 48)
    bottom = (13, 16, 23)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=lerp(top, bottom, y / (S - 1)))

    mask = rounded_mask(S, radius=int(S * 0.22))
    img.paste(bg, (0, 0), mask)
    draw = ImageDraw.Draw(img)

    cx, cy = S / 2, S / 2 + S * 0.04
    radius = S * 0.30
    width = int(S * 0.062)

    # Gauge track: 220 degrees, centred at the top.
    start, end = 160, 380
    draw.arc(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        start=start,
        end=end,
        fill=(58, 66, 82),
        width=width,
    )

    # Filled arc: the first two thirds, in the VS Code blue/green ramp.
    draw.arc(
        [cx - radius, cy - radius, cx + radius, cy + radius],
        start=start,
        end=start + (end - start) * 0.68,
        fill=(55, 148, 255),
        width=width,
    )
    # Bright cap at the head of the filled arc.
    head = math.radians(start + (end - start) * 0.68)
    hx, hy = cx + radius * math.cos(head), cy + radius * math.sin(head)
    r_dot = width * 0.62
    draw.ellipse([hx - r_dot, hy - r_dot, hx + r_dot, hy + r_dot], fill=(120, 220, 190))

    # Ticks.
    for i in range(9):
        ang = math.radians(start + (end - start) * i / 8)
        r0 = radius - width * 0.95
        r1 = radius - width * 1.75
        col = (120, 132, 152) if i % 2 == 0 else (72, 80, 96)
        tw = int(S * 0.012 if i % 2 == 0 else S * 0.008)
        draw.line(
            [cx + r0 * math.cos(ang), cy + r0 * math.sin(ang),
             cx + r1 * math.cos(ang), cy + r1 * math.sin(ang)],
            fill=col,
            width=tw,
        )

    # Needle pointing at ~72% of the sweep.
    ang = math.radians(start + (end - start) * 0.72)
    length = radius - width * 0.55
    tipx, tipy = cx + length * math.cos(ang), cy + length * math.sin(ang)
    tailx, taily = cx - length * 0.22 * math.cos(ang), cy - length * 0.22 * math.sin(ang)
    draw.line([tailx, taily, tipx, tipy], fill=(238, 242, 248), width=int(S * 0.035), joint="curve")
    hub = int(S * 0.048)
    draw.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=(238, 242, 248))
    inner = int(hub * 0.52)
    draw.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=(19, 23, 33))

    # Subtle inner border so the tile reads on light and dark backgrounds.
    draw.rounded_rectangle(
        [S * 0.012, S * 0.012, S - S * 0.012, S - S * 0.012],
        radius=int(S * 0.21),
        outline=(255, 255, 255, 26),
        width=int(S * 0.008),
    )

    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    img.save("media/icon.png")
    print("wrote media/icon.png", img.size)


if __name__ == "__main__":
    main()
