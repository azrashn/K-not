/** Run after restarting ONLY Knot; proves SQL survives loss of RAM receipts. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'data/product-tests');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'data/video-tests/last-run.json'),'utf8')),
 account=JSON.parse(fs.readFileSync(fixture.credentials_file,'utf8')).accounts[0],run=JSON.parse(fs.readFileSync(path.join(out,'product-run.json'),'utf8'));
async function main(){let token;
 async function request(method,route,body){const r=await fetch('http://127.0.0.1:3100'+route,{method,headers:{Authorization:token?'Bearer '+token:'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(180000)});const d=await r.json();assert.ok(r.ok,JSON.stringify(d));return d;}
 token=(await request('POST','/auth/login',{email:account.email,password:account.password})).access_token;
 const base='/courses/'+run.course_id,k=base+'/knowledge',saved=await request('GET',k+'/conversations/'+run.chat_id);assert.ok(saved.messages.length>=4);
 const quizzes=await request('GET',base+'/quizzes');assert.ok(quizzes.length>=5);assert.ok(quizzes.some(q=>q.attempts.length));
 const next=await request('POST',k+'/answers',{chat_id:run.chat_id,question:'Önceki örneği daha basit açıkla'});assert.match(next.resolved_question,/Takip sorusu/);assert.ok(next.evidence.length);
 const overview=await request('GET','/learning/overview');assert.ok(overview.attempts.some(a=>a.course_id===run.course_id));
 const result={status:'PASS',saved_messages:saved.messages.length,quizzes:quizzes.length,followup_evidence:next.evidence.length,generation_status:next.status};fs.writeFileSync(path.join(out,'restart-proof.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
