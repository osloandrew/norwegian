import csv
import urllib.parse
import html

SITE = "https://osloandrew.github.io/norwegian"
urls = []

# --- Words ---
with open("norwegianWords.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        word = row.get("ord", "").split(",")[0].strip()
        pos = (row.get("gender") or "").strip()
        if word:
            if pos:
                url = f"{SITE}/?type=words&pos={urllib.parse.quote(pos)}&word={urllib.parse.quote(word)}"
            else:
                url = f"{SITE}/?type=words&word={urllib.parse.quote(word)}"
            urls.append(url)

# --- Stories ---
with open("norwegianStories.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        title = (row.get("titleNorwegian") or "").strip()
        if title:
            url = f"{SITE}/?type=story&story={urllib.parse.quote(title)}"
            urls.append(url)

# --- Write sitemap.xml ---
with open("sitemap.xml", "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    f.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for u in urls:
        safe_url = html.escape(u)  # <-- escape & into &amp;
        f.write(f"  <url><loc>{safe_url}</loc></url>\n")
    f.write("</urlset>\n")

print(f"✅ Wrote sitemap.xml with {len(urls)} URLs")