"""Render the shared SVG mark as installable icons (requires PyGObject/Rsvg and Cairo)."""
from pathlib import Path
import xml.etree.ElementTree as ET

import cairo
import gi

gi.require_version("Rsvg", "2.0")
from gi.repository import Rsvg


public = Path(__file__).resolve().parents[1] / "public"
source = (public / "favicon.svg").read_bytes()

for name, size, full_background in [
    ("pwa-192.png", 192, False),
    ("pwa-512.png", 512, False),
    ("pwa-maskable-512.png", 512, True),
    ("apple-touch-icon.png", 180, True),
]:
    root = ET.fromstring(source)
    # Keep more space around the book when a launcher enlarges or masks the icon.
    artwork = ET.Element("{http://www.w3.org/2000/svg}g", {
        "transform": "translate(64 64) scale(0.75) translate(-64 -64)"
    })
    for element in list(root):
        if element.get("id") != "background":
            root.remove(element)
            artwork.append(element)
    root.append(artwork)
    if full_background:
        background = next(element for element in root if element.get("id") == "background")
        for attribute, value in {"x": "0", "y": "0", "width": "128", "height": "128", "rx": "0", "stroke": "none"}.items():
            background.set(attribute, value)
    surface = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    viewport = Rsvg.Rectangle()
    viewport.x = viewport.y = 0
    viewport.width = viewport.height = size
    Rsvg.Handle.new_from_data(ET.tostring(root)).render_document(cairo.Context(surface), viewport)
    surface.write_to_png(str(public / name))
    print(f"{name}: {size}×{size}")
