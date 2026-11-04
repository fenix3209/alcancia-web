#!/usr/bin/env python3
"""Genera la versión web (iPhone) de Cerdito Cadejo (Mis gastos) a partir del index.html de Android.

Uso:
  python3 tools/build-web.py RUTA/AL/app/src/main/assets/index.html [RUTA/ICONO.png]

No modifica nada del proyecto Android: solo lee su index.html y escribe aquí
index.html, sw.js e íconos. Cada vez que cambie la app de Android, se vuelve a
correr este script para traer los cambios a la versión web.
"""
import hashlib, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]).read_text(encoding="utf-8")
icon_src = Path(sys.argv[2]) if len(sys.argv) > 2 else None


def sub(pattern, repl, text, count=1, flags=0):
    new, n = re.subn(pattern, repl, text, count=count, flags=flags)
    if n == 0:
        sys.exit(f"No encontré el patrón: {pattern[:70]}")
    return new


html = src

# 1. Fuentes locales (funciona sin internet) en lugar de Google Fonts.
html = sub(r'<link rel="preconnect" href="https://fonts\.googleapis\.com">\s*'
           r'<link rel="preconnect" href="https://fonts\.gstatic\.com" crossorigin>\s*'
           r'<link href="https://fonts\.googleapis\.com/css2[^"]*" rel="stylesheet">',
           '<link rel="stylesheet" href="fonts/fonts.css">', html)

# 2. Instalación en iPhone: manifest, ícono, barra de estado.
html = sub(r'(<meta name="apple-mobile-web-app-title" content="[^"]*">)',
           r'\1\n'
           '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n'
           '<meta name="format-detection" content="telephone=no">\n'
           '<link rel="manifest" href="manifest.webmanifest">\n'
           '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">', html)

# 3. Sin datos personales: el formulario inicial empieza vacío.
html = sub(r'(id="oSal" type="number" inputmode="decimal" step="0\.01") value="[^"]*"',
           r'\1 placeholder="0.00"', html)
html = sub(r'(id="oGoal" type="number" inputmode="decimal" step="1") value="[^"]*"',
           r'\1 placeholder="150"', html)
html = sub(r'(id="oStart" type="number" inputmode="decimal" step="0\.01") value="[^"]*"',
           r'\1 placeholder="0.00"', html)
html = sub(r'const DEFAULT_SUBS = \[.*?\];', 'const DEFAULT_SUBS = [];', html, flags=re.S)
html = html.replace("sceneFiestero(830.22,", "sceneFiestero(800,")
for secret in ("1437.84", "830.22", "607.62", "3673", "9559", "Cisneros"):
    if secret in html:
        sys.exit(f"Quedó un dato personal en la versión web: {secret}")

# 4. Código propio de iPhone (PIN, respaldo, sonido, modo sin internet). Va dentro de
#    la función principal de la app para poder usar sus datos y funciones.
ios = (ROOT / "tools" / "ios.js").read_text(encoding="utf-8")
end = html.rfind("})();\n</script>")
if end < 0:
    sys.exit("No encontré el final del código principal")
html = html[:end] + "/* ===== Versión web para iPhone (tools/ios.js) ===== */\n" + ios + "\n" + html[end:]

(ROOT / "index.html").write_text(html, encoding="utf-8")

# 5. Íconos a partir del ícono de Android (sin esquinas transparentes; iOS las redondea).
if icon_src:
    from PIL import Image
    im = Image.open(icon_src).convert("RGBA")
    bg = Image.new("RGBA", im.size, im.getpixel((im.width // 2, 30)))
    full = Image.alpha_composite(bg, im).convert("RGB")
    out = ROOT / "icons"
    out.mkdir(exist_ok=True)
    for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        full.resize((size, size), Image.LANCZOS).save(out / name, optimize=True)
    # Versión "maskable" con margen, para Android/Chrome si alguien la instala ahí.
    pad = Image.new("RGB", (640, 640), full.getpixel((256, 30)))
    pad.paste(full, (64, 64))
    pad.resize((512, 512), Image.LANCZOS).save(out / "icon-maskable-512.png", optimize=True)

# 6. Service worker con versión según el contenido (así el teléfono baja las actualizaciones).
files = ["./", "index.html", "manifest.webmanifest", "fonts/fonts.css",
         *sorted("fonts/" + p.name for p in (ROOT / "fonts").glob("*.woff2")),
         *sorted("icons/" + p.name for p in (ROOT / "icons").glob("*.png"))]
h = hashlib.sha256()
for f in files[1:]:
    h.update((ROOT / f).read_bytes())
version = h.hexdigest()[:10]
sw = (ROOT / "tools" / "sw.template.js").read_text(encoding="utf-8")
sw = sw.replace("__VERSION__", version).replace("__FILES__", ",\n  ".join(f'"{f}"' for f in files))
(ROOT / "sw.js").write_text(sw, encoding="utf-8")
print(f"Listo: index.html ({len(html)//1024} KB), sw.js versión {version}")
