from knot_rag.text import content_tokens, estimate_tokens, find_folded, fold, normalize_text, numbers


def test_normalize_preserves_turkish_and_strips_control_chars():
    assert normalize_text("  AVL​ ağacında\x00   İĞÜŞÖÇ ı  ") == "AVL ağacında İĞÜŞÖÇ ı"


def test_fold_is_turkish_aware():
    assert fold("İSTANBUL") == fold("istanbul")
    assert fold("IŞIK") == fold("ışık")
    assert fold("AĞACI") == "agaci".replace("g", "ğ")


def test_content_tokens_keep_technical_identifiers():
    toks = content_tokens("LL, RR, LR ve RL rotasyonları; AVL ile BST farkı O(log n)")
    for t in ["ll", "rr", "lr", "rl", "avl", "bst", "log"]:
        assert t in toks
    assert "ve" not in toks and "ile" not in toks


def test_numbers():
    assert numbers("fark en fazla 1, bf = 2 ve 2,5") == {"1", "2", "2.5"}


def test_find_folded_returns_original_offsets():
    hay = "Denge koşulu  bozulduğunda (fark ≥ 2) ağaç ROTASYON işlemleriyle dengelenir."
    span = find_folded(hay, "ağaç rotasyon")
    assert span is not None
    assert hay[span[0]:span[1]] == "ağaç ROTASYON"
    assert find_folded(hay, "koşulu bozulduğunda") is not None  # whitespace-insensitive
    assert find_folded(hay, "ağaç kırmızı") is None
    assert find_folded(hay, "") is None


def test_estimate_tokens_is_monotonic():
    assert estimate_tokens("a" * 30, 3.0) == 10
    assert estimate_tokens("", 3.0) == 1
