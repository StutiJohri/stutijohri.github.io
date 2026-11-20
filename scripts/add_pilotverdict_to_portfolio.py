"""Add only a navigation entry and a product section; preserve all existing portfolio bytes."""
from pathlib import Path
import re, hashlib
p=Path('index.html');original=p.read_bytes();s=original.decode('utf-8')
if 'id="pilotverdict-project"' in s:
    assert 'href="pilotverdict/"' in s
    print('Portfolio product entry already exists.')
else:
    nav=re.search(r'<nav\b[^>]*class=["\'][^"\']*\bsite-nav\b[^"\']*["\'][^>]*>[\s\S]*?</nav>',s,re.I)
    section=re.search(r'<section\b(?=[^>]*\bid=["\']projects["\'])[^>]*>',s,re.I)
    assert nav and section, 'Existing portfolio structure changed; manual review required'
    link='<a href="pilotverdict/" id="pilotverdict-nav">PilotVerdict</a>'
    feature='''<section id="pilotverdict-project" class="projects-section" aria-labelledby="pilotverdict-title" style="max-width:1200px;margin:0 auto;padding:24px 24px 40px">
  <div style="border:1px solid #dfe3e8;border-radius:16px;padding:28px">
    <p style="font-size:12px;letter-spacing:.08em;margin:0 0 12px">PRODUCT · PILOTVERDICT</p>
    <h2 id="pilotverdict-title" style="margin:0 0 12px">Know the cost. Check the answers.</h2>
    <p style="max-width:760px;margin:0 0 20px">Compare workflow costs, check AI answers against your rules, and decide what to improve. Explore a complete example or start with your own inputs.</p>
    <a class="btn btn-primary" href="pilotverdict/">Open PilotVerdict →</a>
    <a class="btn btn-secondary" href="pilotverdict/portfolio.html">See the project</a>
  </div>
</section>
'''
    edits=[(nav.end()-len('</nav>'),link),(section.start(),feature)]
    for at,text in sorted(edits,reverse=True):s=s[:at]+text+s[at:]
    assert s.replace(link,'',1).replace(feature,'',1).encode('utf-8')==original, 'Unexpected portfolio modification'
    p.write_bytes(s.encode('utf-8'))
    print('Original portfolio preserved byte-for-byte outside two additions. Original SHA256:',hashlib.sha256(original).hexdigest())
