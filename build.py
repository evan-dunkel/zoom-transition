import subprocess, pathlib
subprocess.run(["npx","esbuild","demo/main.tsx","--bundle","--minify","--format=iife","--target=es2020",
  "--define:process.env.NODE_ENV=\"production\"","--outfile=dist/app.js"],check=True)
js=pathlib.Path("dist/app.js").read_text().replace("</script","<\\/script")
css=pathlib.Path("src/zoom/zoom.css").read_text()+"\n"+pathlib.Path("demo/demo.css").read_text()
html=f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Book store zoom transition</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Fraunces:opsz,wght@9..144,500..700&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<div id="root"></div>
<script>
{js}
</script>
</body>
</html>
'''
pathlib.Path("dist/index.html").write_text(html)
print(len(html)//1024, "KB")
