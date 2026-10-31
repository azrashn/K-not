import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { AiServiceClient } from '../ai/ai-client';
import { AccessService } from '../courses/access.service';
import { PrismaService, isUniqueViolation } from '../prisma/prisma.service';
import { Storage, pagesKey } from '../storage/storage';
import { AuthUser } from '../common/request-context';
import { ApiError, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { VideosService } from '../videos/videos.service';
import { classifyLearning } from '../videos/learning-state';
import { RateLimiter } from '../common/rate-limit';
import { LearningHistoryService } from '../learning/history.service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
interface Material { id: string; kind: string; title: string; version: string; source_id: string; status: string; row: any }
interface Receipt { user: string; course: string; question: string; evidence: any[]; expires: number; resolved: string; answer: string; relations: any[]; conflicts: any[] }

@Injectable()
export class KnowledgeService {
  private readonly receipts = new Map<string, Receipt>();
  private readonly limiter = new RateLimiter(15);
  private readonly synchronizing = new Map<string, Promise<void>>();
  private readonly practices = new Map<string, { user: string; course: string; material: string; source: string; expected: string; expires: number }>();
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService,
    private readonly ai: AiServiceClient, private readonly storage: Storage, private readonly videos: VideosService,
    private readonly history: LearningHistoryService) {}

  private async call(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<any> {
    const r = await this.ai.call(method, '/api/v1/knowledge' + path, { body, timeoutMs: 120000 });
    if (r.kind === 'response' && [413, 422].includes(r.status)) throw new ApiError('VALIDATION_ERROR', 'Materyalin biçimi veya içerik sınırları desteklenmiyor. Daha küçük, geçerli bir dosya kullanın.');
    if (r.kind !== 'response' || r.status !== 200) throw new ApiError('AI_SERVICE_UNAVAILABLE', 'Ortak ders kaynakları şu anda hazırlanamadı. Yeniden deneyin.');
    return r.body;
  }
  async materials(user: AuthUser, course: string): Promise<Material[]> {
    await this.access.requireMember(user, course);
    const [docs, videos, files] = await Promise.all([
      this.prisma.document.findMany({ where: { courseId: course, deletedAt: null,
        OR: [{ ownerId: user.id }, { visibility: 'COURSE' }] }, take: 101 }),
      this.prisma.video.findMany({ where: { courseId: course, ownerId: user.id }, take: 101 }),
      this.prisma.studyMaterial.findMany({ where: { courseId: course, ownerId: user.id }, take: 101 }),
    ]);
    let videoStates: Record<string, string> = {};
    if (videos.length) {
      try { videoStates = Object.fromEntries((await this.videos.list(user, course)).videos.map(v => [v.id, v.status === 'indexed' ? 'READY' : v.status])); }
      catch { videoStates = Object.fromEntries(videos.map(v => [v.id, 'UNAVAILABLE'])); }
    }
    const result = [
      ...docs.map(d => ({ id: 'pdf_' + d.id, kind: 'PDF', title: d.title, source_id: d.id,
        status: d.status, version: hash(d.contentSha256 + ':' + d.indexingVersion + ':' + d.updatedAt.toISOString()), row: d })),
      ...videos.map(v => ({ id: 'video_' + v.id, kind: 'VIDEO', title: v.title, source_id: v.id,
        status: videoStates[v.id] || 'UNAVAILABLE', version: hash(v.contentSha256 + ':video-text-v1'), row: v })),
      ...files.map(f => ({ id: 'file_' + f.id, kind: f.kind, title: f.title, source_id: f.id,
        status: 'READY', version: hash(f.sha256 + ':typed-text-v1'), row: f })),
    ];
    if (result.length > 100) throw new ApiError('VALIDATION_ERROR', 'Bu yerel profil ders başına en fazla 100 materyali arar.');
    return result;
  }
  async list(user: AuthUser, course: string) {
    return { materials: (await this.materials(user, course)).map(({ row, ...m }) => ({...m,can_manage:row.ownerId===user.id,filename:row.originalFilename||row.filename,retryable:m.kind==='PDF'?row.status==='FAILED'&&row.errorRetryable:m.kind==='VIDEO'&&m.status==='failed',page_count:m.kind==='PDF'?row.pageCount:m.kind==='PPTX'?Math.max(1,...(row.segments as any[]).map(s=>s.location?.slide||1)):null})) };
  }
  async rename(user:AuthUser,course:string,id:string,title:string){
    const m=(await this.materials(user,course)).find(m=>m.id===id&&m.row.ownerId===user.id);if(!m)throw notFound('Material');
    const data={title:title.trim()};
    if(m.kind==='PDF')await this.prisma.document.update({where:{id:m.source_id},data});
    else if(m.kind==='VIDEO')await this.prisma.video.update({where:{id:m.source_id},data});
    else await this.prisma.studyMaterial.update({where:{id:m.source_id},data});
    return {id,title:data.title};
  }
  private manifest(course: string, materials: Material[]) {
    return { course_id: course, materials: materials.filter(m => m.status === 'READY').map(({ id, version, kind, title }) => ({ id, version, kind, title })) };
  }
  private pieces(text: string, location: any): any[] {
    const out = [];
    for (let i = 0; i < text.length; i += 1650) if (text.slice(i, i + 1800).trim()) {
      out.push({ text: text.slice(i, i + 1800), location: { ...location, char_start: i, char_end: Math.min(i + 1800, text.length) } });
    }
    return out;
  }
  private async segments(user: AuthUser, course: string, m: Material) {
    let segments: any[] = [];
    if (m.kind === 'PDF') {
      const raw = await this.storage.readText(pagesKey(m.source_id, m.row.indexingVersion));
      if (!raw) throw new ApiError('DOCUMENT_NOT_READY', 'PDF sayfa kaydı bulunamadı.');
      const pages = JSON.parse(raw).pages;
      for (const page of pages) segments.push(...this.pieces(page.text, { kind: 'page', page: page.page }));
    } else if (m.kind === 'VIDEO') {
      const t = await this.videos.transcript(user, course, m.source_id);
      for (const c of t.chunks) {
        const start = Math.round(c.start_seconds * 1000), end = Math.round(c.end_seconds * 1000);
        if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start) {
          segments.push(...this.pieces(c.text, { kind: 'video', start_ms: start, end_ms: end }));
        }
      }
    } else segments = m.row.segments;
    if (!Array.isArray(segments) || segments.length > 1000) throw new ApiError('VALIDATION_ERROR', 'Materyal kaynak sınırını aşıyor.');
    return segments.map(s => ({ ...s, id: hash(m.id + m.version + JSON.stringify(s.location) + s.text) }));
  }
  private async sync(user: AuthUser, course: string, materials: Material[]) {
    const manifest = this.manifest(course, materials);
    const state = await this.call('POST', '/state', manifest);
    let updated = 0;
    for (const m of materials.filter(m => m.status === 'READY' && state.versions?.[m.id] !== m.version)) {
      const key = course + ':' + m.id;
      const existing = this.synchronizing.get(key);
      if (existing) { await existing; continue; }
      const action = (async () => {
        const segments = await this.segments(user, course, m);
        // Small index batches are bounded below the internal body limit.
        await this.call('POST', '/index', { course_id: course, material: manifest.materials.find(x => x.id === m.id), segments });
      })();
      this.synchronizing.set(key, action);
      try { await action; updated++; } finally { this.synchronizing.delete(key); }
    }
    return updated;
  }
  async upload(user: AuthUser, course: string, file?: Express.Multer.File) {
    await this.access.requireMember(user, course);
    if (!file || file.size > 2 * 1024 * 1024 || file.size === 0) throw new ApiError('VALIDATION_ERROR', 'En fazla 2 MB PPTX veya UTF-8 metin dosyası seçin.');
    const filename = file.originalname.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);
    const kind = /\.pptx$/i.test(filename) ? 'PPTX' : /\.txt$/i.test(filename) ? 'TXT' : null;
    if (!kind) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Bu alanda PPTX ve TXT destekleniyor.');
    const digest = createHash('sha256').update(file.buffer).digest('hex');
    const extracted = await this.call('POST', '/extract', { kind, content: file.buffer.toString('base64') });
    if (!Array.isArray(extracted.segments) || !extracted.segments.length) throw new ApiError('VALIDATION_ERROR', 'Çıkarılabilir materyal içeriği bulunamadı.');
    const id = newId(), storageKey = `materials/${id}/original.${kind.toLowerCase()}`;
    const temp = await this.storage.createTemp();
    try {
      await new Promise<void>((resolve, reject) => { temp.stream.once('error', reject); temp.stream.end(file.buffer, resolve); });
      await this.storage.move(temp.key, storageKey);
      const material = await this.prisma.studyMaterial.create({ data: { id, courseId: course, ownerId: user.id,
        kind, title: filename, filename, sha256: digest, storageKey, segments: extracted.segments } });
      return { id: 'file_' + material.id, kind, title: filename };
    } catch (e) {
      await this.storage.delete(storageKey);
      if (isUniqueViolation(e)) throw new ApiError('DUPLICATE_DOCUMENT', 'Bu materyali derse zaten ekledin.');
      throw e;
    } finally { await this.storage.delete(temp.key); }
  }
  async remove(user: AuthUser, course: string, id: string) {
    const m = (await this.materials(user, course)).find(m => m.id === id && m.id.startsWith('file_'));
    if (!m) throw notFound('Material');
    await this.call('DELETE', `/${course}/${id}`);
    if (m.row.storageKey) await this.storage.delete(m.row.storageKey);
    await this.prisma.studyMaterial.delete({ where: { id: m.source_id } });
    this.invalidate(id);
    await this.history.redact(id);
    return { deleted: true };
  }
  private invalidate(material: string) {
    for (const [id, value] of this.receipts) if (value.evidence.some(e => e.material_id === material)) this.receipts.delete(id);
  }
  private ensureEvidence(evidence: any[], materials: Material[]) {
    if (!Array.isArray(evidence) || evidence.length > 8) throw new ApiError('INTERNAL_ERROR', 'Kaynak yanıtı doğrulanamadı.');
    for (const e of evidence) {
      const m = materials.find(m => m.id === e.material_id && m.version === e.version && m.status === 'READY');
      const l = e.location;
      if (!m || e.kind !== m.kind || !/^[a-f0-9]{64}$/.test(e.id) || typeof e.text !== 'string' || e.text.length > 2200 || !l ||
        e.id !== hash(m.id + m.version + JSON.stringify(l) + e.text) ||
        (m.kind === 'VIDEO' ? !(Number.isSafeInteger(l.start_ms) && Number.isSafeInteger(l.end_ms) && l.start_ms >= 0 && l.end_ms > l.start_ms) :
        m.kind === 'PDF' ? !(Number.isSafeInteger(l.page) && l.page >= 1 && l.page <= m.row.pageCount) :
        m.kind === 'PPTX' ? !(Number.isSafeInteger(l.slide) && l.slide >= 1 && l.slide <= 300) : l.kind !== 'text')) {
        throw new ApiError('INTERNAL_ERROR', 'Kaynak kapsamı veya konumu doğrulanamadı.');
      }
    }
  }
  async source(user: AuthUser, course: string, materialId: string, segmentId: string) {
    const m = (await this.materials(user, course)).find(m => m.id === materialId && m.status === 'READY');
    if (!m) throw notFound('Material');
    const source = (await this.segments(user, course, m)).find(s => s.id === segmentId);
    if (!source) throw notFound('Source revision');
    return { ...source, material_id: m.id, source_id: m.source_id, kind: m.kind, title: m.title };
  }
  async preview(user: AuthUser, course: string, materialId: string) {
    const m = (await this.materials(user, course)).find(m => m.id === materialId && m.status === 'READY');
    if (!m) throw notFound('Material');
    return { material: { id: m.id, kind: m.kind, title: m.title, source_id: m.source_id }, segments: await this.segments(user, course, m) };
  }
  async visual(user:AuthUser,course:string,id:string,page:number){
    const m=(await this.materials(user,course)).find(x=>x.id===id&&x.status==='READY'&&['PDF','PPTX'].includes(x.kind));
    if(!m?.row.storageKey)throw notFound('Original material');
    const r=await this.call('POST','/render',{course_id:course,material_id:id,version:m.version,storage_key:m.row.storageKey,page});
    if(r.material_id!==id||r.version!==m.version||r.page!==page||!Number.isSafeInteger(r.page_count)||typeof r.image!=='string')throw new ApiError('INTERNAL_ERROR','Sayfa görüntüsü doğrulanamadı.');
    if(!(await this.materials(user,course)).some(x=>x.id===id&&x.version===m.version))throw notFound('Source revision');
    const bytes=Buffer.from(r.image,'base64');if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new ApiError('INTERNAL_ERROR','Geçersiz sayfa görüntüsü.');
    return {bytes,count:r.page_count};
  }
  async file(user: AuthUser, course: string, materialId: string) {
    const m = (await this.materials(user, course)).find(m => m.id === materialId && m.id.startsWith('file_'));
    if (!m?.row.storageKey) throw notFound('Original material');
    return { stream: await this.storage.openRead(m.row.storageKey), filename: m.row.filename,
      mime: m.kind === 'PPTX' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation' : 'text/plain; charset=utf-8' };
  }
  async practice(user: AuthUser, course: string, conversation: string) {
    if (!this.limiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Biraz bekleyin.');
    const receipt = this.receipts.get(conversation);
    if (!receipt || receipt.user !== user.id || receipt.course !== course || receipt.expires < Date.now()) throw notFound('Conversation');
    const selected = receipt.evidence[0];
    if (!selected) throw new ApiError('VALIDATION_ERROR', 'Pratik için gerçek bir kaynak gerekiyor.');
    const actual = await this.source(user, course, selected.material_id, selected.id);
    const words: string[] = String(actual.text).match(/[\p{L}]{6,}/gu) || [];
    const target = [...new Set(words)].sort((a, b) => b.length - a.length)[0];
    if (!target) throw new ApiError('VALIDATION_ERROR', 'Bu kaynak kısa boşluk doldurma pratiğine uygun değil.');
    for (const [id, p] of this.practices) if (p.expires < Date.now()) this.practices.delete(id);
    while (this.practices.size >= 128) this.practices.delete(this.practices.keys().next().value!);
    const id = randomUUID();
    this.practices.set(id, { user: user.id, course, material: selected.material_id, source: selected.id, expected: target, expires: Date.now() + 600000 });
    return { id, kind: 'SOURCE_CLOZE', prompt: 'Kaynakta geçen ifadeyi tamamla: ' + actual.text.split(target).join('_____'),
      source: { material_id: selected.material_id, id: selected.id, title: actual.title, kind: actual.kind, location: actual.location },
      note: 'Basit kaynak hatırlama pratiği; kavramsal öğrenme veya sınav puanı değildir. Sonuç kalıcı kaydedilmez.' };
  }
  async gradePractice(user: AuthUser, course: string, id: string, answer: string) {
    const p = this.practices.get(id);
    if (!p || p.user !== user.id || p.course !== course || p.expires < Date.now()) throw notFound('Practice');
    const source = await this.source(user, course, p.material, p.source);
    const normalize = (s: string) => s.trim().replace(/İ/g, 'i').toLocaleLowerCase('tr').normalize('NFC');
    const matched = normalize(answer) === normalize(p.expected);
    return { outcome: matched ? 'EXACT_MATCH' : 'REVIEW_SOURCE', expected: p.expected,
      feedback: matched ? 'İfade kaynak metniyle eşleşti.' : 'İfade eşleşmedi. Kaynağı açıp ilgili bölümü tekrar incele.',
      source: { material_id: p.material, id: p.source, title: source.title, kind: source.kind, location: source.location },
      mastery_estimated: false, persisted: false };
  }
  async ask(user: AuthUser, course: string, body: any) {
    if (!this.limiter.take(user.id)) throw new ApiError('RATE_LIMITED', 'Biraz bekleyip yeniden deneyin.');
    let materials = await this.materials(user, course);
    for (const [id, r] of this.receipts) if (r.expires < Date.now()) this.receipts.delete(id);
    let question = body.question, prior: Receipt | undefined;
    const thread = !body.retrieve_only ? await this.history.thread(user.id,course,body.chat_id,body.question) : null;
    if (body.chat_id && !this.receipts.has(body.conversation_id)) {
      const saved = await this.history.last(user.id,course,body.chat_id);
      const p = saved?.payload as any;
      if (p?.evidence?.length) {
        // MySQL normalizes JSON key order. Rehydrate authoritative source locations
        // instead of re-hashing a JSON payload that may have a different key order.
        const restored=[];
        for(const e of p.evidence){
          const m=materials.find(m=>m.id===e.material_id&&m.version===e.version&&m.status==='READY');
          if(!m)throw new ApiError('NOT_RETRYABLE','Konuşmanın kaynağı değişmiş. Yeni konuşma başlatın.');
          const actual=(await this.segments(user,course,m)).find(s=>s.id===e.id);
          if(!actual)throw notFound('Source revision');
          restored.push({...e,...actual,material_id:m.id,kind:m.kind,version:m.version});
        }
        const restoredId=randomUUID();
        this.receipts.set(restoredId,{user:user.id,course,question:p.question,resolved:p.resolved_question||p.question,answer:p.answer,evidence:restored,relations:p.associations||[],conflicts:p.conflicts||[],expires:Date.now()+600000});
        body={...body,conversation_id:restoredId};
      }
    }
    if (body.conversation_id) {
      prior = this.receipts.get(body.conversation_id);
      if (!prior || prior.user !== user.id || prior.course !== course) throw notFound('Conversation');
      if (prior.evidence.some(e => !materials.some(m => m.id === e.material_id && m.version === e.version && m.status === 'READY'))) {
        throw new ApiError('NOT_RETRYABLE', 'Konuşmadaki kaynak değişmiş. Yeni konuşma başlatıp soruyu yeniden gönder.');
      }
      this.ensureEvidence(prior.evidence, materials);
      const normalized = question.replace(/İ/g, 'i').replace(/ı/g, 'i').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      if (/\b(onceki|ikinci|birinci|bunu|bunun|bu konu\w*|bu adim\w*|ornek\w*|goster|devam|basit|adim|ayrinti|previous|second)\b/.test(normalized)) {
        question = (prior.resolved.slice(0, 900) + '\nTakip sorusu: ' + question).slice(-2000);
      }
    }
    let evidence: any[], relations: any[] = [], conflicts: any[] = [], indexed = 0;
    if (body.explain_now) {
      if (!prior || prior.question !== body.question) throw new ApiError('NOT_RETRYABLE', 'Soruyu yeniden gönderin.');
      evidence = prior.evidence;
      relations = prior.relations; conflicts = prior.conflicts;
    } else {
      indexed = await this.sync(user, course, materials);
      const found = await this.call('POST', '/search', { ...this.manifest(course, materials), question,
        active_material_id: body.active_material_id, current_time_ms: body.current_time_ms,
        active_source_id:body.active_source_id,
        strategy: body.strategy || 'aligned' });
      evidence = found.evidence; relations = found.associations || []; conflicts = found.conflicts || [];
    }
    const allowedSources = new Set((Array.isArray(evidence) ? evidence : []).map(e => e.id));
    const validPair = (ids: any) => Array.isArray(ids) && ids.length === 2 && ids.every(id => typeof id === 'string' && allowedSources.has(id));
    if (!Array.isArray(relations) || relations.length > 10 || relations.some(r => r.kind !== 'RELATED_TOPIC' || !validPair(r.source_ids)) ||
      !Array.isArray(conflicts) || conflicts.length > 6 || conflicts.some(c => c.kind !== 'POSSIBLE_CONFLICT' || !validPair(c.sources))) {
      throw new ApiError('INTERNAL_ERROR', 'Materyal ilişkisi kaynak kapsamı dışında.');
    }
    // Only bounded provenance is exposed. Arbitrary upstream fields/terms must
    // not bypass the evidence scope checks through an association payload.
    relations = relations.map(r => ({ kind: 'RELATED_TOPIC', source_ids: r.source_ids, estimated: true }));
    conflicts = conflicts.map(c => ({ kind: 'POSSIBLE_CONFLICT', sources: c.sources, confirmed: false,
      message: 'Benzer kaynak ifadelerinde farklı olumsuzlama var; özgün materyalleri karşılaştırın.' }));
    // Source records/visibility may change while extraction/retrieval is running.
    materials = await this.materials(user, course);
    this.ensureEvidence(evidence, materials);
    const progress = await this.prisma.videoProgress.findMany({ where: { userId: user.id,
      videoId: { in: materials.filter(m => evidence.some(e => e.material_id === m.id) && m.kind === 'VIDEO').map(m => m.source_id) } } });
    const learning = evidence.filter(e => e.kind === 'VIDEO').map(e => {
      const m = materials.find(m => m.id === e.material_id)!;
      return { source_id: e.id, material_id: m.id, ...classifyLearning(e.location, progress.find(p => p.videoId === m.source_id)?.intervals) };
    });
    const onlyVideo = evidence.length > 0 && evidence.every(e => e.kind === 'VIDEO');
    const guidance = onlyVideo && !body.explain_now && learning.some(l => l.state !== 'WATCHED');
    const generated = body.retrieve_only ? { answer: '', status: 'EVIDENCE_ONLY', llm_used: false }
      : guidance ? { answer: 'İlgili video bölümünün tamamı izleme kaydında görünmüyor. Kaynağa geçebilir veya şimdi açıklama isteyebilirsin.', status: 'GUIDANCE', llm_used: false }
      : await this.call('POST', '/explain', { question, evidence, conversation_context: prior?.answer.slice(0, 3000) || '' });
    // Re-check immediately before returning model text as well.
    this.ensureEvidence(evidence, await this.materials(user, course));
    const receipt = randomUUID();
    while (this.receipts.size >= 128) this.receipts.delete(this.receipts.keys().next().value!);
    this.receipts.set(receipt, { user: user.id, course, question: body.question, resolved: question,
      evidence, relations, conflicts, answer: String(generated.answer || '').slice(0, 3000), expires: Date.now() + 600000 });
    const result = { ...generated, question: body.question, resolved_question: question, conversation_id: receipt,chat_id:thread?.id || null,
      evidence: evidence.map((e, i) => ({ ...e, title:materials.find(m => m.id===e.material_id)!.title,n: i + 1, source_id: materials.find(m => m.id === e.material_id)!.source_id })),
      video_learning: learning, associations: relations, conflicts, indexed_materials: indexed,
      retrieval:{course_id:course,searched:materials.filter(m=>m.status==='READY').map(m=>({id:m.id,kind:m.kind,title:m.title})),found_source_ids:evidence.map(e=>e.id),
        used_source_ids:Array.isArray(generated.claims)?[...new Set(generated.claims.flatMap((c:any)=>c.sources).map((n:number)=>evidence[n-1]?.id).filter(Boolean))]:[],mode:generated.status},
      support_confirmed: false, note: 'Kaynaklar otomatik çıkarılmış olabilir. Alıntı, açıklamanın doğruluğunu kanıtlamaz. İzleme konu hâkimiyeti değildir.' };
    if(thread) await this.history.save(user.id,course,thread.id,body.explain_now?'Şimdi açıkla: '+body.question:body.question,result);
    return result;
  }
}
