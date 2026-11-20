"""Faithful source rendering; no model-generated slide images or visual understanding."""
import base64
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import threading
import uuid
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

def render(body:Visual):
    with _lock:
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

def install(app,auth):
    router=APIRouter(prefix='/api/v1/knowledge',dependencies=[Depends(auth)])
    router.add_api_route('/render',render,methods=['POST'])
    app.include_router(router)
