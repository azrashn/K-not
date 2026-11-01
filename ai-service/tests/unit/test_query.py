import pytest

from knot_rag.errors import RequestValidationFailed
from knot_rag.query import QueryProcessor


@pytest.mark.parametrize("q", ["", "   ", "\n\t", "???", "​​"])
def test_rejects_empty_or_wordless(q):
    with pytest.raises(RequestValidationFailed):
        QueryProcessor().prepare(q)


def test_preserves_original_and_turkish_characters():
    p = QueryProcessor().prepare("  AVL ağacında   LR rotasyonu ne zaman uygulanır? ")
    assert p.original == "  AVL ağacında   LR rotasyonu ne zaman uygulanır? "
    assert p.normalized == "AVL ağacında LR rotasyonu ne zaman uygulanır?"
    assert p.retrieval_query == p.normalized


def test_rejects_too_long_question():
    with pytest.raises(RequestValidationFailed):
        QueryProcessor(max_chars=50).prepare("AVL " * 30)


def test_optional_rewriter_does_not_replace_original():
    class Expand:
        def rewrite(self, q):
            return q.replace("BST", "BST ikili arama ağacı")

    p = QueryProcessor(rewriter=Expand()).prepare("BST nedir?")
    assert p.retrieval_query == "BST ikili arama ağacı nedir?"
    assert p.normalized == "BST nedir?"


def test_mixed_language_question_is_accepted():
    p = QueryProcessor().prepare("AVL tree'de rotation ne zaman yapılır?")
    assert "rotation" in p.retrieval_query
