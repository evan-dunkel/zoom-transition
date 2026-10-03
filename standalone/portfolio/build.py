# Builds the standalone portfolio as one self-contained HTML file:
#   dist/portfolio.html          a normal page (open it in a browser)
#   dist/portfolio-artifact.html the same, without the document skeleton (for publishing)
# Styles, the script and the images are inlined; the page markup is index.html as written.
import base64, pathlib, re, subprocess

here = pathlib.Path(__file__).parent
root = here.parent.parent
dist = root / "dist"
dist.mkdir(exist_ok=True)

subprocess.run(["npx", "esbuild", str(here / "island.tsx"), "--bundle", "--minify", "--format=iife", "--target=es2020",
                '--define:process.env.NODE_ENV="production"', f"--outfile={dist / 'portfolio.js'}"], check=True, cwd=root)

html = (here / "index.html").read_text()
css = (root / "src/zoom/zoom.css").read_text() + "\n" + (here / "style.css").read_text()
js = (dist / "portfolio.js").read_text().replace("</script", "<\\/script")

html = html.replace('<link rel="stylesheet" href="../../src/zoom/zoom.css">\n<link rel="stylesheet" href="style.css">', f"<style>\n{css}\n</style>")
html = html.replace('<script src="island.js"></script>', f"<script>\n{js}\n</script>")

def inline(m):
    data = (here / m.group(1)).read_bytes()
    return f'src="data:image/svg+xml;base64,{base64.b64encode(data).decode()}"'
html = re.sub(r'src="(images/[^"]+\.svg)"', inline, html)

(dist / "portfolio.html").write_text(html)

# The artifact host adds its own document skeleton.
body = html
for pat in [r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</html>\s*", r"<head>\s*", r"</head>\s*", r"<body>\s*", r"</body>\s*",
            r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*']:
    body = re.sub(pat, "", body, count=1)
(dist / "portfolio-artifact.html").write_text(body)
print(len(html) // 1024, "KB")
