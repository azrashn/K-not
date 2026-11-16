import {validSourceCompletion} from '../../src/learning/quiz-validation';
const text='BFS uses a queue for pending nodes.';
function item(){return {kind:'MULTIPLE_CHOICE',question_style:'SOURCE_COMPLETION',
 quality:{option_audit_version:3,deterministic_source_validation:true,independent_model_review:false},
 source_index:1,quote:text,expected:'0',options:['queue','stack','heap','tree'],
 question:'Complete with the term used in the source:\nBFS uses a _____ for pending nodes.',
 completion_proof:{source_text:text,answer_start:11,answer_end:16,prefix:'Complete with the term used in the source:'}};}
test('source recall is checked against actual source without pretending a model review passed',()=>{
 expect(validSourceCompletion(item(),[{text}])).toBe(true);
});
test.each([
 {expected:'1'},{source_index:2},{quote:'An invented source.'},
 {options:['queue','QUEUE','heap','tree']},{question:'Invented question?'},
 {completion_proof:{source_text:text,answer_start:-1,answer_end:16,prefix:'Complete with the term used in the source:'}},
 {completion_proof:{source_text:text,answer_start:11,answer_end:16,prefix:'The answer is queue'}},
])('tampered source recall proof is rejected: %j',change=>{
 expect(validSourceCompletion({...item(),...change},[{text}])).toBe(false);
});
test('question offsets retain Python Unicode code point meaning',()=>{
 const source='🌱 uses a queue.';
 const q={...item(),quote:source,question:'Complete with the term used in the source:\n🌱 uses a _____.',
  completion_proof:{source_text:source,answer_start:9,answer_end:14,prefix:'Complete with the term used in the source:'}};
 expect(validSourceCompletion(q,[{text:source}])).toBe(true);
});
