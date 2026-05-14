"""Generate icon set for 日线 diary PWA."""
from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))

# App color palette
BG = "#fbfaf7"
ACCENT = "#2c8277"
INK = "#1f211d"
LINE = "#d8d2c7"

def draw_icon(size, maskable=False):
    """Draw the 日线 icon: a vertical timeline with a sun circle."""
    img = Image.new("RGBA", (size, size), BG if not maskable else (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # For maskable, use safe zone (center 80%)
    if maskable:
        margin = int(size * 0.1)
        canvas_start = margin
        canvas_end = size - margin
        # Draw background circle for safe zone
        draw.ellipse([margin, margin, size - margin, size - margin], fill=BG)
    else:
        canvas_start = 0
        canvas_end = size

    effective = canvas_end - canvas_start
    center_x = size // 2
    center_y = size // 2

    # Vertical line (timeline)
    line_thickness = max(2, int(size * 0.03))
    line_top = int(canvas_start + effective * 0.28)
    line_bottom = int(canvas_start + effective * 0.78)
    draw.rectangle(
        [center_x - line_thickness // 2, line_top,
         center_x + line_thickness // 2, line_bottom],
        fill=LINE
    )

    # Sun circle at top of line
    circle_radius = max(4, int(size * 0.08))
    circle_y = line_top
    draw.ellipse(
        [center_x - circle_radius, circle_y - circle_radius,
         center_x + circle_radius, circle_y + circle_radius],
        fill=ACCENT
    )

    # Small dot at bottom of line (today marker)
    dot_radius = max(2, int(size * 0.035))
    draw.ellipse(
        [center_x - dot_radius, line_bottom - dot_radius,
         center_x + dot_radius, line_bottom + dot_radius],
        fill=INK
    )

    return img

sizes = {
    "icon-48.png":  48,
    "icon-72.png":  72,
    "icon-96.png":  96,
    "icon-128.png": 128,
    "icon-144.png": 144,
    "icon-152.png": 152,
    "icon-167.png": 167,
    "icon-180.png": 180,
    "icon-192.png": 192,
    "icon-384.png": 384,
    "icon-512.png": 512,
    "icon-1024.png": 1024,
}

maskable_sizes = {"icon-192-maskable.png": 192, "icon-512-maskable.png": 512}

for fname, sz in {**sizes, **maskable_sizes}.items():
    path = os.path.join(OUT, fname)
    maskable = "maskable" in fname
    img = draw_icon(sz, maskable=maskable)
    img.save(path, "PNG")
    kb = os.path.getsize(path) / 1024
    print(f"  {fname} ({sz}x{sz}) — {kb:.1f} KB")

print(f"\nGenerated {len(sizes) + len(maskable_sizes)} icons in {OUT}")
