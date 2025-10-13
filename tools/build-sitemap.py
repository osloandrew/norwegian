import csv

SITE = "https://osloandrew.github.io/norwegian"
urls = []

# --- Words ---
with open("norwegianWords.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        word = row.get("ord", "").split(",")[0].strip()
        if word:
            urls.append(f"{SITE}/?type=words&word={word}")

# --- Stories ---
with open("norwegianStories.csv", newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        slug = (row.get("id") or row.get("title") or "").strip().lower().replace(" ", "-")
        if slug:
            urls.append(f"{SITE}/?type=stories&story={slug}")

# --- Write sitemap.xml ---
with open("sitemap.xml", "w", encoding="utf-8") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
    f.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
    for u in urls:
        f.write(f"  <url><loc>{u}</loc></url>\n")
    f.write("</urlset>\n")

print(f"✅ Wrote sitemap.xml with {len(urls)} URLs")