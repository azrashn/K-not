/** SQL/auth/lifecycle tests. Upstream service is explicitly fake. */
import { Harness } from '../support/harness';
const h=new Harness();beforeAll(()=>h.start());afterAll(()=>h.stop());beforeEach(()=>h.reset());
const create=async()=>h.http().post('/courses').set(await h.as('ayse')).send({name:'My own course',description:'Private study',category:'Physics'}).expect(201);

test('personal course CRUD and archive stay owner/member scoped',async()=>{
 const c=(await create()).body;expect(c.can_manage).toBe(true);expect(c.material_count).toBe(0);
 await h.http().patch('/courses/'+c.id).set(await h.as('mehmet')).send({name:'hijacked'}).expect(404);
 await h.http().patch('/courses/'+c.id).set(await h.as('ayse')).send({name:'Renamed'}).expect(200);
 await h.http().post(`/courses/${c.id}/archive`).set(await h.as('ayse')).send({archived:true}).expect(200);
 expect((await h.http().get('/courses').set(await h.as('ayse'))).body.some((x:any)=>x.id===c.id)).toBe(false);
 expect((await h.http().get('/courses?archived=1').set(await h.as('ayse'))).body.find((x:any)=>x.id===c.id).archived).toBe(true);
 await h.http().post(`/courses/${c.id}/archive`).set(await h.as('ayse')).send({archived:false}).expect(200);
 await h.http().delete('/courses/'+c.id).set(await h.as('ayse')).send({confirm_name:'wrong'}).expect(422);
 await h.http().delete('/courses/'+c.id).set(await h.as('mehmet')).send({confirm_name:'Renamed'}).expect(404);
 await h.http().delete('/courses/'+c.id).set(await h.as('ayse')).send({confirm_name:'Renamed'}).expect(200);
 await h.http().get('/courses/'+c.id).set(await h.as('ayse')).expect(404);
 expect(await h.prisma.course.count({where:{id:h.world.courses.vy}})).toBe(1);
});
test('shared/legacy courses cannot be deleted, even by personal owner if another member exists',async()=>{
 await h.http().delete('/courses/'+h.world.courses.vy).set(await h.as('instructor')).send({confirm_name:'Veri Yapıları'}).expect(404);
 const c=(await create()).body;
 await h.prisma.courseMembership.create({data:{courseId:c.id,userId:h.world.users.mehmet,role:'STUDENT'}});
 await h.http().delete('/courses/'+c.id).set(await h.as('ayse')).send({confirm_name:c.name}).expect(403);
 expect((await h.prisma.course.findUniqueOrThrow({where:{id:c.id}})).lifecycle).toBe('ACTIVE');
});
test('failed index cleanup is retryable; own file and other courses remain intact',async()=>{
 const c=(await create()).body;
 await h.prisma.studyMaterial.create({data:{id:'remove-me',ownerId:h.world.users.ayse,courseId:c.id,kind:'TXT',filename:'a.txt',title:'A',sha256:'a'.repeat(64),segments:[]}});
 let fail=true;h.ai.on('DELETE','/api/v1/knowledge/',()=>({status:fail?503:200,body:{deleted:true}}));
 await h.http().delete('/courses/'+c.id).set(await h.as('ayse')).send({confirm_name:c.name}).expect(503);
 const failed=await h.prisma.course.findUniqueOrThrow({where:{id:c.id}});expect(failed.lifecycle).toBe('DELETING');expect(failed.deletionError).toBeTruthy();
 expect(await h.prisma.studyMaterial.count({where:{courseId:c.id}})).toBe(1);
 await h.http().get(`/courses/${c.id}/knowledge/materials`).set(await h.as('ayse')).expect(404);
 fail=false;await h.http().delete('/courses/'+c.id).set(await h.as('ayse')).send({confirm_name:c.name}).expect(200);
 expect(await h.prisma.studyMaterial.count({where:{courseId:c.id}})).toBe(0);
 expect(await h.prisma.course.count({where:{lifecycle:'ACTIVE'}})).toBe(2);
});
