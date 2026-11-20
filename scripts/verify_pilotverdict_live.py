"""Verify deployed bytes and the public portfolio-to-product path over HTTPS."""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib, json, os, time
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1]
app=root/'pilotverdict'
qa=app/'qa';qa.mkdir(exist_ok=True)
base='https://stutijohri.github.io/'
expected=json.loads((app/'BUILD_MANIFEST.json').read_text())
nonce=os.environ.get('GITHUB_SHA','release')
def fetch(path):
    request=Request(base+path+'?release='+nonce,headers={'User-Agent':'PilotVerdict-Release-Verification','Cache-Control':'no-cache'})
    with urlopen(request,timeout=30) as r:
        assert r.status==200 and r.url.startswith('https://stutijohri.github.io/'), 'Unexpected response'
        return r.read()
for attempt in range(40):
    try:
        live=json.loads(fetch('pilotverdict/BUILD_MANIFEST.json'))
        assert live==expected, 'The public host is still serving a different release'
        break
    except Exception as e:
        if attempt==39:raise RuntimeError('Exact deployment not verified: '+str(e))
        time.sleep(3)
verified=[]
for path,meta in expected['files'].items():
    if path.startswith('.'):continue
    data=fetch('pilotverdict/'+path)
    assert hashlib.sha256(data).hexdigest()==meta['sha256'], 'Deployed bytes differ: '+path
    verified.append(path)
portfolio=fetch('').decode('utf-8')
assert 'id="pilotverdict-project"' in portfolio and 'href="pilotverdict/"' in portfolio
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for width in [1440,390]:
        page=browser.new_page(viewport={'width':width,'height':900})
        page.goto(base,wait_until='domcontentloaded',timeout=60000)
        page.locator('#pilotverdict-project a[href="pilotverdict/"]').click()
        expect(page.locator('.pv48-public-hero')).to_be_visible()
        page.locator('.pv48-main-actions [data-action="load-demo"]').click()
        expect(page.locator('.subnav a')).to_have_count(4)
        assert '$11,562' in page.locator('main').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        page.screenshot(path=str(qa/f'live-{width}.png'),full_page=True)
        page.close()
    browser.close()
receipt={'status':'passed','url':base+'pilotverdict/','portfolio':base,'commit':nonce,'verifiedFiles':verified,'viewportWidths':[1440,390],'verifiedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
(qa/'live-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
