"""Import the reviewed text-only PilotVerdict release; verify its exact source digest."""
from pathlib import Path, PurePosixPath
import base64, hashlib, json, lzma
root=Path(__file__).resolve().parents[1]
target=root/'pilotverdict'
if (target/'package.json').exists():
    print('Release source already present; preserving subsequent edits.')
else:
    encoded=''.join((root/'.release-pilotverdict'/f'part-{i}.txt').read_text() for i in range(8))
    raw=lzma.decompress(base64.b64decode(encoded,validate=True))
    expected='127abb0bc037d3dba1b86db36419a8b7fd23de03a58721be0678ba55f182749a'
    assert hashlib.sha256(raw).hexdigest()==expected, 'Release integrity mismatch'
    files=json.loads(raw)
    for name,text in files.items():
        p=PurePosixPath(name)
        assert not p.is_absolute() and '..' not in p.parts and isinstance(text,str)
        assert p.suffix.lower() not in ('.woff','.woff2','.ttf','.otf'), 'Font binaries are excluded'
        dest=target/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(text,encoding='utf-8')
    package=json.loads((target/'package.json').read_text())
    package['scripts']['serve']='python3 -m http.server 4173 --bind 127.0.0.1'
    package['scripts']['test:browser']='python3 scripts/release_browser_test.py'
    (target/'package.json').write_text(json.dumps(package,indent=2)+'\n')
    (target/'SOURCE_RECEIPT.json').write_text(json.dumps({'sourceArchiveSha256':expected,'files':sorted(files),'release':'0.5.1','importNote':'Text-only import; package serve/browser commands corrected to release-root paths.'},indent=2)+'\n')
    print('Verified and imported',len(files),'source files.')
