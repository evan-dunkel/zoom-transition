# Builds a standalone prototype as one self-contained HTML file:
#   python3 standalone/build.py portfolio        -> dist/portfolio.html (+ dist/portfolio-artifact.html)
#   python3 standalone/build.py portfolio-icons  -> dist/portfolio-icons.html (+ ...-artifact.html)
# Stylesheets, the script and SVG images are inlined; the page markup is the folder's index.html
# as written. The -artifact file leaves out the document skeleton (for publishing).
import base64, pathlib, re, subprocess, sys

name = sys.argv[1] if len(sys.argv) > 1 else "portfolio"
here = pathlib.Path(__file__).parent / name
root = pathlib.Path(__file__).parent.parent
dist = root / "dist"
dist.mkdir(exist_ok=True)

subprocess.run(["npx", "esbuild", str(here / "island.tsx"), "--bundle", "--minify", "--format=iife", "--target=es2020",
                '--define:process.env.NODE_ENV="production"', f"--outfile={dist / (name + '.js')}"], check=True, cwd=root)

def svg(path):
    return f'src="data:image/svg+xml;base64,{base64.b64encode(path.read_bytes()).decode()}"'

# <!-- include ../other/content.html --> shares markup between prototypes. Its images
# resolve from the included file's own folder.
def include(m):
    path = (here / m.group(1)).resolve()
    return re.sub(r'src="([^"]+\.svg)"', lambda n: svg(path.parent / n.group(1)), path.read_text())

html = re.sub(r"<!-- include (\S+) -->", include, (here / "index.html").read_text())
js = (dist / (name + ".js")).read_text().replace("</script", "<\\/script")

# Every local stylesheet (zoom.css, corners.css, style.css) is inlined where it's linked.
html = re.sub(r'<link rel="stylesheet" href="(?!https?:)([^"]+\.css)">', lambda m: f"<style>\n{(here / m.group(1)).read_text()}\n</style>", html)
html = html.replace('<script src="island.js"></script>', f"<script>\n{js}\n</script>")

html = re.sub(r'src="([^"]+\.svg)"', lambda m: svg(here / m.group(1)), html)
assert "<style>" in html and "<script>" in html and "<link rel=\"stylesheet\" href=\"." not in html, "index.html must link its stylesheets and island.js as the portfolio's does"

(dist / (name + ".html")).write_text(html)

body = html
for pat in [r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</html>\s*", r"<head>\s*", r"</head>\s*", r"<body>\s*", r"</body>\s*",
            r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*']:
    body = re.sub(pat, "", body, count=1)
(dist / (name + "-artifact.html")).write_text(body)
print(name, len(html) // 1024, "KB")
