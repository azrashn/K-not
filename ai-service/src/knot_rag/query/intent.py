"""Question intent: is the input a question about course material at all?

Deterministic and deliberately narrow. An input is NON-ACADEMIC only when EVERY word belongs to
a closed list of greetings, courtesy phrases and acknowledgements (Turkish and English), e.g.
"Merhaba", "selam!", "teşekkürler", "hi there", "ok". Anything with a single other word
("Merhaba, AVL ağacı nedir?") stays ACADEMIC and goes through retrieval as before, so this can
never suppress a real question; it only stops keyword-matching a greeting against a document
("Merhaba" → "Merhaba, bu bir test pdf'idir." rated SIKI).
"""

from __future__ import annotations

import re
from enum import Enum

from knot_rag.text import fold, normalize_text


class Intent(str, Enum):
    ACADEMIC = "academic"
    GREETING = "greeting"
    THANKS = "thanks"
    ACKNOWLEDGEMENT = "acknowledgement"


_LEXICON: dict[Intent, str] = {
    Intent.GREETING: """
        merhaba merhabalar mrb meraba selam selamlar slm sa selamünaleyküm selamun aleyküm
        günaydın iyi günler akşamlar geceler sabahlar hayırlı kolay gelsin hoş geldin geldiniz
        nasılsın nasılsınız naber ne haber napıyorsun hey heyy hi hii hello hola yo
        good morning evening afternoon day how are you doing
        görüşürüz hoşça kal kalın bye goodbye see later
        hocam dostum arkadaşlar there all everyone
    """,
    Intent.THANKS: """
        teşekkürler teşekkür ederim ederiz tşk tşkler tesekkurler sağol sağ ol olun sağolun
        eyvallah thanks thank thx ty
    """,
    Intent.ACKNOWLEDGEMENT: """
        tamam tamamdır peki olur anladım anlaşıldı evet hayır yok okey ok okay oke k kk
        yes no sure fine got it cool nice great süper harika güzel
    """,
}
# Words allowed inside such phrases that do not decide the intent on their own.
_FILLER = "çok you so much a lot many very ve and"
_WORDS = {intent: frozenset(fold(w) for w in text.split()) for intent, text in _LEXICON.items()}
_ALL = frozenset().union(*_WORDS.values(), (fold(w) for w in _FILLER.split()))
_TOKEN = re.compile(r"\w+", re.UNICODE)
MAX_WORDS = 6

MESSAGES = {
    Intent.GREETING: "Merhaba! K-not yalnızca bu dersteki materyallere dayanarak yanıt verir. "
                     "Materyallerinle ilgili bir soru sorabilirsin.",
    Intent.THANKS: "Rica ederim. Materyallerinle ilgili başka bir sorun varsa sorabilirsin.",
    Intent.ACKNOWLEDGEMENT: "Materyallerinle ilgili bir soru yazarsan kaynaklara dayanarak yanıtlayayım.",
}


def classify(question: str) -> Intent:
    tokens = [fold(t) for t in _TOKEN.findall(normalize_text(question))]
    if not tokens or len(tokens) > MAX_WORDS or any(t not in _ALL for t in tokens):
        return Intent.ACADEMIC
    for intent in (Intent.THANKS, Intent.GREETING, Intent.ACKNOWLEDGEMENT):
        if any(t in _WORDS[intent] for t in tokens):
            return intent
    return Intent.ACADEMIC
