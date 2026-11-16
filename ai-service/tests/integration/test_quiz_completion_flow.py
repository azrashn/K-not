import json
from knot_rag.quiz_quality import quiz
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.generation.providers.base import LLMResponse
from knot_rag.unified import QuizDraft

def test_rejected_conceptual_draft_can_become_a_verified_source_recall_question(monkeypatch):
    monkeypatch.setenv('QUIZ_LLM_BASE_URL','http://127.0.0.1:11436/v1')
    monkeypatch.setenv('QUIZ_LLM_MODEL','test-double')
    text='A queue removes the earliest added item. A stack removes the latest added item.'
    seen=[]
    def complete(self,request):
        seen.append(request);body=json.loads(request.user)
        if request.system.startswith('Plan one'):
            payload={'topic_supported':True,'fact_id':body['facts'][0]['fact_id'],'objective':'Understand removal ordering.'}
        elif request.system.startswith('Select ONE'):
            payload={'word_id':next(w['word_id'] for w in body['words'] if w['text']=='stack')}
        elif request.system.startswith('Audit distractors'):
            payload={'valid':True,'reason':'Explicit test double; not a real quality review.'}
        elif request.system.startswith('Create THREE'):
            payload={'distractors':['queue','tree','set']}
        else:
            comp=body.get('source_completion')
            options={key:'queue' for key in 'ABCD'};letter='A'
            question='Which structure removes an item first?'
            if comp:
                letter=comp['letter'];question=comp['question']
                alternatives=iter(['queue','earliest','latest'])
                options={key:comp['answer'] if key==letter else next(alternatives) for key in 'ABCD'}
            payload={'quote_id':'q1','question':question,'objective':'Understand removal ordering.',
                     'options':options,'expected':letter,'explanation':'A draft explanation, never trusted as source proof.',
                     'option_feedback':{key:'Draft feedback for this option.' for key in 'ABCD'}}
        return LLMResponse(text=json.dumps(payload))
    monkeypatch.setattr(OpenAICompatibleProvider,'complete',complete)
    result=quiz(QuizDraft(question='Stack removal ordering',kind='MULTIPLE_CHOICE',language='en',evidence=[{'text':text}]))
    assert result['question_style']=='SOURCE_COMPLETION'
    assert result['quality']['deterministic_source_validation'] is True
    assert result['quality']['independent_model_review'] is False
    assert result['quote']==text and result['explanation']==text
    assert result['options'][int(result['expected'])]=='stack'
    assert len(seen)==6
