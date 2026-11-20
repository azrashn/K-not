import json

from knot_rag import self_check_glossary as g
from knot_rag.self_check_translate import dictionary_translate

TEXTS = [
    "Ağ geçidi (gateway) iki ağı birbirine bağlar. Çerçeve (frame) başlık ve yükten oluşur.",
    "The frame (çerçeve) is the unit of the link layer. Hub and gateway forward frames.",
    "Köprü köprü köprü bridge bridge bridge gateway gateway.",
]


def test_pairs_written_in_the_material_and_frequent_terms(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    assert g.update_material("c1", "pdf_a", "v" * 64, TEXTS)
    pairs = g.course_pairs("c1")
    assert ("Ağ geçidi", "gateway") in pairs and ("çerçeve", "frame") in [(a.lower(), b) for a, b in pairs]
    assert "gateway" in g.top_terms(TEXTS)
    # the course glossary reaches the dictionary: a course term the built-in list does not know
    assert "gateway" in dictionary_translate("Ağ geçidi iki ağı bağlar", "en", pairs)


def test_update_replaces_and_remove_forgets_one_material_only(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    g.update_material("c1", "pdf_a", "a" * 64, ["Düğüm (node) ağdaki bir noktadır, düğüm düğüm."])
    g.update_material("c1", "pdf_b", "b" * 64, ["Kenar (edge) iki düğümü bağlar."])
    assert {p[1] for p in g.course_pairs("c1")} == {"node", "edge"}
    g.update_material("c1", "pdf_a", "c" * 64, ["Yaprak (leaf) en alttaki düğümdür."])  # new version
    assert {p[1] for p in g.course_pairs("c1")} == {"leaf", "edge"}
    g.remove_material("c1", "pdf_b")
    assert {p[1] for p in g.course_pairs("c1")} == {"leaf"}
    assert g.course_pairs("c1", ["pdf_zzz"]) == []  # only the selected materials count
    assert g.course_pairs("other-course") == []  # another course never sees it


def test_without_storage_nothing_is_written_and_nothing_breaks(monkeypatch):
    monkeypatch.delenv("STORAGE_ROOT", raising=False)
    assert g.update_material("c1", "pdf_a", "a" * 64, TEXTS) is False
    assert g.course_pairs("c1") == []
    assert g.update_material("../x", "pdf_a", "a" * 64, TEXTS) is False


def test_model_fills_terms_once_and_drops_entries_that_do_not_contain_the_term(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    g.update_material("c1", "pdf_a", "a" * 64, ["düğüm düğüm kenar kenar yaprak yaprak"])
    calls = []

    def complete(request):
        calls.append(1)
        words = json.loads(request.user.split(chr(10), 1)[1])
        table = {"düğüm": ("düğüm", "node"), "kenar": ("kenar", "edge"), "yaprak": ("yaprak", "leaf")}
        items = [{"term": w, "tr": table[w][0], "en": table[w][1]} for w in words]
        items[-1] = {"term": words[-1], "tr": "alakasız", "en": "unrelated"}  # does not contain the term: dropped
        return json.dumps({"items": items})

    assert g.fill("c1", "pdf_a", complete) == 2
    assert len(g.course_pairs("c1")) == 2 and not any("unrelated" in p for p in g.course_pairs("c1"))
    assert g.fill("c1", "pdf_a", complete) == 0 and len(calls) == 1  # once per material version
