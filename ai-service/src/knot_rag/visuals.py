"""Faithful source rendering; no model-generated slide images or visual understanding."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import uuid
from xml.etree import ElementTree
from fastapi import APIRouter,Depends,HTTPException
from pydantic import Field
from pypdf import PdfReader
from knot_ingest.storage import LocalStorage
from knot_rag.schemas.common import StrictModel,Identifier

_lock=threading.RLock()
class Visual(StrictModel):
    course_id: Identifier
    material_id: str=Field(pattern=r'^(pdf|file)_[A-Za-z0-9_-]{1,80}$')
    version: str=Field(pattern=r'^[a-f0-9]{64}$')
    storage_key: str=Field(pattern=r'^(documents|materials)/[A-Za-z0-9_-]+/original\.(pdf|pptx)$')
    page: int=Field(ge=1,le=500)

def root():
    return Path(os.environ['STORAGE_ROOT']).resolve()/'.previews'

def scope(course,material):
    return root()/hashlib.sha256((course+':'+material).encode()).hexdigest()

def purge(course,material):
    with _lock:
        target=scope(course,material).resolve()
        base=root().resolve()
        if not target.is_relative_to(base) or target==base:
            raise ValueError('Unsafe preview target')
        if target.exists():shutil.rmtree(target)

def run(args,timeout):
    return subprocess.run(args,capture_output=True,timeout=timeout,check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)

def _prepared(body:Visual):
    """(original, pdf, folder, page_count): the PDF whose pages are shown; a presentation is converted once."""
    storage=LocalStorage(os.environ['STORAGE_ROOT'])
    original=storage.resolve(body.storage_key)
    if not original.is_file():raise HTTPException(404,'Original material missing')
    folder=scope(body.course_id,body.material_id)/body.version
    folder.mkdir(parents=True,exist_ok=True)
    pdf=original
    if original.suffix=='.pptx':
        pdf=folder/'source.pdf'
        if not pdf.exists():
            shutil.copyfile(original,folder/'source.pptx')
            name='knot-render-'+uuid.uuid4().hex
            try:
                run(['docker','run','--rm','--name',name,'--label','com.knot.component=office-renderer',
                    '--network','none','--memory','2g','--cpus','2','--pids-limit','128',
                    '--read-only','--tmpfs','/tmp:rw,nosuid,size=256m','--cap-drop','ALL',
                    '--security-opt','no-new-privileges','--mount',f'type=bind,source={folder.resolve()},target=/work',
                    'knot-office-renderer:local-v1'],90)
            except (subprocess.SubprocessError,OSError) as exc:raise HTTPException(503,'Office rendering unavailable') from exc
            finally:
                try:run(['docker','rm','-f',name],10)
                except (subprocess.SubprocessError,OSError):pass  # Our named --rm job may already have exited.
            if not pdf.exists():raise HTTPException(422,'Presentation could not be rendered')
    try:count=len(PdfReader(pdf).pages)
    except Exception as exc:raise HTTPException(422,'Original PDF is unreadable or encrypted') from exc
    if body.page>count:raise HTTPException(404,'Page not found')
    return original,pdf,folder,count

def render(body:Visual):
    with _lock:
        original,pdf,folder,count=_prepared(body)
        image=folder/f'page-{body.page}.png'
        if not image.exists():
            executable=os.environ.get('PDFTOPPM_PATH') or shutil.which('pdftoppm')
            if not executable:raise HTTPException(503,'PDF renderer unavailable')
            try:run([executable,'-f',str(body.page),'-l',str(body.page),'-singlefile','-scale-to','1800','-png',str(pdf),str(image.with_suffix(''))],45)
            except (subprocess.SubprocessError,OSError) as exc:raise HTTPException(503,'Page rendering failed') from exc
        data=image.read_bytes()
        if len(data)>12*1024*1024:raise HTTPException(413,'Rendered page too large')
        return {'material_id':body.material_id,'version':body.version,'page':body.page,'page_count':count,
            'image':base64.b64encode(data).decode(),'renderer':'LibreOffice + Poppler' if original.suffix=='.pptx' else 'Poppler',
            'visual_understanding':False}

# ── Text layer: the page's words with their boxes, to mark a quoted sentence on the rendered page ──────────
TEXT_LAYER_MAX_WORDS=6000

def pdftotext_path():
    """PDFTOTEXT_PATH, else pdftotext next to the configured pdftoppm (one Poppler install), else on PATH."""
    explicit=os.environ.get('PDFTOTEXT_PATH')
    if explicit:return explicit
    renderer=os.environ.get('PDFTOPPM_PATH')
    if renderer:
        sibling=Path(renderer).with_name('pdftotext'+Path(renderer).suffix)
        if sibling.is_file():return str(sibling)
    return shutil.which('pdftotext')

def parse_bbox_layout(markup:str):
    """pdftotext -bbox-layout XHTML → lines of [text, x0, y0, x1, y1] in page fractions (0-1).
    The markup is Poppler's own output; words keep their reading order inside a line."""
    root=ElementTree.fromstring(markup)
    local=lambda el:el.tag.rsplit('}',1)[-1]
    page=next((el for el in root.iter() if local(el)=='page'),None)
    if page is None:return []
    width=float(page.get('width') or 0);height=float(page.get('height') or 0)
    if width<=0 or height<=0:return []
    clamp=lambda v:round(min(1.0,max(0.0,v)),4)
    lines=[];total=0
    for line in (el for el in page.iter() if local(el)=='line'):
        words=[]
        for w in (el for el in line if local(el)=='word'):
            text=(w.text or '').strip()
            if not text:continue
            words.append([text[:200],clamp(float(w.get('xMin'))/width),clamp(float(w.get('yMin'))/height),
                          clamp(float(w.get('xMax'))/width),clamp(float(w.get('yMax'))/height)])
            total+=1
            if total>=TEXT_LAYER_MAX_WORDS:break
        if words:lines.append(words)
        if total>=TEXT_LAYER_MAX_WORDS:break
    return lines

def text_layer(body:Visual):
    with _lock:
        _original,pdf,folder,count=_prepared(body)
        cached=folder/f'page-{body.page}.words.json'
        if cached.exists():
            try:lines=json.loads(cached.read_text(encoding='utf-8'))
            except (OSError,ValueError):lines=None
        else:lines=None
        if lines is None:
            executable=pdftotext_path()
            if not executable:raise HTTPException(503,'PDF text layer unavailable')
            out=folder/f'page-{body.page}.bbox.html'
            try:run([executable,'-f',str(body.page),'-l',str(body.page),'-bbox-layout','-enc','UTF-8',str(pdf),str(out)],45)
            except (subprocess.SubprocessError,OSError) as exc:raise HTTPException(503,'Page text layer failed') from exc
            try:lines=parse_bbox_layout(out.read_text(encoding='utf-8',errors='replace'))
            except (OSError,ElementTree.ParseError,ValueError,TypeError) as exc:raise HTTPException(503,'Page text layer unreadable') from exc
            finally:
                try:out.unlink()
                except OSError:pass
            cached.write_text(json.dumps(lines,ensure_ascii=False),encoding='utf-8')
        # A scanned page has no text layer: an empty list, so the viewer falls back to the extracted text.
        return {'material_id':body.material_id,'version':body.version,'page':body.page,'page_count':count,'lines':lines}

def install(app,auth):
    router=APIRouter(prefix='/api/v1/knowledge',dependencies=[Depends(auth)])
    router.add_api_route('/render',render,methods=['POST'])
    router.add_api_route('/render/text',text_layer,methods=['POST'])
    app.include_router(router)
