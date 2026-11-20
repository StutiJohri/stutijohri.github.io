import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFile(path.join(root,p),'utf8');
function bundle(source,name,dependencies={}){
 const exports=[...source.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]);
 source=source.replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/g,(_,names,dep)=>{
  if(!dependencies[dep])throw new Error('Unknown module dependency: '+dep);
  return `const {${names.replace(/\s+as\s+/g,':')}}=${dependencies[dep]};`;
 }).replace(/\bexport\s+(?=const|function)/g,'');
 return `const ${name}=(()=>{\n${source}\nreturn {${exports.join(',')}};\n})();`;
}
const model=bundle(await read('src/vendor/model.js'),'PVModel');
const csv=bundle(await read('src/vendor/csv.js'),'PVCSV',{'./model.js':'PVModel'});
const core=bundle(await read('src/domain.js'),'PVCore',{'./vendor/model.js':'PVModel','./vendor/csv.js':'PVCSV'});
const app=(await read('src/app.js')).replace(/import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/domain\.js['"];?/,(_,names)=>`const {${names}}=PVCore;`);
const style=await read('src/style.css'),shell=await read('src/shell.html');
const hash=text=>createHash('sha256').update(text).digest('base64');
const executable=appSource=>`'use strict';\n(()=>{\n${model}\n${csv}\n${core}\n${appSource}\n})();`;
function standalone(js){
 if(/<\/script/i.test(js))throw new Error('Script terminator in bundle.');
 const csp=`default-src 'none'; script-src 'sha256-${hash(js)}'; style-src 'sha256-${hash(style)}' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
 return shell.replace('__CSP__',csp).replace('__CSS__',()=>style).replace('__JS__',()=>js);
}
function hosted(script){
 const csp="default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 return shell.replace('__CSP__',csp).replace('<style>__CSS__</style>','<link rel="stylesheet" href="./assets/style.css">').replace('<script>__JS__</script>',`<script src="./assets/${script}" defer></script>`);
}
const storyApp=app.replace(/:'home';\nrender\(\);\s*$/,":'story';\nrender();");
if(storyApp===app)throw new Error('Unable to set standalone portfolio route.');
const js=executable(app),storyJS=executable(storyApp);
for(const dir of ['assets','preview'])await mkdir(path.join(root,dir),{recursive:true});
const outputs={
 'index.html':hosted('app.js'), 'portfolio.html':hosted('portfolio.js'),
 'assets/app.js':js,'assets/portfolio.js':storyJS,'assets/style.css':style,
 '.nojekyll':'','preview/index.html':standalone(js),'preview/portfolio.html':standalone(storyJS)
};
for(const [file,text] of Object.entries(outputs))await writeFile(path.join(root,file),text);
await writeFile(path.join(root,'BUILD_MANIFEST.json'),JSON.stringify({buildTool:'dependency-free Node bundle',files:Object.fromEntries(Object.entries(outputs).map(([file,text])=>[file,{bytes:Buffer.byteLength(text),sha256:createHash('sha256').update(text).digest('hex')}]))},null,2)+'\n');
console.log('Built root site and standalone preview. Same-origin application code; Google Fonts for approved typography.');
