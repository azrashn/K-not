"""Local checkpoint of approved source changes; never includes env, data or credentials."""
import hashlib, importlib.metadata, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'logs/a0-baseline-2026-11-05'
out.mkdir(parents=True,exist_ok=True)
patch=out/'tracked.patch'
if patch.exists():
    raise SystemExit('Baseline already exists; refusing to overwrite it.')
subprocess.run(['git','diff','--binary','--output='+str(patch)],cwd=ROOT,check=True)
names=subprocess.check_output(['git','ls-files','--others','--exclude-standard'],cwd=ROOT,text=True).splitlines()
entries=[]
for name in names:
    p=Path(name)
    if p.parts[0] not in ('ai-service','docs','scripts','third_party') or p.suffix not in ('.py','.md','.cjs','.json') and p.name!='LICENSE':
        continue
    raw=(ROOT/p).read_bytes()
    dest=out/'untracked'/p
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_bytes(raw)
    entries.append({'path':name,'sha256':hashlib.sha256(raw).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'python':sys.version,'files':entries},indent=2),encoding='utf-8')
packages={d.metadata['Name'].lower().replace('_','-'):d.version for d in importlib.metadata.distributions()}
pins=['# Observed working Windows / Python 3.14.2 environment; constraints, not a hash-locked installer.',
      '# No editable/local paths or credentials. Optional embedding packages are constrained only if selected.']
pins += [f'{name}=={version}' for name,version in sorted(packages.items()) if name not in ('knot-rag','pip','setuptools','wheel')]
(ROOT/'ai-service/constraints-windows-py314.txt').write_text('\n'.join(pins)+'\n',encoding='utf-8')
print(json.dumps({'checkpoint_files':len(entries),'constraint_packages':len(packages)-4}))
