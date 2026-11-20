"""Real HTTP release checks. --adapted is explicitly limited to local DOM checks."""
import argparse, json, threading, functools, http.server, shutil, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

R=Path(__file__).resolve().parents[1]; QA=R/'qa';QA.mkdir(exist_ok=True)
a=argparse.ArgumentParser();a.add_argument('--adapted',action='store_true');a.add_argument('--base-url');args=a.parse_args()
results={'mode':'adapted-dom' if args.adapted else 'native-http','checks':[]};errors=[]
def check(name,value):
    if not value: raise AssertionError(name)
    results['checks'].append(name);print('PASS',name,flush=True)
def go(page,target):
    page.locator(f'.subnav a[href="#{target}"]').click();page.wait_for_timeout(70)
def fill(page,values):
    for k,v in values.items(): page.locator('#'+k).fill(str(v))
def overflow(page,name):
    check(name,page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
def screenshot(page,name):page.screenshot(path=str(QA/name),full_page=True)
server=None
if not args.adapted and not args.base_url:
    handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(R))
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    base='http://127.0.0.1:'+str(server.server_port)+'/'
else:base=args.base_url
try:
  with sync_playwright() as pw:
    opts={'headless':True,'args':['--no-sandbox']}
    if shutil.which('chromium'):opts['executable_path']=shutil.which('chromium')
    browser=pw.chromium.launch(**opts)
    def begin(width=1440,file='index.html'):
      context=browser.new_context(viewport={'width':width,'height':1000 if width>500 else 844},accept_downloads=True)
      page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
      if args.adapted:
        page.route('https://**/*',lambda route:route.abort())
        page.set_content((R/'preview'/file).read_text(),wait_until='domcontentloaded',timeout=30000)
      else:page.goto(base+file,wait_until='domcontentloaded');page.wait_for_timeout(400)
      return context,page
    ctx,page=begin()
    check('home displays the approved visual identity',page.locator('.pv48-public-hero').count()==1 and page.locator('.pv48-browser').count()==1)
    check('primary action is visible',page.locator('.pv48-main-actions [data-action="start-real"]').is_visible())
    overflow(page,'desktop home fits viewport');screenshot(page,'home-desktop.png')
    page.locator('[data-action="peek-answers"]').click()
    check('homepage answers tab works without changing pages',page.locator('[data-peek="answers"]').is_visible() and page.locator('body').get_attribute('data-route')=='home')
    page.locator('[data-action="peek-next"]').click();check('homepage next step is interactive',page.locator('[data-peek="next"]').is_visible())
    page.locator('.pv48-main-actions [data-action="load-demo"]').click();page.wait_for_timeout(80)
    check('example opens the actual shared project',page.locator('body').get_attribute('data-route')=='economics')
    check('example economics use calculated values','$11,562' in page.locator('main').inner_text() and '-$29,154' in page.locator('main').inner_text())
    check('one four-step workspace navigation',page.locator('.subnav a').count()==4)
    screenshot(page,'costs-desktop.png')
    page.get_by_text('Include correction time from reviewed answers',exact=True).click()
    page.locator('#link-stage-ai').select_option('retest')
    page.get_by_role('button',name='Apply quality-to-cost links',exact=True).click()
    check('retest correction time changes the economic comparison','-$29,154' not in page.locator('.scenario').nth(2).inner_text())
    go(page,'validation');check('example answer evidence is available',page.locator('.case-list button').count()==3)
    screenshot(page,'answers-desktop.png')
    page.locator('[data-action="tab-sources"]').click();page.locator('[data-action="edit-source"]').first.click()
    page.locator('#source-version').fill('2.0');page.get_by_role('button',name='Update source',exact=True).click()
    page.locator('[data-action="tab-cases"]').click()
    check('source change invalidates stale reviews','0 pass / 0 fail' in page.locator('.metrics').inner_text())
    go(page,'economics');check('stale quality evidence blocks an active cost link','Complete every verdict' in page.locator('main').inner_text())
    ctx.close()
    ctx,page=begin(390)
    overflow(page,'mobile home fits viewport');screenshot(page,'home-mobile.png')
    page.locator('.pv48-main-actions [data-action="start-real"]').click()
    check('own-input path starts with a blank project',page.locator('#project-title').input_value()=='')
    go(page,'economics');check('permission guard remains active','Complete your project setup' in page.locator('main').inner_text())
    go(page,'project')
    fill(page,{'project-title':'Synthetic release test','workflow':'A synthetic workflow used to test new inputs and reviews.','project-owner':'Test operations lead','consent-record':'synthetic-test-approval','consent-role':'Test lead','consent-granted':'2020-01-01','consent-expires':'2099-12-31'})
    page.locator('#consent-process').check();page.locator('#consent-transfer').check()
    page.get_by_role('button',name='Continue to costs',exact=False).click()
    fill(page,{'category-0':'Synthetic tasks','volume-0':'120','minutes-0':'10'})
    page.get_by_role('button',name='Apply workload',exact=True).click()
    check('new manual inputs produce 20 baseline work hours','20 h' in page.locator('.metrics').inner_text())
    overflow(page,'mobile costs fit viewport')
    requests=[];page.on('request',lambda r:requests.append(r.url))
    page.locator('#workload-import').set_input_files({'name':'fresh.csv','mimeType':'text/csv','buffer':b'category,monthly_tickets,handle_minutes,repeat_rate,escalation_rate\nFresh tasks,240,10,0,0\n'})
    expect(page.locator('.metrics')).to_contain_text('40 h')
    check('CSV import recalculates a new baseline','40 h' in page.locator('.metrics').inner_text())
    page.wait_for_timeout(150)
    check('input processing sends no project network requests',all(x.startswith(('https://fonts.googleapis.com/','https://fonts.gstatic.com/')) for x in requests))
    page.locator('#workload-import').set_input_files({'name':'bad.csv','mimeType':'text/csv','buffer':b'bad,columns\n1,2'})
    expect(page.locator('#page-error')).to_contain_text('Missing CSV column')
    check('invalid CSV leaves existing data intact','Missing CSV column' in page.locator('#page-error').inner_text() and '40 h' in page.locator('.metrics').inner_text())
    go(page,'validation');page.locator('[data-action="tab-sources"]').click()
    fill(page,{'source-id':'test-rule','source-name':'Synthetic review rule','source-version':'1.0','source-approver':'Test lead','source-text':'Uncertain requests must be referred to the operations lead before any outcome is promised.','source-criterion':'The answer should refer uncertain requests to the operations lead.'})
    page.locator('#source-approved').check();page.get_by_role('button',name='Add source',exact=True).click()
    check('saving a rule opens the next step directly',page.locator('#case-form').is_visible())
    fill(page,{'case-id':'fresh-answer','case-prompt':'How should an uncertain request be handled?','case-response':'The operations lead reviews an uncertain request.'})
    page.get_by_role('button',name='Add case for review',exact=True).click()
    page.locator('#review-outcome').select_option('pass')
    fill(page,{'review-by':'Test reviewer','review-quote':'operations lead','review-reason':'The answer refers the request to the required operations lead.'})
    page.get_by_role('button',name='Save review',exact=True).click()
    check('new answer gets the entered review','Review result: pass' in page.locator('main').inner_text())
    overflow(page,'mobile review fits viewport');screenshot(page,'answers-mobile.png')
    page.locator('[data-action="tab-change"]').click()
    fill(page,{'fix-description':'Clarify that the operations lead must review the request first.','fix-rollback':'Stop the test if an answer promises an outcome before review.','fix-owner':'Test lead'})
    page.locator('#fix-approved').check();page.get_by_role('button',name='Record approval',exact=True).click()
    page.locator('[data-action="tab-cases"]').click();page.locator('[data-action="prepare-retest"]').click()
    fill(page,{'case-id':'fresh-retest','case-response':'The operations lead must review the request before an outcome is promised.'})
    page.get_by_role('button',name='Add case for review',exact=True).click();page.locator('#review-outcome').select_option('pass')
    fill(page,{'review-by':'Test reviewer','review-quote':'operations lead','review-reason':'The new version preserves the required review before making a promise.'})
    page.get_by_role('button',name='Save review',exact=True).click()
    check('new-input paired retest is recorded','1 pass / 0 fail' in page.locator('.metrics').inner_text())
    go(page,'decision');overflow(page,'mobile results fit viewport');screenshot(page,'results-mobile.png')
    with page.expect_download() as dl:page.get_by_role('button',name='Download report',exact=True).click()
    dl.value.save_as(str(QA/'synthetic-report.html'))
    check('report includes newly entered inputs and reviews','fresh-retest' in (QA/'synthetic-report.html').read_text() and 'Fresh tasks' in (QA/'synthetic-report.html').read_text())
    with page.expect_download() as dl:page.get_by_role('button',name='Download project',exact=True).click()
    dl.value.save_as(str(QA/'synthetic-project.json'))
    saved=json.loads((QA/'synthetic-project.json').read_text());check('JSON contains recomputable shared project',saved['rows'][0]['monthly_tickets']==240 and len(saved['cases'])==2)
    if not args.adapted:
      page.get_by_role('button',name='Save project',exact=True).click()
      check('native localStorage saves only on explicit action',page.evaluate("localStorage.getItem('pilotverdict.integrated.v0.5') !== null"))
      page.reload(wait_until='domcontentloaded');page.locator('.project-menu summary').click();page.locator('.project-menu [data-action="load-local"]').click()
      check('saved project restores after a reload',page.locator('#project-title').input_value()=='Synthetic release test')
    else: results['limitations']=['DOM checks only; native HTTP, localStorage and live hosting are tested by GitHub Actions.']
    go(page,'project');page.get_by_text('Open an existing project',exact=True).click()
    page.locator('#project-import').set_input_files(str(QA/'synthetic-project.json'))
    expect(page.locator('#project-title')).to_have_value('Synthetic release test')
    check('JSON import restores new user inputs',page.locator('#project-title').input_value()=='Synthetic release test')
    page.locator('#consent-transfer').uncheck();page.get_by_role('button',name='Continue to costs',exact=False).click()
    page.locator('.project-menu summary').click();page.locator('.project-menu [data-action="export-project"]').click()
    check('export permission is enforced','save/export' in page.locator('#flash').inner_text())
    check('no uncaught JavaScript errors',errors==[])
    ctx.close()
    ctx,page=begin(1440,'portfolio.html');check('project story opens separately',page.locator('body').get_attribute('data-route')=='story');overflow(page,'project story fits viewport');screenshot(page,'project-story.png');ctx.close()
    # Strict native contrast/label/structure audit of the public home, using the QA-only axe library.
    axe=R/'node_modules/axe-core/axe.min.js'
    if axe.exists() and not args.adapted:
      ctx,page=begin();page.evaluate(axe.read_text());scan=page.evaluate("async () => await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})")
      (QA/'axe-home.json').write_text(json.dumps(scan,indent=2));check('home automated accessibility has no serious or critical violations',not [v for v in scan['violations'] if v['impact'] in ('serious','critical')]);ctx.close()
    browser.close()
  results['status']='passed'
except Exception as e:
  results['status']='failed';results['error']=str(e);results['traceback']=traceback.format_exc();print(results['traceback'])
finally:
  if server:server.shutdown()
  (QA/('browser-adapted.json' if args.adapted else 'browser-native.json')).write_text(json.dumps(results,indent=2))
  print(json.dumps({'status':results['status'],'mode':results['mode'],'checks':len(results['checks']),'error':results.get('error')},indent=2))
  if results['status']!='passed':raise SystemExit(1)
