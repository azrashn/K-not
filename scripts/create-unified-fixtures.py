"""Own, small academic fixtures; writes only ignored data/video-tests/unified.
Not a presentation deliverable or copied third-party lesson material.
"""
from pathlib import Path
import sys
import zipfile
from xml.sax.saxutils import escape
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

root = Path(__file__).resolve().parents[1] / 'data/video-tests/unified'
root.mkdir(parents=True, exist_ok=True)
notes = [
    'INTEGRAL VE DEGISKEN DEGISTIRME\nIntegral, birikimi ve egri altindaki alani ifade eder.\nDegisken degistirme yonteminde u = g(x) secilir.\ndu = g\'(x) dx ile integral yeni degiskene aktarilir.\nOrnek: integral 2x cos(x*x) dx icin u = x*x secilir.',
    'BELIRSIZ INTEGRAL\nBelirsiz integral sonucu bir fonksiyon ailesidir.\nIntegrasyon sabiti C, farkli sabitlerle ayrilan ilkel fonksiyonlari temsil eder.\nBu sayfa test icin yazar tarafindan olusturulmustur.',
]
doc = PdfWriter()
for text in notes:
    p = doc.add_blank_page(width=595, height=842)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    p[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): doc._add_object(font)})})
    escaped = [line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)') for line in text.splitlines()]
    content = 'BT /F1 12 Tf 48 780 Td 18 TL ' + ' T* '.join('(' + line + ') Tj' for line in escaped) + ' ET'
    stream = DecodedStreamObject(); stream.set_data(content.encode('ascii'))
    p[NameObject('/Contents')] = doc._add_object(stream)
with (root / 'calculus-notes.pdf').open('wb') as output:
    doc.write(output)
slides = [
    'Integral ve degisken degistirme: u = g(x), du = g\'(x) dx. Integral yeni degiskene gore yazilir.',
    'Degisken degistirme ornegi: integral 2x cos(x*x) dx. u = x*x secilir, sonuc sin(x*x) + C olur.',
]
with zipfile.ZipFile(root / 'calculus-slides.pptx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>')
    z.writestr('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r1"/><p:sldId id="257" r:id="r2"/></p:sldIdLst></p:presentation>')
    z.writestr('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>')
    for n, text in enumerate(slides, 1):
        z.writestr(f'ppt/slides/slide{n}.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>' + escape(text) + '</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
(root / 'biology.txt').write_text('Fotosentezde klorofil, isik enerjisini sogurur. Bitkiler karbondioksit ve su kullanarak organik madde uretir. Kloroplast, fotosentezin gerceklestigi organeldir.', encoding='utf-8')
print('Created own PDF, slide-aware PPTX and biology text fixtures in ignored data directory.')
