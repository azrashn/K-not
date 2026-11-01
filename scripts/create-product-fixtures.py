"""Own visual fixtures, not copied course content. Output remains ignored."""
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

out=Path(__file__).resolve().parents[1]/'data/product-tests/fixtures'
out.mkdir(parents=True,exist_ok=True)
texts=[
 'Integral, birikimi ve egri altindaki alani ifade eder.',
 'Degisken degistirme yonteminde u = g(x) secilir.',
 "du = g'(x) dx ile integral yeni degiskene aktarilir.",
 'Ornek: integral 2x cos(x*x) dx icin u = x*x secilir.',
 'Degisken degistirme sonucu sin(x*x) + C olur.',
]
pdf=PdfWriter()
for n in range(1,11):
 page=pdf.add_blank_page(width=595,height=842)
 font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
 page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):pdf._add_object(font)})})
 lines=[f'K-NOT | INTEGRAL CALISMA NOTLARI | SAYFA {n}',texts[(n-1)%5],f'BOLUM {n}: OZGUN SAYFA GORUNTUSU']
 stream=DecodedStreamObject()
 content='0.14 0.31 0.77 rg 45 700 505 80 re f 0 0 0 rg BT /F1 14 Tf 45 650 Td 30 TL '
 content+=' T* '.join('('+s.replace('(','\\(').replace(')','\\)')+') Tj' for s in lines)+' ET'
 stream.set_data(content.encode('ascii'));page[NameObject('/Contents')]=pdf._add_object(stream)
with (out/'integral-10-pages.pdf').open('wb') as f:pdf.write(f)
prs=Presentation();prs.slide_width=Inches(12);prs.slide_height=Inches(6.75)
for n,text in enumerate(texts,1):
 slide=prs.slides.add_slide(prs.slide_layouts[6])
 for y,height,color in [(0,.15,(36,79,196)),(.15,6.6,(249,250,252))]:
  shape=slide.shapes.add_shape(MSO_SHAPE.RECTANGLE,0,Inches(y),prs.slide_width,Inches(height));shape.fill.solid();shape.fill.fore_color.rgb=RGBColor(*color);shape.line.fill.background()
 def box(x,y,w,h,text,size=24):
  tf=slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h)).text_frame
  tf.word_wrap=True;tf.text=text
  for p in tf.paragraphs:p.font.size=Pt(size);p.font.name='Liberation Sans';p.font.color.rgb=RGBColor(22,24,30)
 box(.6,.5,10,1,f'Degisken degistirme | Slayt {n}',32)
 box(.6,1.7,10,1,text)
 # Real editable source shapes and table, so rendering tests cover layout.
 for x,label in [(1,'x degiskeni'),(5,'u = g(x)'),(9,'Yeni integral')]:
  sh=slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,Inches(x),Inches(3.25),Inches(2),Inches(1));sh.fill.solid();sh.fill.fore_color.rgb=RGBColor(222,232,254);sh.line.color.rgb=RGBColor(36,79,196)
  sh.text=label
 table=slide.shapes.add_table(2,2,Inches(1),Inches(4.8),Inches(10),Inches(1)).table
 for row,values in enumerate([['Secim','Donusum'],['u = x*x','du = 2x dx']]):
  for col,value in enumerate(values):table.cell(row,col).text=value
 box(.6,6.2,10,.3,'K-NOT tarafindan test icin olusturuldu. Kaynak goruntusu, AI uretimi degil.',12)
prs.save(out/'integral-5-slides.pptx')
(out/'integral-notes.txt').write_text(' '.join(texts),encoding='utf-8')
print('Own 10-page PDF, 5-slide PPTX with diagram/table, and text fixtures created.')
