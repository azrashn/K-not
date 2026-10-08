"""Regenerate the ingestion fixture PDFs (developer tool; tests only read the committed PDFs).

    python tests/ingest/fixtures/make_pdfs.py

Needs `reportlab`, `pypdf` and the DejaVu Sans font (Turkish glyphs + math symbols).
`invariant=1` makes the output byte-stable, so regenerating does not churn the files.
"""

from __future__ import annotations

import io
import textwrap
from pathlib import Path

import pypdf
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

SLIDES = [
    ["Veri Yapıları · Hafta 4", "AVL Ağaçları"],
    ["İkili Arama Ağacı (BST)",
     "Arama, ekleme ve silme ortalama O(log n) sürer. Ağaç dengesizleşirse en kötü durum O(n) olur."],
    [],  # an empty page (diagram only, no text layer)
    ["AVL Ağaçları: Denge Koşulu",
     "AVL ağacı, her düğümde sol ve sağ alt ağaç yükseklikleri arasındaki farkın en fazla 1 olduğu",
     "ikili arama ağacıdır. Denge faktörü bf(v) = h(sol) − h(sağ) ve |bf(v)| ≤ 1 olmalıdır."],
    ["Karmaşıklık Özeti",
     "Yükseklik her zaman ⌊log₂ n⌋ ile 1.44·log₂(n+2) arasındadır. Döndürmeler O(1) sürer;",
     "ﬁnal ekleme maliyeti O(log n) olur. Bazı kitaplarda Ω(log n) ve Θ(log n) gösterimi",
     "kullanılır; α katsayısı sabittir. Kümeleme analizinde O(n²) karşılaştırma gerekir."],
]

NOTES_PARAGRAPHS = [
    "Karma tabloları (hash table), anahtarları bir karma fonksiyonu yardımıyla dizinin indekslerine "
    "eşler. İyi bir karma fonksiyonu anahtarları tabloya düzgün dağıtır ve hesaplaması hızlıdır. "
    "Çakışma, iki farklı anahtarın aynı indekse düşmesidir ve her karma tablosunda kaçınılmazdır.",
    "Zincirleme (separate chaining) yönteminde aynı indekse düşen anahtarlar bağlı bir listede tutulur. "
    "Yük faktörü α = n / m olarak tanımlanır; burada n eleman sayısı, m tablo boyutudur. Ortalama "
    "arama maliyeti O(1 + α) olur ve α küçük tutulduğunda işlemler sabit zamanda tamamlanır.",
    "Açık adresleme yönteminde tüm elemanlar tablonun kendisinde saklanır. Doğrusal sondalamada "
    "çakışma olduğunda bir sonraki boş hücre aranır; bu yaklaşım birincil kümelenmeye yol açar. "
    "Karesel sondalama ve çift karma bu sorunu azaltır, ancak silme işlemi özel işaretler gerektirir.",
    "Yeniden boyutlandırma, yük faktörü belirli bir eşiği aştığında tablonun büyütülmesidir. Genellikle "
    "tablo boyutu iki katına çıkarılır ve tüm anahtarlar yeni tabloya yeniden yerleştirilir. Tek bir "
    "yeniden boyutlandırma O(n) sürse de amortize maliyet ekleme başına O(1) kalır.",
    "Türkçe metinlerde ı, İ, ğ, ş, ç, ö ve ü harfleri anahtar olarak kullanıldığında karşılaştırma "
    "Unicode normalleştirmesinden sonra yapılmalıdır. Aksi halde görünüşte aynı iki kelime farklı "
    "karma değerleri üretebilir ve arama başarısız olur.",
    "Uygulamada karma tabloları sözlükler, önbellekler ve küme veri yapılarının temelini oluşturur. "
    "Kötü seçilmiş bir karma fonksiyonu en kötü durumda tüm anahtarları aynı listeye yığar ve arama "
    "maliyeti O(n) olur. Bu nedenle evrensel karma gibi rastgeleleştirilmiş yöntemler önerilir.",
]


def _canvas(buf):
    pdfmetrics.registerFont(TTFont("DejaVu", FONT))
    return canvas.Canvas(buf, pagesize=A4, invariant=1)


def _page(c, lines, size=11):
    y = A4[1] - 72
    c.setFont("DejaVu", size)
    for line in lines:
        c.drawString(56, y, line)
        y -= size * 1.5
    c.showPage()


def slides() -> bytes:
    buf = io.BytesIO()
    c = _canvas(buf)
    for i, lines in enumerate(SLIDES):
        if not lines:
            c.rect(100, 400, 300, 200)  # a drawing without text
        _page(c, lines)
    c.save()
    return buf.getvalue()


def notes() -> bytes:
    buf = io.BytesIO()
    c = _canvas(buf)
    pages = [NOTES_PARAGRAPHS[0:2], NOTES_PARAGRAPHS[2:4], NOTES_PARAGRAPHS[4:6]]
    for n, paras in enumerate(pages):
        lines: list[str] = []
        for p in paras:
            lines.extend(textwrap.wrap(p, 88))
            lines.append("")
        if n == 0:  # a hyphenated line break and a ligature
            lines.extend(["Bu bölümdeki kavramlar sonraki hafta- ", "larda tekrar ele alınacaktır; ﬂuent okuma önerilir."])
        _page(c, lines, size=10)
    c.save()
    return buf.getvalue()


def scanned() -> bytes:
    buf = io.BytesIO()
    c = _canvas(buf)
    for _ in range(3):
        c.rect(72, 72, 400, 600, fill=1)  # an "image" of a page: no text layer
        c.showPage()
    c.save()
    return buf.getvalue()


def encrypted(source: bytes) -> bytes:
    w = pypdf.PdfWriter(clone_from=pypdf.PdfReader(io.BytesIO(source)))
    w.encrypt(user_password="gizli", owner_password="sahip", algorithm="RC4-128")
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


if __name__ == "__main__":
    s = slides()
    (HERE / "slides_tr.pdf").write_bytes(s)
    (HERE / "notes_tr.pdf").write_bytes(notes())
    (HERE / "scanned.pdf").write_bytes(scanned())
    (HERE / "encrypted.pdf").write_bytes(encrypted(s))
    print("fixtures written")
