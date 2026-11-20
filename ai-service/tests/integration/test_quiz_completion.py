import json,time
import pytest
from knot_rag.quiz_completion import completion_plan,source_feedback,validate_completion_options,review_completion_options
from knot_rag.generation.providers.base import LLMResponse

class Provider:
    def __init__(self,choose=None): self.choose=choose;self.request=None
    def complete(self,request):
        self.request=request
        words=json.loads(request.user)['words']
        chosen=self.choose or next(w['word_id'] for w in words if w['text']=='queue')
        return LLMResponse(text=json.dumps({'word_id':chosen}))

def test_completion_is_an_exact_gap_in_the_real_fact_and_selects_no_invented_word():
    fact='BFS uses a queue for pending nodes.'
    result=completion_plan(Provider(),{'focus_text':fact},'BFS',time.monotonic()+30,'English')
    assert result['question'].endswith('BFS uses a _____ for pending nodes.')
    assert result['answer']=='queue' and result['letter'] in 'ABCD'

def test_unknown_term_id_is_rejected():
    with pytest.raises(ValueError,match='selection'):
        completion_plan(Provider('invented'),{'focus_text':'BFS uses a queue.'},'BFS',time.monotonic()+30,'English')

def test_source_reference_never_displays_the_models_false_rationale():
    draft={'question':'BFS uses _____.','options':['queue','stack'],'expected':'0',
           'quote':'BFS uses a queue.','explanation':'BFS uses a stack.',
           'option_feedback':['Wrong fact.','Another wrong fact.']}
    result=source_feedback(draft,'English')
    assert result['explanation']==draft['quote']
    assert all('“queue”' in reason for reason in result['option_feedback'])
    assert 'stack' not in result['explanation']

@pytest.mark.parametrize('options',[
    ['sin(x*x)','NOT','INTEGRAL','CALISMA'],
    ['sunlight','shows','diagram','leaf'],
])
def test_source_headers_and_grammatical_words_are_not_published_as_distractors(options):
    with pytest.raises(ValueError):
        validate_completion_options({'options':options},{'answer':options[0],'proof':{'source_text':'Result = sin(x*x) + C.'}})

def test_model_rejection_of_distractor_category_is_honored():
    class Reject:
        def complete(self,request):return LLMResponse(text='{"valid":false,"reason":"Unrelated terms"}')
    with pytest.raises(ValueError,match='distractor review rejected'):
        review_completion_options(Reject(),{'question':'BFS uses _____.','options':['queue','tree','graph','leaf']},
                                  {'answer':'queue','proof':{'source_text':'BFS uses queue.'}},time.monotonic()+30)
