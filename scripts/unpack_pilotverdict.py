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
    # Copy-only refinements. Calculations, rights, source checks and review logic stay unchanged.
    app=target/'src/app.js';s=app.read_text()
    replacements={
      'Percent; assumption, not a benchmark':'Your estimated percentage',
      'USD once; do not duplicate setup':'USD once; additional to setup',
      'Human verdict pending':'Review needed',
      'Current human verdicts':'Answers reviewed',
      '${q.n} resolved cases; not a population estimate':'Based on ${q.n} reviewed answers',
      'Declared sample minimum':'Your review target',
      'Screening signal only—not an automatic pass/fail.':'Check this signal against the rule, then record your review.',
      'This review is stale because its case, source or approved change no longer matches the recorded snapshot. Review again.':'The answer, rule or change has been updated. Review this answer again.',
      'Mutually exclusive categories. Handle time already includes repeat work; do not count it twice.':'List each category once. Include repeat work in its average handling time.',
      'Under 1 MB. No ticket messages or customer identifiers. Original aggregate CSV columns are supported.':'Use the CSV template with category totals. Maximum file size: 1 MB.',
      'Use new inputs—not an expected answer from the demo. This product does not call a live model or execute actions.':'Paste an answer you want to check and choose the rule it should follow.',
      'Authorized, redacted output only. No final verdict is assigned automatically.':'Paste the answer with personal details removed. Review it in the next step.',
      'CSV imports inputs, not verdicts. Maximum 200 cases. Use the template columns.':'Import up to 200 answers using the template, then review them here.',
      'The application records an owner-approved change. It does not publish to an AI vendor, execute transactions or attest that a rollout actually happened.':'Describe the correction and record who approved it. Then add new answers to check the change.',
      'Then retest without confusing the evidence':'Check the change',
      'Use new prompts to explore generalization. These checks are not a preregistered, independent holdout or a statistically representative sample.':'Try new questions to see how the updated workflow handles different cases.',
      'Declare the acceptance criteria':'Choose your review targets',
      'These are project-specific decision thresholds, not a certification standard. No pending, inconclusive or critical failing case is allowed in a passing round.':'Set how many answers to review and the pass rate you need. Resolve open reviews and critical problems before meeting the target.',
      'An operator-attested judgment':'Who reviewed this answer?',
      'Only for phrase checks; literal matching is not semantic judgment':'For phrase checks, enter the exact words to look for.',
      'A concrete trigger, not “if performance is bad”.':'Describe the specific problem that would make you stop the change.'
    }
    for old,new in replacements.items():
        assert old in s, 'Copy source changed: '+old
        s=s.replace(old,new)
    app.write_text(s)
    # File.text() is asynchronous. Wait for the visible result before testing its contents.
    test=target/'scripts/release_browser_test.py';s=test.read_text().replace('from playwright.sync_api import sync_playwright','from playwright.sync_api import sync_playwright, expect')
    s=s.replace("    check('CSV import recalculates a new baseline'", "    expect(page.locator('.metrics')).to_contain_text('40 h')\n    check('CSV import recalculates a new baseline'")
    s=s.replace("    check('invalid CSV leaves existing data intact'", "    expect(page.locator('#page-error')).to_contain_text('Missing CSV column')\n    check('invalid CSV leaves existing data intact'")
    s=s.replace("    check('JSON import restores new user inputs'", "    expect(page.locator('#project-title')).to_have_value('Synthetic release test')\n    check('JSON import restores new user inputs'")
    test.write_text(s)
    (target/'SOURCE_RECEIPT.json').write_text(json.dumps({'sourceArchiveSha256':expected,'files':sorted(files),'release':'0.5.1','importNote':'Text-only import; package commands fixed; copy-only refinements; native file-import assertions wait for asynchronous results.','postImportSha256':{name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in files}},indent=2)+'\n')
    print('Verified and imported',len(files),'source files, with documented copy and test refinements.')
