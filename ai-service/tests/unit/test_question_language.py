import pytest

from knot_rag.explanations import language_rule, question_language


@pytest.mark.parametrize("q", [
    "burayı türkçe açıklar mısın?",
    "Bu bölümü adım adım açıkla",
    "transport layer nedir",
    "burayi turkce acikla",
    "Bu bir örnek göster",
    "explain this in Türkçe",
])
def test_turkish_questions_are_answered_in_turkish(q):
    assert question_language(q) == "tr"


@pytest.mark.parametrize("q", [
    "What does the transport layer do?",
    "Explain TCP congestion control",
    "explain this in English please",
    "",
])
def test_english_or_unknown_questions_stay_english(q):
    assert question_language(q) == "en"


def test_turkish_rule_forbids_falling_back_to_english():
    assert "TURKISH" in language_rule("tr") and "Never switch back" in language_rule("tr")
    assert "TURKISH" not in language_rule("en")


@pytest.mark.parametrize("q", [
    "AIMD ne ise yarar",
    "UDP ile TCP arasindaki fark",
    "tcp yavas baslangic nedir",
    "hangi katman hata denetimi yapar",
    "TCP baglantisizdir sence dogru mu",
])
def test_short_turkish_typed_without_turkish_letters(q):
    assert question_language(q) == "tr"


@pytest.mark.parametrize("q", ["TCP slow start", "UDP vs TCP", "What is the difference between TCP and UDP", "router handler controller"])
def test_english_with_turkish_looking_endings_stays_english(q):
    assert question_language(q) == "en"


def test_an_unclear_text_takes_the_language_of_the_conversation():
    assert question_language("TCP slow start", context="TCP yavaş başlangıç, bağlantı hızını artırır.") == "tr"
    assert question_language("TCP slow start", context="TCP slow start doubles the window.") == "en"
    assert question_language("TCP slow start") == "en"


def test_an_answer_in_the_wrong_language_is_translated_and_keeps_its_sources():
    import json

    from knot_rag.explanations import ensure_answer_language

    claims = [{"text": "AIMD increases the sending rate by 1 MSS every RTT and halves it on loss.", "sources": [1]},
              {"text": "AIMD, kayıpta hızı yarıya indirir.", "sources": [2]},
              {"text": "Short one.", "sources": [1]}]

    def complete(request):
        texts = json.loads(request.user.split(chr(10), 1)[1])
        assert texts == ["AIMD increases the sending rate by 1 MSS every RTT and halves it on loss."]  # only the wrong one
        return json.dumps({"translations": ["AIMD, gönderim hızını her RTT'de 1 MSS artırır ve kayıpta yarıya indirir."]})

    out = ensure_answer_language(claims, "tr", complete)
    assert out[0]["text"].startswith("AIMD, gönderim hızını") and out[0]["sources"] == [1]
    assert out[1] == claims[1] and out[2] == claims[2]


def test_a_translation_that_changes_a_number_is_refused():
    import json

    from knot_rag.explanations import ensure_answer_language

    claims = [{"text": "TCP slow start begins with cwnd equal to 1 MSS and doubles every RTT.", "sources": [1]}]
    bad = lambda request: json.dumps({"translations": ["TCP yavaş başlangıç cwnd değerini 10 MSS ile başlatır ve her RTT'de ikiye katlar."]})
    assert ensure_answer_language(claims, "tr", bad) == claims  # the original stays
    good = lambda request: json.dumps({"translations": ["TCP yavaş başlangıç cwnd değerini 1 MSS ile başlatır ve her RTT'de ikiye katlar."]})
    assert ensure_answer_language(claims, "tr", good)[0]["text"].startswith("TCP yavaş başlangıç")


def test_nothing_is_called_when_the_language_already_matches():
    from knot_rag.explanations import ensure_answer_language

    claims = [{"text": "TCP bağlantı kurulumunda istemci SYN gönderir ve sunucu SYNACK ile yanıt verir.", "sources": [1]}]

    def never(request):
        raise AssertionError("the model must not be asked")

    assert ensure_answer_language(claims, "tr", never) == claims
