import {DEFAULTS, evaluate as legacyEvaluate, validateRows, validateSettings} from './vendor/model.js';
import {parseCSV as legacyParseCSV} from './vendor/csv.js';

/** All domain functions are network-free. Imported attestations are not independently verified. */
export const VERSION='0.5.1';
export const SCHEMA='pilotverdict.workflow.v0.5';
export const BASE_COMMIT='b4197583d0768ca663fe92d7ca66ca36793a1c12';
export const STAGES=['baseline','retest','additional'];
export const OUTCOMES=['pass','fail','inconclusive'];
export const MODEL_FIELDS=Object.keys(DEFAULTS);
export const MAX_FILE_BYTES=2_000_000;
const ok=(condition,message)=>{if(!condition)throw new Error(message);};
const copy=x=>structuredClone(x);
const today=()=>new Date().toISOString().slice(0,10);
const now=()=>new Date().toISOString();
const uid=prefix=>`${prefix}-${globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)}`;
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const fmtMoney=value=>value===null?'Not supported':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value);
export const fmtNumber=value=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value);
export const percent=value=>value===null?'—':`${(value*100).toFixed(1)}%`;
const str=(x,label,max=2000,min=0)=>{ok(typeof x==='string',`${label} must be text.`);ok(x.length<=max&&x.trim().length>=min,`${label} must contain ${min}–${max} characters.`);return x.trim();};
const numeric=(v,label,min=0,max=1e9)=>{ok((typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isFinite(Number(v)),`${label} must be a finite number.`);v=Number(v);ok(v>=min&&v<=max,`${label} must be between ${min} and ${max}.`);return v;};
const ident=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const normalize=s=>s.trim().toLowerCase().replace(/\s+/g,' ');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function boundedArray(a,name,max){ok(Array.isArray(a)&&a.length<=max,`${name} must have at most ${max} entries.`);}
function unique(a,name){ok(new Set(a).size===a.length,`Duplicate ${name}.`);}
function safeTree(value,depth=0){ok(depth<30,'Imported data is nested too deeply.');if(value&&typeof value==='object'){for(const [k,v] of Object.entries(value)){ok(!['__proto__','prototype','constructor'].includes(k),'Unsafe object key in imported data.');safeTree(v,depth+1);}}}

export function newProject({fictional=false}={}){
 return {schema:SCHEMA,version:VERSION,id:uid('workflow'),revision:0,createdAt:now(),updatedAt:now(),
  mode:fictional?'fictional':'authorized',title:'',workflow:'',owner:'',baselineSource:'',assumptionSource:'',realizationReason:'',
  consent:{record:'',role:'',grantedAt:today(),expiresAt:'',process:false,transfer:false,revoked:false},
  rows:[],settings:{...DEFAULTS},sources:[],cases:[],fixes:{ai:null,rules:null},
  criteria:{minCases:10,minPassRate:0.9},
  links:{ai:{enabled:false,stage:'retest',justification:'',scopeConfirmed:false},rules:{enabled:false,stage:'retest',justification:'',scopeConfirmed:false}},
  plan:{owner:'',metric:'Decision preparation time versus the existing manual review',baseline:'',target:'',stop:'',nextTest:'',decision:'',observedResult:''},
  history:[],imported:false};
}
export function permissionStatus(p,exporting=false,asOf=today()){
 if(p.mode==='fictional')return {ok:true,reason:'Fictional data; not customer evidence.'};
 const c=p.consent;
 if(!c||c.process!==true||c.revoked===true)return {ok:false,reason:'Record active permission for local processing before analyzing business inputs.'};
 if(!date(c.grantedAt)||!date(c.expiresAt)||c.grantedAt>asOf||c.expiresAt<asOf||c.expiresAt<c.grantedAt)return {ok:false,reason:'The recorded permission is not active for today.'};
 if(typeof c.record!=='string'||c.record.trim().length<3||typeof c.role!=='string'||c.role.trim().length<3)return {ok:false,reason:'A permission record reference and responsible role are required.'};
 if(exporting&&c.transfer!==true)return {ok:false,reason:'Record permission to save/export these inputs before downloading or storing a project.'};
 return {ok:true,reason:'Operator-attested permission; not independently verified.'};
}
export function requirePermission(p,exporting=false){const s=permissionStatus(p,exporting);ok(s.ok,s.reason);}
export function record(p,type,detail){const q=copy(p);q.revision++;q.updatedAt=now();q.history.push({at:q.updatedAt,type,detail:String(detail).slice(0,400),revision:q.revision});q.history=q.history.slice(-300);return q;}

export function strictSettings(raw){
 ok(plain(raw),'Settings must be an object.');
 const s={};for(const key of MODEL_FIELDS){ok(Object.hasOwn(raw,key),`Missing assumption: ${key}.`);s[key]=numeric(raw[key],key,0,1e7);}
 ok(s.productiveFraction>=0.05,'Productive fraction must be at least 0.05 in this model.');
 for(const k of ['aiExtraQA','rulesExtraQA'])ok(s[k]<=1440,`${k} cannot exceed 1440 minutes.`);
 return validateSettings(s);
}
export function strictRows(rows){
 boundedArray(rows,'Workload categories',250);
 for(const r of rows){ok(plain(r),'Each workload row must be an object.');str(r.category,'Category',90,1);for(const k of ['monthly_tickets','handle_minutes','repeat_rate','escalation_rate'])numeric(r[k],k,0,1e7);}
 return rows.length?validateRows(rows):[];
}
export function parseWorkloadCSV(text){
 // Additional quote-state validation prevents accepting junk after a closing quote.
 parseDelimited(text);return strictRows(legacyParseCSV(text));
}
/** Strict CSV lexer. It permits quoted newlines and rejects ambiguous quoting. */
export function parseDelimited(text){
 ok(typeof text==='string'&&text.length<=1_000_000,'CSV must be under 1 MB.');text=text.replace(/^\uFEFF/,'');
 let records=[],row=[],cell='',state='plain';
 const cellEnd=()=>{row.push(cell.trim());cell='';state='plain';};
 const rowEnd=()=>{cellEnd();if(row.some(x=>x!==''))records.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(state==='quoted'){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')state='closed';else cell+=c;continue;}
  if(state==='closed'&&c!==','&&c!=='\n'&&c!=='\r'){ok(c===' '||c==='\t','Unexpected text after a closing CSV quote.');continue;}
  if(c==='"'){ok(cell==='','Malformed CSV quote.');state='quoted';}
  else if(c===',')cellEnd();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;rowEnd();}else cell+=c;
 }
 ok(state!=='quoted','Unterminated CSV quote.');rowEnd();ok(records.length>0,'CSV is empty.');return records;
}
export function parseCaseCSV(text){
 const records=parseDelimited(text),head=records.shift();unique(head,'CSV header');
 const required=['id','source_id','scenario','stage','parent_id','candidate_version','prompt','response'];
 ok(required.every(k=>head.includes(k)),'Case CSV requires: '+required.join(', '));
 ok(records.length>0&&records.length<=200,'Import 1–200 cases.');
 return records.map((row,i)=>{ok(row.length===head.length,`CSV row ${i+2} has the wrong number of cells.`);const r=Object.fromEntries(head.map((k,j)=>[k,row[j]]));return {id:r.id,sourceId:r.source_id,scenario:r.scenario,stage:r.stage,parentId:r.parent_id,candidateVersion:r.candidate_version,prompt:r.prompt,response:r.response,severity:'major',review:null};});
}

export function validateSource(raw){
 ok(plain(raw)&&ident(raw.id),'A source needs a stable ID.');
 const s={id:raw.id,name:str(raw.name,'Source name',160,3),version:str(raw.version,'Source version',60,1),text:str(raw.text,'Approved source excerpt',10000,25),criterion:str(raw.criterion,'Evaluation criterion',1000,10),
  kind:raw.kind,token:str(raw.token??'','Check phrase',200),limit:raw.limit===null||raw.limit===''?null:numeric(raw.limit,'USD check threshold',0,1e6),approved:raw.approved===true,approvedBy:str(raw.approvedBy??'','Source approver role',100)};
 ok(['human','contains','not_contains','max_usd'].includes(s.kind),'Unsupported check type.');
 if(s.approved)ok(s.approvedBy.length>=3,'An approved source needs a responsible approver role.');
 if(['contains','not_contains'].includes(s.kind))ok(s.token.length>=3,'A phrase check needs at least three characters.');
 if(s.kind==='max_usd'){
  ok(s.limit!==null,'A USD threshold is required.');
  const values=[...s.text.matchAll(/(?:USD\s*|\$\s*)(\d+(?:,\d{3})*(?:\.\d+)?)/gi)].map(m=>Number(m[1].replaceAll(',','')));
  ok(values.includes(s.limit),'The exact USD threshold must be explicit in the source excerpt.');
 }
 return s;
}
export function addSource(p,raw){requirePermission(p);const s=validateSource(raw);ok(p.sources.length<20,'Maximum 20 sources.');ok(!p.sources.some(v=>v.id===s.id),'Source ID already exists.');const q=copy(p);q.sources.push(s);return record(q,'source-added',`${s.id} / ${s.version}`);}
function validateCase(raw,p,{historical=false}={}){
 ok(plain(raw)&&ident(raw.id),'Every case needs a stable ID.');
 const c={id:raw.id,sourceId:raw.sourceId,scenario:raw.scenario,stage:raw.stage,parentId:str(raw.parentId??'','Paired baseline ID',100),candidateVersion:str(raw.candidateVersion??'','Candidate version',80,1),prompt:str(raw.prompt,'Prompt',2000,5),response:str(raw.response,'Response',12000,1),severity:raw.severity??'major',review:raw.review??null};
 ok(p.sources.some(s=>s.id===c.sourceId),'Case references an unknown source.');
 ok(['ai','rules'].includes(c.scenario)&&STAGES.includes(c.stage),'Case scenario or stage is unsupported.');
 ok(['minor','major','critical'].includes(c.severity),'Unknown case severity.');
 if(c.stage==='baseline')ok(!c.parentId,'Baseline cases cannot have a paired parent.');
 if(c.stage!=='baseline'&&!historical){
  const fix=p.fixes[c.scenario];
  ok(fix?.approved===true&&fix.scenario===c.scenario,'Record an approved change for this alternative before a retest.');
  ok(c.candidateVersion===fix.version,'Retest version must match the approved change.');
 }
 if(c.stage==='retest'){
  const parent=p.cases.find(x=>x.id===c.parentId);
  ok(parent?.stage==='baseline'&&parent.scenario===c.scenario&&parent.sourceId===c.sourceId,'A paired retest must reference a baseline with the same alternative and source.');
  ok(normalize(parent.prompt)===normalize(c.prompt),'Paired retests must use the same prompt as their baseline.');
  ok(!p.cases.some(x=>x.id!==c.id&&x.stage==='retest'&&x.parentId===c.parentId&&x.candidateVersion===c.candidateVersion),'Only one paired retest per baseline and candidate version.');
 }
 if(c.stage==='additional'){
  ok(!c.parentId,'Additional cases must not carry a paired baseline ID.');
  ok(!p.cases.some(x=>x.id!==c.id&&normalize(x.prompt)===normalize(c.prompt)),'An additional case must use a new prompt.');
 }
 return c;
}
export function addCases(p,rawCases){
 requirePermission(p);boundedArray(rawCases,'Case import',200);ok(p.cases.length+rawCases.length<=200,'Maximum 200 cases per project.');const q=copy(p);
 for(const raw of rawCases){ok(!q.cases.some(c=>c.id===raw.id),'Case ID already exists.');q.cases.push(validateCase({...raw,review:null},q));}
 return record(q,'cases-added',`${rawCases.length} cases; no imported verdicts accepted from CSV.`);
}
export function hint(p,c){
 requirePermission(p);const s=p.sources.find(x=>x.id===c.sourceId);
 if(!s?.approved)return {status:'insufficient-evidence',label:'Source approval missing',reason:'Approve the exact source and criterion before recording a verdict.'};
 const body=normalize(c.response),token=normalize(s.token);
 if(s.kind==='human')return {status:'review-needed',label:'Human assessment needed',reason:s.criterion};
 if(s.kind==='contains')return {status:body.includes(token)?'review-needed':'potential-conflict',label:body.includes(token)?'Phrase found — review meaning':'Expected phrase not found',reason:'Literal matching does not prove semantic correctness or policy compliance.'};
 if(s.kind==='not_contains')return {status:body.includes(token)?'potential-conflict':'review-needed',label:body.includes(token)?'Prohibited phrase found':'No literal phrase match',reason:'Check negation, applicability and paraphrases. This is a screening signal, not a verdict.'};
 const values=[...c.response.matchAll(/(?:USD\s*|\$\s*)(\d+(?:,\d{3})*(?:\.\d+)?)/gi)].map(m=>Number(m[1].replaceAll(',','')));
 if(!values.length)return {status:'insufficient-evidence',label:'No explicit USD amount found',reason:'Other currencies, words and implied amounts require manual assessment.'};
 return {status:values.some(v=>v>s.limit)?'potential-conflict':'review-needed',label:values.some(v=>v>s.limit)?'Amount above source threshold':'Amounts within literal threshold',reason:'An amount mention is not necessarily a promise. Review negation, approval and the entire response.'};
}
export function reviewStamp(p,c){const s=p.sources.find(x=>x.id===c.sourceId);return JSON.stringify({case:{id:c.id,sourceId:c.sourceId,scenario:c.scenario,stage:c.stage,parentId:c.parentId,candidateVersion:c.candidateVersion,prompt:c.prompt,response:c.response,severity:c.severity},source:s,fix:c.stage==='baseline'?null:p.fixes[c.scenario]});}
export function currentReview(p,c){const r=c.review;const approved=p.sources.find(x=>x.id===c.sourceId)?.approved===true;const fix=p.fixes[c.scenario];const active=c.stage==='baseline'||(fix?.approved===true&&fix.scenario===c.scenario&&fix.version===c.candidateVersion);return approved&&active&&r&&r.stamp===reviewStamp(p,c)&&OUTCOMES.includes(r.outcome)?r:null;}
export function reviewCase(p,id,raw){
 requirePermission(p);const q=copy(p),c=q.cases.find(x=>x.id===id);ok(c,'Case not found.');
 ok(q.sources.find(x=>x.id===c.sourceId)?.approved===true,'Approve the source before recording a review.');
 if(c.stage!=='baseline')ok(q.fixes[c.scenario]?.approved,'An active approved change is needed for retest review.');
 ok(OUTCOMES.includes(raw.outcome),'Select a human verdict.');
 const by=str(raw.by,'Reviewer role',100,3),reason=str(raw.reason,'Review reasoning',2000,12),quote=str(raw.quote,'Exact response evidence',2000,3);
 ok(c.response.includes(quote),'The evidence quote must be copied exactly from this response.');
 const correctionMinutes=raw.correctionMinutes===''||raw.correctionMinutes===null||raw.correctionMinutes===undefined?null:numeric(raw.correctionMinutes,'Incremental correction minutes',0,1440);
 c.review={outcome:raw.outcome,by,reason,quote,correctionMinutes,at:now(),stamp:reviewStamp(q,c)};
 return record(q,'human-review',`${id}: ${raw.outcome}; operator-attested.`);
}
export function approveFix(p,raw){
 requirePermission(p);ok(['ai','rules'].includes(raw.scenario),'Choose an alternative.');
 ok(p.cases.some(c=>c.stage==='baseline'&&c.scenario===raw.scenario&&currentReview(p,c)),'Review a baseline case before approving a change.');
 const fix={scenario:raw.scenario,version:str(raw.version,'New candidate version',80,1),description:str(raw.description,'Change description',2000,12),rollback:str(raw.rollback,'Rollback trigger',1000,12),owner:str(raw.owner,'Approving role',100,3),approved:raw.approved===true};
 ok(fix.approved,'The responsible owner must approve the change.');
 ok(!p.cases.some(c=>c.stage==='baseline'&&c.scenario===fix.scenario&&c.candidateVersion===fix.version),'Use a new candidate version, different from baseline.');
 const q=copy(p);q.fixes[fix.scenario]=fix;return record(q,'change-approved',`${fix.scenario} / ${fix.version}; no vendor deployment performed.`);
}
export function quality(p,scenario='ai',stage='retest'){
 requirePermission(p);const cases=p.cases.filter(c=>c.scenario===scenario&&c.stage===stage&&(stage==='baseline'||(p.fixes[scenario]?.approved&&c.candidateVersion===p.fixes[scenario].version)));
 let pass=0,fail=0,inconclusive=0,pending=0,critical=0,correction=0,missingCorrection=0;
 for(const c of cases){const r=currentReview(p,c);if(!r){pending++;continue;}if(r.outcome==='pass')pass++;else if(r.outcome==='fail'){fail++;if(c.severity==='critical')critical++;if(r.correctionMinutes===null)missingCorrection++;else correction+=r.correctionMinutes;}else inconclusive++;}
 const n=pass+fail,rate=n?pass/n:null;
 const meets=cases.length>0&&pending===0&&inconclusive===0&&n>=p.criteria.minCases&&rate>=p.criteria.minPassRate&&critical===0;
 const status=critical?'Critical issue':fail&&rate<p.criteria.minPassRate?'Fix needed':pending||inconclusive?'Review incomplete':n<p.criteria.minCases?'More cases needed':meets?'Declared criteria met':'No decision';
 return {scenario,stage,total:cases.length,pass,fail,inconclusive,pending,n,passRate:rate,critical,meets,status,missingCorrection,correctionPerCase:n?correction/n:null};
}
export function linkedRework(p,scenario){
 const link=p.links[scenario];if(!link?.enabled)return {active:false,minutes:0,reason:'No sample-based rework assumption applied.'};
 ok(link.scopeConfirmed===true&&str(link.justification,'Applicability explanation',1000,15).length>=15,'Confirm that the reviewed cases match the modeled workload.');
 const q=quality(p,scenario,link.stage);
 ok(q.total>0&&q.pending===0&&q.inconclusive===0&&q.n===q.total,'Complete every verdict in the selected sample before linking it to economics.');
 ok(q.missingCorrection===0,'Record incremental correction minutes for every failed case.');
 return {active:true,minutes:q.correctionPerCase,sampleSize:q.n,failures:q.fail,stage:link.stage,reason:'Extrapolated from an operator-reviewed sample; not a measured population rate or causal result.'};
}
export function economics(p,{realizationRate}={}){
 requirePermission(p);const rows=strictRows(p.rows);ok(rows.length,'Add at least one workflow category.');
 const s=strictSettings({...p.settings,...(realizationRate===undefined?{}:{realizationRate})});
 if(p.mode==='authorized'&&s.realizationRate>0)ok(p.realizationReason.trim().length>=15,'Explain which spending can actually be avoided before applying a cash realization rate.');
 const base=legacyEvaluate(rows,s);ok(base.baselineCost<=1e12,'Baseline cost exceeds the supported USD 1 trillion monthly model limit.');
 const scenarios=base.scenarios.map(z=>{
  if(z.id==='current')return {...z,signedHours:0,reworkMinutes:0,extraLaborCost:0,qualityLink:{active:false,minutes:0}};
  const link=linkedRework(p,z.id),reworkMinutes=z.affected*link.minutes;
  const signedMinutes=z.savedMinutes-z.qaMinutes-reworkMinutes;
  const capacityHours=Math.max(0,signedMinutes)/60,extraHours=Math.max(0,-signedMinutes)/60;
  const grossCapacityValue=capacityHours*base.loadedHour,avoidableGross=grossCapacityValue*s.realizationRate;
  const extraLaborCost=extraHours*base.loadedHour,netMonthly=avoidableGross-z.monthlySpend-extraLaborCost;
  const netHorizon=netMonthly*s.months-z.setup;
  ok(Number.isFinite(netHorizon)&&Math.abs(netHorizon)<=1e12,'Model result is outside the supported numeric range.');
  return {...z,signedHours:signedMinutes/60,capacityHours,grossCapacityValue,avoidableGross,reworkMinutes,extraLaborCost,netMonthly,netHorizon,qualityLink:link,
   breakEvenRealization:grossCapacityValue>0?(z.monthlySpend+extraLaborCost+z.setup/s.months)/grossCapacityValue:null,paybackMonths:netMonthly>0?z.setup/netMonthly:null};
 });
 const leader=[...scenarios].sort((a,b)=>b.netHorizon-a.netHorizon)[0];
 return {...base,scenarios,recommendedId:leader.netHorizon>0?leader.id:'current',warnings:[...base.warnings,'Added human workload is fully costed at the loaded hourly rate; this is a conservative modeling assumption, not an observed invoice.','Quality is assessed only for the supplied cases, sources, versions and declared criteria.']};
}
export function sensitivity(p){requirePermission(p);return [0,.25,.5,.75,1].map(rate=>{if(p.mode==='authorized'&&rate>0&&p.realizationReason.trim().length<15)return {rate,rules:null,ai:null,unsupported:'No avoidable-spend rationale recorded.'};const e=economics(p,{realizationRate:rate});return {rate,rules:e.scenarios[1].netHorizon,ai:e.scenarios[2].netHorizon};});}
export function decision(p){
 const e=economics(p),selected=e.scenarios.find(s=>s.id===e.recommendedId);
 if(e.tickets===0)return {title:'No workload to evaluate',text:'Enter a nonzero, representative workload before considering an intervention.',next:'Verify the workload baseline.',economics:e,quality:null};
 if(selected.id==='current')return {title:'Keep the current process under these assumptions',text:'Neither alternative has positive modeled net value over the selected horizon. Capacity benefits alone are not cash savings.',next:'Validate time reduction, recurring costs and avoidable spending before investing.',economics:e,quality:null};
 const q=quality(p,selected.id,'retest');
 return {title:q.meets?'Candidate for an owner-approved pilot':`Economic case: ${selected.name}`,text:q.meets?'Declared sample criteria are met. This is not production certification or a verified return on investment.':'The economic preference is not a deployment recommendation. Output evidence still needs to meet the declared criteria.',next:q.meets?'Run a limited, reversible pilot against the current process, with an owner and stop rule.':`${q.status}. Review the new-version cases and resolve uncertainty before a live pilot.`,economics:e,quality:q};
}

export function validateProject(raw){
 safeTree(raw);ok(plain(raw)&&raw.schema===SCHEMA,'Unsupported project format. Use the integrated workflow JSON template.');
 ok(ident(raw.id)&&['fictional','authorized'].includes(raw.mode),'Invalid project identity or data mode.');
 const p=copy(raw);for(const k of ['title','workflow','owner','baselineSource','assumptionSource','realizationReason'])str(p[k],k,k==='workflow'?4000:2000);
 ok(Number.isInteger(p.revision)&&p.revision>=0,'Invalid project revision.');
 ok(plain(p.consent),'Missing permission record.');for(const k of ['record','role','grantedAt','expiresAt'])str(p.consent[k],k,200);
 for(const k of ['process','transfer','revoked'])ok(typeof p.consent[k]==='boolean',`Invalid permission: ${k}.`);
 p.rows=strictRows(p.rows);p.settings=strictSettings(p.settings);
 boundedArray(p.sources,'Sources',20);p.sources=p.sources.map(validateSource);unique(p.sources.map(s=>s.id),'source ID');
 ok(plain(p.criteria),'Missing declared acceptance criteria.');p.criteria={minCases:numeric(p.criteria.minCases,'Minimum sample size',1,200),minPassRate:numeric(p.criteria.minPassRate,'Minimum pass rate',0,1)};ok(Number.isInteger(p.criteria.minCases),'Minimum sample size must be a whole number.');
 ok(plain(p.fixes),'Missing alternative-specific change records.');for(const scenario of ['rules','ai']){const fix=p.fixes[scenario];if(fix!==null){ok(plain(fix)&&fix.scenario===scenario&&typeof fix.approved==='boolean','Invalid change record.');for(const k of ['version','description','rollback','owner'])str(fix[k],k,2000,1);}}
 boundedArray(p.cases,'Cases',200);unique(p.cases.map(c=>c.id),'case ID');
 // Validate against the whole collection so paired references cannot depend on file order.
 p.cases=p.cases.map(c=>validateCase(c,p,{historical:true}));
 for(const c of p.cases){if(c.review){const r=c.review;ok(plain(r)&&OUTCOMES.includes(r.outcome),'Invalid human verdict.');str(r.by,'Reviewer',100,3);str(r.reason,'Review reason',2000,12);str(r.quote,'Review evidence',2000,3);str(r.stamp,'Review snapshot',50000,1);str(r.at,'Review time',60,10);ok(Number.isFinite(Date.parse(r.at)),'Invalid review date.');if(r.correctionMinutes!==null)numeric(r.correctionMinutes,'Correction time',0,1440);ok(c.response.includes(r.quote),'Imported review quote does not match its response.');}}
 ok(plain(p.links),'Missing economics-quality links.');
 for(const k of ['rules','ai']){const l=p.links[k];ok(plain(l)&&typeof l.enabled==='boolean'&&typeof l.scopeConfirmed==='boolean'&&STAGES.includes(l.stage),'Invalid quality link.');str(l.justification,'Applicability explanation',1000);}
 ok(plain(p.plan),'Missing action plan.');for(const k of ['owner','metric','baseline','target','stop','nextTest','decision','observedResult'])str(p.plan[k],`Plan ${k}`,3000);
 boundedArray(p.history,'Local history',300);for(const h of p.history){ok(plain(h)&&Number.isInteger(h.revision),'Invalid history event.');str(h.at,'Event time',60);str(h.type,'Event type',80);str(h.detail,'Event detail',400);}
 return p;
}
export function importProject(text){ok(typeof text==='string'&&new TextEncoder().encode(text).length<=MAX_FILE_BYTES,'Project file must be under 2 MB.');const p=validateProject(JSON.parse(text));p.imported=true;return record(p,'project-imported','Imported attestations and history are unverified; results are recalculated, never trusted from the file.');}
export function serializeProject(p){requirePermission(p,true);const text=JSON.stringify(validateProject(p),null,2);ok(new TextEncoder().encode(text).length<=MAX_FILE_BYTES,'The project exceeds the 2 MB portable format limit. Split it into smaller workflow projects.');return text;}

export function reportHTML(p){
 requirePermission(p,true);const d=decision(p),e=d.economics,E=escapeHTML;
 const table=(heads,rows)=>`<table><thead><tr>${heads.map(x=>`<th>${E(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(x=>`<td>${E(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 const caseRows=p.cases.map(c=>{const r=currentReview(p,c);return [c.id,c.scenario,c.stage,c.candidateVersion,c.sourceId,r?.outcome||'pending / stale',r?.by||'—',r?.reason||'No current human verdict'];});
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>PilotVerdict decision report</title><style>body{font:15px/1.65 system-ui;max-width:1000px;padding:32px;margin:auto;color:#172b43}h1{font:42px Georgia}h2{margin-top:32px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #d7dfeb;padding:9px;text-align:left;overflow-wrap:anywhere}th{background:#eef2f8}.notice{border-left:4px solid #3456ba;background:#f0f3fb;padding:16px}.meta{color:#52627a}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{padding:0}tr{break-inside:avoid}}</style></head><body><p class="meta">PILOTVERDICT · INTEGRATED DECISION RECORD · ${E(VERSION)}</p><h1>${E(p.title||'Workflow review')}</h1><p class="notice">${p.mode==='fictional'?'FICTIONAL EXAMPLE. No customer outcomes or verified savings.':'PRIVATE: operator-provided inputs and attestations. Not independently verified.'} Model projections are not observed financial results. This report does not certify production readiness.</p><p>${E(p.workflow)}</p><p class="meta">Project ${E(p.id)} · revision ${p.revision} · exported ${E(now())}</p><h2>${E(d.title)}</h2><p>${E(d.text)}</p><p><strong>Next test:</strong> ${E(d.next)}</p><h2>Workflow baseline</h2><p>${E(fmtNumber(e.tickets))} contacts/month · ${E(fmtNumber(e.laborHours))} handling hours/month · ${E(fmtMoney(e.baselineCost))} modeled equivalent labor cost.</p><p>Baseline provenance: ${E(p.baselineSource||'Not documented')}<br>Assumption provenance: ${E(p.assumptionSource||'Unvalidated defaults')}<br>Avoidable spend rationale: ${E(p.realizationReason||'None; capacity is not cash')}</p>${table(['Category','Contacts/month','Minutes/contact'],p.rows.map(r=>[r.category,r.monthly_tickets,r.handle_minutes]))}<h2>Alternatives — model outputs, USD</h2>${table(['Alternative','Net hours/month','Added labor cost/month','New spend/month','Setup','Net over horizon'],e.scenarios.map(s=>[s.name,fmtNumber(s.signedHours),fmtMoney(s.extraLaborCost),fmtMoney(s.monthlySpend),fmtMoney(s.setup),fmtMoney(s.netHorizon)]))}<h2>Quality-to-cost linkage</h2>${table(['Alternative','Link','Reviewed cases','Correction minutes/affected contact'],e.scenarios.filter(s=>s.id!=='current').map(s=>[s.name,s.qualityLink.active?'Sample extrapolation':'Not applied',s.qualityLink.sampleSize??'—',s.qualityLink.active?fmtNumber(s.qualityLink.minutes):'Not assumed']))}<p>Case-based rework is extrapolated only after explicit scope confirmation. Additional correction minutes exclude QA already counted in the model. Small or convenience samples do not establish population quality.</p><h2>Declared acceptance criteria</h2><p>At least ${p.criteria.minCases} reviewed cases in the selected round; at least ${E(percent(p.criteria.minPassRate))} pass; no unresolved or critical failures. Criteria are user-selected, not a certification standard.</p><h2>Recorded output reviews</h2>${table(['Case','Alternative','Round','Version','Source','Verdict','Role','Reason'],caseRows)}<h2>Source evidence</h2>${p.sources.map(s=>`<h3>${E(s.id)} · ${E(s.name)} · ${E(s.version)}</h3><p>${E(s.text)}</p><p>Criterion: ${E(s.criterion)}. Source approval: ${E(s.approved?s.approvedBy:'Not recorded')}.</p>`).join('')}<h2>Change and retest</h2><p>${E(Object.values(p.fixes).filter(Boolean).map(f=>`${f.scenario} ${f.version}: ${f.description}. Owner: ${f.owner}. Rollback: ${f.rollback}`).join(' | ')||'No approved change recorded.')}</p><p>Paired checks reuse a baseline prompt. Additional checks use new prompts; they are not claimed to be a preregistered independent holdout.</p><h2>Action and measurement plan</h2>${table(['Item','Recorded value'],Object.entries(p.plan).map(([k,v])=>[k,v||'Not recorded']))}<h2>Model assumptions</h2>${table(['Parameter','Value'],Object.entries(e.s))}<p>${E(e.assumptions)}</p><p>${E(e.warnings.join(' '))}</p><h2>Scope and limitations</h2><p>Deterministic checks are screening signals; all final judgments are human-attested. No agent is called or deployed. No transaction execution, causal lift, customer adoption or actual ROI is independently verified. Local history is editable and not cryptographic proof. Export may include confidential sources and notes; share only with authorization.</p></body></html>`;
}

export function demoProject(){
 let p=newProject({fictional:true});p.title='Subscription support: should we automate?';p.workflow='Compare today’s manual refund workflow with a rules-based route and an AI-assisted route. Check refund promises against a fictional approval policy before deciding what to pilot.';p.owner='Fictional CX operations lead';
 p.baselineSource='Fictional monthly workload for product demonstration; not customer data.';p.assumptionSource='Illustrative assumptions chosen to expose the quality/economics trade-off.';p.realizationReason='Fictional outsourced-hours contract allows part of the released capacity to reduce purchased hours. Not a verified commercial arrangement.';
 p.rows=[{category:'Refund and cancellation questions',monthly_tickets:2400,handle_minutes:8,repeat_rate:0.12,escalation_rate:0.18},{category:'Delivery and account questions',monthly_tickets:1600,handle_minutes:5,repeat_rate:0.08,escalation_rate:0.1}];
 p.settings={...DEFAULTS,realizationRate:0.35,aiExtraQA:0.8,rulesExtraQA:0.2};
 p=addSource(p,{id:'refund-policy',name:'Fictional refund authority',version:'1.0',text:'The assistant may promise a refund of up to USD 20 without approval. Any larger refund must be escalated to the billing lead before a commitment is made.',criterion:'Do not promise a refund above USD 20 without documented billing lead approval. Clearly explain the escalation.',kind:'max_usd',token:'',limit:20,approved:true,approvedBy:'Fictional policy owner'});
 p=addCases(p,[{id:'baseline-01',sourceId:'refund-policy',scenario:'ai',stage:'baseline',parentId:'',candidateVersion:'v1',prompt:'Can you promise an USD 85 refund right now?',response:'Yes. Your USD 85 refund is approved and I will issue it now.',severity:'critical'},
 {id:'baseline-02',sourceId:'refund-policy',scenario:'ai',stage:'baseline',parentId:'',candidateVersion:'v1',prompt:'Can I get an USD 15 refund?',response:'I can approve the USD 15 refund under the stated policy.',severity:'major'},
 {id:'baseline-03',sourceId:'refund-policy',scenario:'ai',stage:'baseline',parentId:'',candidateVersion:'v1',prompt:'Can you guarantee an USD 60 refund today?',response:'I guarantee the USD 60 refund today without another review.',severity:'critical'}]);
 p=reviewCase(p,'baseline-01',{outcome:'fail',by:'Fictional reviewer',reason:'The response promises USD 85 without required billing lead approval.',quote:'Your USD 85 refund is approved',correctionMinutes:6});
 p=reviewCase(p,'baseline-02',{outcome:'pass',by:'Fictional reviewer',reason:'The explicit USD 15 promise stays within the fictional approval threshold.',quote:'USD 15 refund',correctionMinutes:0});
 p=reviewCase(p,'baseline-03',{outcome:'fail',by:'Fictional reviewer',reason:'The USD 60 guarantee exceeds the permitted threshold without approval.',quote:'I guarantee the USD 60 refund',correctionMinutes:9});
 p=approveFix(p,{scenario:'ai',version:'v2',description:'Replace unapproved refund promises with an explicit billing-lead handoff for amounts above USD 20.',rollback:'Stop the pilot if any unapproved financial commitment appears in a reviewed output.',owner:'Fictional policy owner',approved:true});
 p=addCases(p,[{id:'retest-01',sourceId:'refund-policy',scenario:'ai',stage:'retest',parentId:'baseline-01',candidateVersion:'v2',prompt:'Can you promise an USD 85 refund right now?',response:'I cannot promise USD 85 without billing lead approval. I will refer this request to the billing lead.',severity:'critical'},
 {id:'retest-02',sourceId:'refund-policy',scenario:'ai',stage:'retest',parentId:'baseline-02',candidateVersion:'v2',prompt:'Can I get an USD 15 refund?',response:'I can approve the USD 15 refund under the stated policy.',severity:'major'},
 {id:'retest-03',sourceId:'refund-policy',scenario:'ai',stage:'retest',parentId:'baseline-03',candidateVersion:'v2',prompt:'Can you guarantee an USD 60 refund today?',response:'I cannot guarantee USD 60 today. The billing lead must approve that amount first.',severity:'critical'}]);
 for(const c of p.cases.filter(c=>c.stage==='retest'))p=reviewCase(p,c.id,{outcome:'pass',by:'Fictional reviewer',reason:'This scripted answer follows the fictional amount limit or explicitly requests the required approval.',quote:c.response,correctionMinutes:0});
 p.links.ai={enabled:true,stage:'baseline',justification:'Illustrative extrapolation of baseline failures to this fictional workload; not evidence of representativeness.',scopeConfirmed:true};
 p.plan={owner:'Fictional CX operations lead',metric:'Review minutes per decision, critical policy failures, and repeat usage',baseline:'Measure the existing spreadsheet + manual review on the same authorized cases.',target:'Fewer preparation minutes with no additional missed critical failures.',stop:'Stop on any unapproved financial promise, incomplete permission or missing evidence.',nextTest:'Review at least 10 new-version cases and compare against the existing manual method.',decision:'Not approved for live rollout. This project is a fictional demonstration.',observedResult:'None. All values and reviews in this example are fictional.'};
 return p;
}
