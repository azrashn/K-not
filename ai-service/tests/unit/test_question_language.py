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
