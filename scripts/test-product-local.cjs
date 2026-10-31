/** Opt-in REAL local services, MySQL, original rendering, local model and Edge.
 * Reuses one own course on rerun. Never removes existing/demo courses. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'data/product-tests'),report={checks:[],status:'running'};
const seed=JSON.parse(fs.readFileSync(path.join(root,'data/video-tests/last-run.json'),'utf8'));
const accounts=JSON.parse(fs.readFileSync(seed.credentials_file,'utf8')).accounts;
const record=(name,detail={})=>{report.checks.push({name,status:'PASS',...detail});console.log(name,JSON.stringify(detail));};
let token;
async function api(method,route,body,t=token){const r=await fetch('http://127.0.0.1:3100'+route,{method,headers:{...(t?{Authorization:'Bearer '+t}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});let data=await r.json();return{status:r.status,data};}
async function ok(method,route,body){const r=await api(method,route,body);assert.ok(r.status>=200&&r.status<300,`${route}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
async function main(){let browser,prisma;try{
 fs.mkdirSync(out,{recursive:true});token=(await ok('POST','/auth/login',{email:accounts[0].email,password:accounts[0].password})).access_token;
 const before=await ok('GET','/courses');report.preexisting_course_ids=before.map(c=>c.id);
 browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5174/#/dersler');await page.getByLabel('E-posta',{exact:true}).click();await page.getByLabel('E-posta',{exact:true}).fill(accounts[0].email);await page.getByLabel('Parola',{exact:true}).click();await page.getByLabel('Parola',{exact:true}).fill(accounts[0].password);await page.getByRole('button',{name:'Giriş yap',exact:true}).click();await page.getByRole('button',{name:'Çıkış yap'}).waitFor();
 let course=before.find(c=>c.name==='İntegral • Ürün kabul testi'&&c.can_manage);
 if(!course){await page.getByRole('button',{name:'+ Yeni ders oluştur',exact:true}).click();await page.getByLabel('Ders adı',{exact:true}).fill('İntegral • Ürün kabul testi');await page.getByLabel('Açıklama isteğe bağlı').fill('K-NOT için özgün PDF, sunum ve öğrenme döngüsü testi.');await page.getByLabel('Akademik alan isteğe bağlı').fill('Matematik');await page.getByRole('button',{name:'Dersi oluştur',exact:true}).click();await page.getByRole('heading',{name:'İntegral • Ürün kabul testi',exact:true}).waitFor();course=(await ok('GET','/courses')).find(c=>c.name==='İntegral • Ürün kabul testi'&&c.can_manage);}
 else await page.goto('http://127.0.0.1:5174/#/dersler/'+course.id+'/ogrenme');
 assert.ok(course);report.course_id=course.id;record('real-browser-create-course',{id:course.id});
 const base='/courses/'+course.id,k=base+'/knowledge';
 process.loadEnvFile(path.join(root,'backend/.env'));
 const {PrismaService}=require('../backend/dist/prisma/prisma.service'),{loadConfig}=require('../backend/dist/config/config');prisma=new PrismaService(loadConfig());
 const original=await prisma.video.findFirst({where:{ownerId:accounts[0].id,courseId:{not:course.id},originalFilename:{contains:'integral'}}});assert.ok(original,'Prior own real integral video required');
 const originalProgress=await prisma.videoProgress.findMany({where:{videoId:original.id}});
 let video=await prisma.video.findFirst({where:{ownerId:accounts[0].id,courseId:course.id,engineVideoId:original.engineVideoId}});
 if(!video)video=await prisma.video.create({data:{id:require('node:crypto').randomUUID(),ownerId:accounts[0].id,courseId:course.id,engineVideoId:original.engineVideoId,contentSha256:original.contentSha256,title:original.title,originalFilename:original.originalFilename,durationMs:original.durationMs}});
 const otherToken=(await api('POST','/auth/login',{email:accounts[1].email,password:accounts[1].password},null)).data.access_token;
 assert.equal((await api('GET',base,undefined,otherToken)).status,404);record('other-user-course-isolation');
 let listed=(await ok('GET',k+'/materials')).materials;
 for(const filename of ['integral-10-pages.pdf','integral-5-slides.pptx','integral-notes.txt']){
  if(listed.some(m=>m.title===filename||m.title===filename.replace('.pdf','')))continue;
  await page.getByLabel('Ortak ders materyali seç').setInputFiles(path.join(out,'fixtures',filename));
  await page.locator('.upload-drop').filter({hasText:'Belge yükle'}).waitFor({timeout:180000});
 }
 for(let i=0;i<90;i++){listed=(await ok('GET',k+'/materials')).materials;if(listed.length===4&&listed.every(m=>m.status==='READY'))break;await new Promise(r=>setTimeout(r,1000));}
 assert.equal(listed.length,4);assert.ok(listed.every(m=>m.status==='READY'));report.materials=listed;record('real-browser-upload-and-ingestion',{kinds:listed.map(m=>m.kind)});
 await page.getByRole('button',{name:'İşleme durumunu yenile'}).click();
 const textMaterial=listed.find(m=>m.kind==='TXT');
 await page.getByRole('button').filter({hasText:textMaterial.title}).first().click();
 await page.getByRole('button',{name:'Yeniden adlandır',exact:true}).click();await page.getByLabel('Materyal adı',{exact:true}).fill('İntegral çalışma notu');await page.getByRole('button',{name:'Adı kaydet',exact:true}).click();await page.getByRole('heading',{name:'İntegral çalışma notu',exact:true}).waitFor();
 await ok('PATCH',k+'/materials/'+textMaterial.id,{title:'integral-notes.txt'});await page.getByRole('button',{name:'İşleme durumunu yenile'}).click();record('real-material-rename-preserves-file');
 for(const [kind,target] of [['PDF',10],['PPTX',5]]){
  const m=listed.find(m=>m.kind===kind);await page.getByRole('button').filter({hasText:m.title}).first().click();
  const label=kind==='PDF'?'Sayfa':'Slayt';await page.getByRole('img',{name:new RegExp(label+' 1$')}).waitFor({timeout:180000});
  await page.getByRole('spinbutton',{name:label+' numarası'}).fill(String(target));
  const img=page.getByRole('img',{name:new RegExp(label+' '+target+'$')});await img.waitFor({timeout:180000});
  await img.evaluate(el=>el.decode());assert.ok(await img.evaluate(el=>el.naturalWidth>100));
  await page.screenshot({path:path.join(out,'real-'+kind.toLowerCase()+'-viewer.png')});
  const raw=await fetch('http://127.0.0.1:3100'+k+'/materials/'+m.id+'/visual/'+target,{headers:{Authorization:'Bearer '+token}});assert.equal(raw.status,200);const bytes=Buffer.from(await raw.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');fs.writeFileSync(path.join(out,'rendered-'+kind.toLowerCase()+'.png'),bytes);
  const denied=await fetch('http://127.0.0.1:3100'+k+'/materials/'+m.id+'/visual/1',{headers:{Authorization:'Bearer '+otherToken}});assert.equal(denied.status,404);
  record('faithful-'+kind.toLowerCase()+'-visual-page-jump',{page:target,pages:Number(raw.headers.get('x-page-count')),bytes:bytes.length});
 }
 await ok('PUT',base+'/videos/'+video.id+'/progress',{position_ms:12000,intervals:[]});
 await page.getByRole('button').filter({hasText:video.title}).first().click();await page.getByLabel('Ortak ders videosu').waitFor();
 await page.waitForFunction(()=>{const v=document.querySelector('video');return v?.readyState>=1&&Math.abs(v.currentTime-12)<.3});
 assert.equal((await ok('GET',base+'/videos/'+video.id+'/progress')).intervals.length,0);record('real-video-resume-seek-does-not-mark-watched');
 await page.getByRole('button',{name:'+ Yeni konuşma',exact:true}).click();
 await page.getByLabel('Ders kaynaklarına sorun').fill('İntegralde değişken değiştirme yöntemi nasıl kullanılır?');
 await page.getByRole('button',{name:'Gönder ↑',exact:true}).click();await page.getByLabel('Ders yanıtı 1',{exact:true}).waitFor({timeout:180000});
 let threads=await ok('GET',k+'/conversations');const chat=threads[0];assert.ok(chat);report.chat_id=chat.id;
 let saved=await ok('GET',k+'/conversations/'+chat.id),first=saved.messages.filter(m=>m.role==='assistant').at(-1);
 assert.ok(first.payload.evidence.length);record('real-local-source-aware-answer',{generation_status:first.payload.status,llm_used:first.payload.llm_used,source_kinds:[...new Set(first.payload.evidence.map(e=>e.kind))]});
 await page.reload();await page.getByLabel('Ders yanıtı 1',{exact:true}).waitFor();
 await page.getByLabel('Ders kaynaklarına sorun').fill('Bir örnek göster');await page.getByRole('button',{name:'Gönder ↑',exact:true}).click();await page.getByLabel('Ders yanıtı 2',{exact:true}).waitFor({timeout:180000});
 saved=await ok('GET',k+'/conversations/'+chat.id);const last=saved.messages.filter(m=>m.role==='assistant').at(-1);assert.match(last.payload.resolved_question,/Takip sorusu/);assert.ok(last.payload.evidence.length);
 assert.equal((await api('GET',k+'/conversations/'+chat.id,undefined,otherToken)).status,404);record('persistent-follow-up-after-browser-reload',{messages:saved.messages.length});
 const evidence=last.payload.evidence[0];await page.getByLabel('Ders yanıtı 2',{exact:true}).getByRole('button').filter({hasText:'['+evidence.n+']'}).first().click();await page.getByRole('heading',{name:evidence.title,exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'real-conversation.png')});record('real-answer-source-opens-viewer');
 await page.goto('http://127.0.0.1:5174/#/dersler/'+course.id+'/quiz');await page.getByLabel('Konu',{exact:true}).fill('İntegralde değişken değiştirme');await page.getByLabel('Soru türü',{exact:true}).selectOption('CLOZE');await page.getByRole('button',{name:'Alıştırma hazırla'}).click();await page.getByLabel('Yanıtın',{exact:true}).waitFor({timeout:180000});await page.getByLabel('Yanıtın',{exact:true}).fill('yanlış yanıt');await page.getByRole('button',{name:'Yanıtı değerlendir'}).click();await page.getByLabel('Alıştırma geri bildirimi').waitFor();assert.ok(await page.getByText('Kaynağı tekrar incele',{exact:true}).isVisible());
 await page.screenshot({path:path.join(out,'real-quiz.png')});const overview=await ok('GET','/learning/overview');assert.ok(overview.attempts.some(a=>a.course_id===course.id&&a.score===0));assert.equal(overview.mastery_estimated,false);assert.ok(overview.recommendation?.source);record('real-quiz-wrong-feedback-persisted');
 await page.getByRole('button',{name:'Çalışmalarımı incele',exact:true}).click();await page.getByRole('heading',{name:'Öğrenme Analizi',exact:true}).waitFor();await page.screenshot({path:path.join(out,'real-analytics.png')});await page.getByRole('button',{name:'Kaynağa dön →',exact:true}).first().click();await page.getByRole('heading',{name:overview.recommendation.source.title,exact:true}).waitFor();record('analytics-to-exact-source-learning-loop');
 for(const kind of ['TRUE_FALSE','SHORT_ANSWER','OPEN','MULTIPLE_CHOICE']){
  const r=await api('POST',base+'/quizzes',{topic:'Değişken değiştirmede u = g(x)',kind});
  if(kind==='MULTIPLE_CHOICE'&&r.status!==201){report.checks.push({name:'real-local-mcq',status:'BLOCKED',detail:r.data.error?.message||r.status});continue;}
  assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.expected,undefined);const answer=r.data.options?.length?'0':'Kendi sözcüklerimle anlatıyorum.';const grade=await ok('POST',base+'/quizzes/'+r.data.id+'/answers',{response:answer});if(kind==='OPEN')assert.equal(grade.score,null);record('real-'+kind.toLowerCase(),{score:grade.score,experimental:r.data.experimental,assessment:r.data.assessment,llm_used:r.data.llm_used});
 }
 for(const [name,route] of [['home','/'],['courses','/dersler'],['mobile-workspace',base.replace('/courses/','/dersler/')+'/ogrenme']]){
  await page.setViewportSize(name==='mobile-workspace'?{width:390,height:844}:{width:1600,height:1000});await page.goto('http://127.0.0.1:5174/#'+route);await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'real-'+name+'.png')});record(name+'-no-horizontal-overflow');
 }
 await page.setViewportSize({width:1600,height:1000});await page.goto('http://127.0.0.1:5174/#/dersler');await page.getByLabel('Derslerde ara',{exact:true}).fill(course.name);
 let card=page.locator('.course-card').filter({hasText:course.name});await card.getByRole('button',{name:'Düzenle',exact:true}).click();await page.getByLabel('Ders adı',{exact:true}).fill(course.name);await page.getByLabel('Açıklama isteğe bağlı').fill('Gerçek öğrenme döngüsü doğrulandı.');await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await card.getByRole('button',{name:'Arşivle',exact:true}).click();await card.waitFor({state:'hidden'});await page.getByLabel('Arşivdekileri göster').check();card=page.locator('.course-card').filter({hasText:course.name});await card.getByRole('button',{name:'Arşivden çıkar',exact:true}).click();record('real-browser-edit-archive-restore');
 const disposable=await ok('POST','/courses',{name:'Geçici silme doğrulaması '+Date.now()});
 const form=new FormData();form.set('file',new Blob(['Only our disposable test source for deletion validation.']),'deletion.txt');const own=await ok('POST','/courses/'+disposable.id+'/knowledge/materials',form);
 const ownMaterials=(await ok('GET','/courses/'+disposable.id+'/knowledge/materials')).materials;
 await ok('POST','/courses/'+disposable.id+'/knowledge/answers',{question:'deletion validation'});
 const stored=await prisma.studyMaterial.findUniqueOrThrow({where:{id:own.id.replace('file_','')}}),config=loadConfig(),originalPath=path.resolve(config.storageRoot,stored.storageKey);assert.ok(fs.existsSync(originalPath));
 await page.reload();await page.getByLabel('Derslerde ara',{exact:true}).fill(disposable.name);const removeCard=page.locator('.course-card').filter({hasText:disposable.name});await removeCard.getByRole('button',{name:'Sil',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Kalıcı olarak sil',exact:true}).isDisabled(),true);await page.getByLabel('Onaylamak için “'+disposable.name+'” yaz',{exact:true}).fill(disposable.name);await page.getByRole('button',{name:'Kalıcı olarak sil',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden',timeout:180000});
 assert.equal(fs.existsSync(originalPath),false);assert.equal((await api('GET','/courses/'+disposable.id+'/knowledge/materials')).status,404);assert.equal(await prisma.learningConversation.count({where:{courseId:disposable.id}}),0);
 const state=await fetch('http://127.0.0.1:8110/api/v1/knowledge/state',{method:'POST',headers:{Authorization:'Bearer '+process.env.RAG_INTERNAL_API_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({course_id:disposable.id,materials:ownMaterials.map(({id,kind,title,version})=>({id,kind,title,version}))})});assert.equal(state.status,200);assert.equal((await state.json()).versions[own.id],'deleted');record('explicit-browser-delete-removes-file-chat-and-search-content');
 assert.deepEqual(errors,[]);assert.deepEqual(await prisma.videoProgress.findMany({where:{videoId:original.id}}),originalProgress);record('prior-video-progress-preserved');
 const after=await ok('GET','/courses');assert.ok(report.preexisting_course_ids.every(id=>after.some(c=>c.id===id)));record('preexisting-courses-preserved');report.status=report.checks.some(c=>c.status==='BLOCKED')?'PARTIAL':'PASS';
 }catch(e){report.status='FAIL';report.error=e.message;throw e;}finally{fs.writeFileSync(path.join(out,'product-run.json'),JSON.stringify(report,null,2));await browser?.close();await prisma?.$disconnect();}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
