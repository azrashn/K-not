import json

from knot_rag.self_check_translate import dictionary_translate, language_of, model_translate, translation_is_faithful


def test_language_and_dictionary_both_directions():
    assert language_of("TCP bağlantı kurulumu üç yollu el sıkışma ile yapılır.") == "tr"
    assert language_of("TCP uses a three-way handshake.") == "en"
    en = dictionary_translate("TCP bağlantısız değildir, güvenilir bir protokoldür", "en")
    assert "connectionless" in en and "reliable" in en and "protocol" in en
    assert "baglantisiz" not in en
    tr = dictionary_translate("TCP is a reliable connection-oriented protocol", "tr")
    assert "güvenilir" in tr and "protokol" in tr
    # nothing to translate: None, never an empty comparison
    assert dictionary_translate("xyzzy plugh", "en") is None


def test_unknown_words_are_kept_so_they_can_only_lower_a_match():
    out = dictionary_translate("TCP rastgele şifreleme yapar", "en")
    assert "rastgele" in out and "encryption" in out


def test_translation_must_keep_numbers_acronyms_and_polarity():
    assert translation_is_faithful("TCP 10 MSS ile başlar", "TCP starts with 10 MSS")
    assert not translation_is_faithful("TCP 10 MSS ile başlar", "TCP starts with 1 MSS")
    assert not translation_is_faithful("TCP 10 MSS ile başlar", "starts with 10 MSS")
    assert not translation_is_faithful("UDP bağlantısız değildir", "UDP is connectionless")
    assert translation_is_faithful("UDP bağlantısız değildir", "UDP is not connectionless")
    assert not translation_is_faithful("aynı metin", "aynı metin")


def test_model_translate_with_injected_model_drops_unfaithful_items():
    texts = ["TCP 10 MSS ile başlar", "UDP bağlantısız değildir"]

    def complete(request):
        assert request.json_mode and request.response_schema
        return json.dumps({"translations": ["TCP starts with 10 MSS", "UDP is connectionless"]})

    assert model_translate(texts, "en", complete) == ["TCP starts with 10 MSS", None]
    assert model_translate(texts, "en", lambda r: "not json") == [None, None]
    assert model_translate(texts, "en", lambda r: json.dumps({"translations": ["x"]})) == [None, None]
