/** Recheck exact source-recall proof independently of the AI's boolean flags. */
export function validSourceCompletion(q: any, sources: any[]): boolean {
  const p=q?.completion_proof, options=q?.options;
  if(q?.kind!=='MULTIPLE_CHOICE'||q.question_style!=='SOURCE_COMPLETION'||
     q.quality?.option_audit_version!==3||q.quality?.deterministic_source_validation!==true||
     !Array.isArray(options)||options.length!==4||options.some((o:any)=>typeof o!=='string'||!o.trim())||
     new Set(options.map((o:string)=>o.trim().toLocaleLowerCase('tr'))).size!==4||
     !/^[0-3]$/.test(q.expected)||!Number.isInteger(q.source_index)||!sources[q.source_index-1]||
     typeof q.quote!=='string'||!sources[q.source_index-1].text.includes(q.quote)||
     !p||typeof p.source_text!=='string'||!q.quote.includes(p.source_text)||
     !Number.isInteger(p.answer_start)||!Number.isInteger(p.answer_end)||
     p.answer_start<0||p.answer_end<=p.answer_start||p.answer_end>p.source_text.length||
     !['Kaynakta kullanılan kavramla tamamla:','Complete with the term used in the source:'].includes(p.prefix))return false;
  // Python character offsets count Unicode code points, not UTF-16 units.
  const chars=Array.from(p.source_text) as string[];
  const target=chars.slice(p.answer_start,p.answer_end).join('');
  const question=p.prefix+'\n'+chars.slice(0,p.answer_start).join('')+'_____'+chars.slice(p.answer_end).join('');
  return q.question===question&&options[Number(q.expected)]===target&&
         options.filter((o:string)=>o===target).length===1;
}
