/** Opt-in actual QA uploads + quiz API. Writes only the dedicated QA account. No reset. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'data/qa');
const account=JSON.parse(fs.readFileSync(path.join(out,'account.json')));
assert.equal(account.purpose,'knot-isolated-qa');
const recordFile=path.join(out,'a1-course.json');let token;
async function call(method,route,body){
 const form=body instanceof FormData;
 const response=await fetch('http://127.0.0.1:3100'+route,{method,
  headers:{...(token?{Authorization:'Bearer '+token}:{}),...(!form&&body?{'Content-Type':'application/json'}:{})},
  body:form?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(160000)});
 const data=await response.json();
 if(!response.ok) throw Error(`${route}: HTTP${response.status} ${data.error?.message||''}`);
 return data;
}
async function upload(route,file,name,type){const form=new FormData();form.append('file',new Blob([fs.readFileSync(file)],{type}),name);return call('POST',route,form);}
async function main(){
 token=(await call('POST','/auth/login',{email:account.email,password:account.password})).access_token;
 const courses=await call('GET','/courses');
 let record=fs.existsSync(recordFile)?JSON.parse(fs.readFileSync(recordFile)):null;
 if(record){assert.equal(record.user_id,account.id);assert.ok(courses.some(c=>c.id===record.course_id));}
 else {const course=await call('POST','/courses',{name:'QA A1 • Gerçek slayt ve video',description:'İzole kaynaklı quiz kabulü',category:'QA'});
  record={user_id:account.id,course_id:course.id};fs.writeFileSync(recordFile,JSON.stringify(record,null,2));}
 const base='/courses/'+record.course_id;
 if(!record.pdf_id){const form=new FormData();form.append('document_type','slide');
  form.append('file',new Blob([fs.readFileSync(path.join(root,'data/product-tests/fixtures/integral-10-pages.pdf'))],{type:'application/pdf'}),'qa-integral.pdf');
  const pdf=await call('POST',base+'/documents',form);record.pdf_id=pdf.id;fs.writeFileSync(recordFile,JSON.stringify(record,null,2));}
 if(!record.slide_id){const slide=await upload(base+'/knowledge/materials',path.join(root,'data/product-tests/fixtures/integral-5-slides.pptx'),'qa-integral-slides.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation');
  record.slide_upload=slide;record.slide_id=slide.id;fs.writeFileSync(recordFile,JSON.stringify(record,null,2));}
 if(!record.video_id){const videoFile=path.join(root,'../Documents/Codex/2026-10-27/codex-g-revi-multimodal-video-rag/outputs/VideoRAG_Raporlari/photosynthesis-qa.mp4');
  const video=await upload(base+'/videos',videoFile,'qa-photosynthesis.mp4','video/mp4');record.video_id=video.id;fs.writeFileSync(recordFile,JSON.stringify(record,null,2));}
 console.log(JSON.stringify({setup:'PASS',course:record.course_id,video:record.video_id}));
 if(process.argv.includes('--setup-only'))return;
 const materials=await call('GET',base+'/knowledge/materials');
 fs.writeFileSync(path.join(out,'a1-materials.json'),JSON.stringify(materials,null,2));
 const report={started_at:new Date().toISOString(),runs:[]};
 const allowedTypes=['MULTIPLE_CHOICE','TRUE_FALSE','CLOZE','SHORT_ANSWER','OPEN'];
 const typeArg=process.argv.find(a=>a.startsWith('--types='));
 const materialArg=process.argv.find(a=>a.startsWith('--materials='));
 const types=typeArg?typeArg.slice(8).split(','):process.argv.includes('--all-types')?allowedTypes:['MULTIPLE_CHOICE'];
 const kinds=materialArg?materialArg.slice(12).split(','):['PPTX','VIDEO','PDF'];
 assert.ok(types.every(t=>allowedTypes.includes(t))&&kinds.every(k=>['PPTX','VIDEO','PDF'].includes(k)));
 for(const kind of kinds){
  const m=materials.materials.find(m=>m.kind===kind&&m.status==='READY');
  if(!m){report.runs.push({kind,status:'NOT_READY'});continue;}
  const preview=await call('GET',base+'/knowledge/materials/'+m.id);
  fs.writeFileSync(path.join(out,'a1-'+kind+'-preview.json'),JSON.stringify(preview,null,2));
  const topic=kind==='VIDEO'?'Fotosentez':'İntegralde değişken değiştirme';
  for(const question_type of types){
  const start=Date.now();let run={kind,question_type,topic,material_id:m.id};
  try {const q=await call('POST',base+'/quizzes',{topic,kind:question_type,scope:{mode:'selected',material_ids:[m.id]}});
   assert.equal(q.kind,question_type);
   assert.equal(q.options.length,question_type==='MULTIPLE_CHOICE'?4:question_type==='TRUE_FALSE'?2:0);assert.equal(q.objective,null);
   for(const k of ['expected','quote','explanation','option_feedback','completion_proof'])assert.equal(q[k],undefined);
   assert.equal(q.source.material_id,m.id);assert.equal(q.source.text,undefined);
   const reloaded=await call('GET',base+'/quizzes/'+q.id);assert.deepEqual(reloaded,q);
   // Deliberately choose first option; this is NOT a claim that it is correct.
   const feedback=await call('POST',base+'/quizzes/'+q.id+'/answers',{response:q.options.length?'0':'Örnek öğrenci açıklaması'});
   if(question_type==='OPEN'){assert.equal(feedback.score,null);assert.equal(feedback.outcome,'REFLECTION_SAVED');}
   assert.ok(feedback.quote&&feedback.source?.id);const source=await call('GET',base+'/knowledge/materials/'+m.id+'/sources/'+feedback.source.id);
   assert.ok(source.text.includes(feedback.quote));
   run={...run,status:'PASS_PIPELINE_REQUIRES_CONTENT_REVIEW',quiz:q,feedback};
  } catch(e){run={...run,status:'FAIL',error:e.message};}
  run.ms=Date.now()-start;report.runs.push(run);
  fs.writeFileSync(path.join(out,'a1-real-sources-'+report.started_at.replaceAll(/[:.]/g,'-')+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({kind,question_type,status:run.status,ms:run.ms}));
  }
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
