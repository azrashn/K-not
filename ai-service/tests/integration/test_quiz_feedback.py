import json
import time
import pytest
from knot_rag.quiz_feedback import review_feedback
from knot_rag.generation.providers.base import LLMResponse

SOURCE='BFS visits nodes layer by layer and uses a queue.'
DRAFT=dict(question='How does BFS visit nodes?',options=['In layers','In depth'],expected='0',
           quote=SOURCE,explanation='A draft explanation with an error.',option_feedback=['Draft correct reason.','Draft wrong reason.'])

class Provider:
    def __init__(self,response): self.response=response; self.requests=[]
    def complete(self,request):
        self.requests.append(request)
        return LLMResponse(text=json.dumps(self.response))

def valid():
    return dict(valid=True,single_correct=True,explanation='BFS visits nodes by increasing distance from its start.',
                option_feedback=['BFS visits nodes layer by layer.','Depth-first ordering is not BFS ordering.'])

def test_feedback_replaces_bad_draft_without_changing_the_solved_question():
    provider=Provider(valid())
    result=review_feedback(provider,DRAFT,'MULTIPLE_CHOICE',time.monotonic()+30,'English')
    assert result['question']==DRAFT['question'] and result['expected']=='0'
    assert result['explanation']==valid()['explanation']
    assert result['option_feedback']==valid()['option_feedback']
    assert json.loads(provider.requests[0].user)['source']==SOURCE

@pytest.mark.parametrize('change',[
    {'valid':False},{'single_correct':False},{'option_feedback':[]},{'option_feedback':['Valid feedback.']},
    {'explanation':'short'},{'option_feedback':['Valid feedback.',None]},
])
def test_invalid_or_incomplete_feedback_is_never_published(change):
    with pytest.raises(ValueError,match='feedback'):
        review_feedback(Provider({**valid(),**change}),DRAFT,'MULTIPLE_CHOICE',time.monotonic()+30,'English')

def test_feedback_budget_cannot_be_bypassed():
    provider=Provider(valid())
    with pytest.raises(ValueError,match='time'):
        review_feedback(provider,DRAFT,'MULTIPLE_CHOICE',time.monotonic(),'English')
    assert provider.requests==[]
