"""Turkish <-> English for the self-check comparison.

Two ways, both only used to COMPARE; what the student wrote is never replaced on screen:
* `dictionary_translate`: a glossary of course terms (networks, data structures, algorithms, OS). Words
  the glossary does not know are kept as they are, so they stay "missing" and can only lower a match.
* `model_translate`: the local model (UNIFIED_LLM_*), asked for a literal translation of a batch of
  sentences. A translation is accepted only when it keeps the numbers, the acronyms and the polarity
  (negation) of the original, so a bad translation can not create or remove a contradiction.
"""

from __future__ import annotations

import json
import os
import re

import httpx

from knot_rag.claim_check import _is_turkish
from knot_rag.generation.providers.base import LLMRequest, ProviderError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.generation.providers.policy import is_local_endpoint
from knot_rag.structured import array, obj, string
from knot_rag.text import has_negation, numbers

# (Turkish stem, English term). The Turkish side is matched as a word prefix (suffixes are free).
GLOSSARY: list[tuple[str, str]] = [
    ("bağlantısız", "connectionless"), ("bağlantı odaklı", "connection-oriented"), ("bağlantı", "connection"),
    ("el sıkışma", "handshake"), ("üç yollu", "three-way"), ("güvenilir", "reliable"), ("güvenilmez", "unreliable"),
    ("yeniden iletim", "retransmission"), ("yeniden gönder", "retransmit"), ("hızlı yeniden iletim", "fast retransmit"),
    ("tekrarlı", "duplicate"), ("onay", "acknowledgment"), ("olumsuz onay", "negative acknowledgment"),
    ("taşıma katman", "transport layer"), ("ağ katman", "network layer"), ("uygulama katman", "application layer"),
    ("veri bağı katman", "link layer"), ("fiziksel katman", "physical layer"), ("katman", "layer"),
    ("protokol", "protocol"), ("segment", "segment"), ("paket", "packet"), ("veri birimi", "datagram"),
    ("çerçeve", "frame"), ("başlık", "header"), ("yük", "payload"), ("adres", "address"), ("yönlendirici", "router"),
    ("yönlendirme", "routing"), ("anahtar", "key"), ("sunucu", "server"), ("istemci", "client"), ("ana bilgisayar", "host"),
    ("soket", "socket"), ("port numaras", "port number"), ("kapı numaras", "port number"), ("gönder", "send"),
    ("alıcı", "receiver"), ("gönderici", "sender"), ("alır", "receive"), ("yanıt", "response"), ("istek", "request"),
    ("kuyruk", "queue"), ("tampon", "buffer"), ("pencere", "window"), ("tıkanıklık denetim", "congestion control"),
    ("tıkanıklık", "congestion"), ("akış denetim", "flow control"), ("denetim", "control"), ("kontrol", "control"),
    ("hata denetim", "error control"), ("sağlama toplam", "checksum"), ("sıra numaras", "sequence number"),
    ("zaman aşımı", "timeout"), ("gecikme", "delay"), ("bant genişliği", "bandwidth"), ("çıktı", "throughput"),
    ("yavaş başlangıç", "slow start"), ("yavaş başla", "slow start"), ("katlanarak", "exponentially"),
    ("ikiye kat", "double"), ("yarıya", "half"), ("artış", "increase"), ("artır", "increase"), ("azalt", "decrease"),
    ("kayıp", "loss"), ("olay", "event"), ("çoklama", "multiplexing"), ("çözme", "demultiplexing"),
    ("şifrele", "encrypt"), ("şifreleme", "encryption"), ("doğrula", "verify"), ("kimlik doğrulama", "authentication"),
    ("karma işlev", "hash function"), ("özet işlev", "hash function"), ("karma tablo", "hash table"),
    ("hash fonksiyon", "hash function"), ("hash tablo", "hash table"), ("çakışma", "collision"),
    ("mükemmel", "perfect"), ("dizi", "array"), ("liste", "list"), ("bağlı liste", "linked list"), ("yığın", "stack"),
    ("ağaç", "tree"), ("ikili arama ağacı", "binary search tree"), ("ikili", "binary"), ("düğüm", "node"),
    ("kök", "root"), ("yaprak", "leaf"), ("yükseklik", "height"), ("derinlik", "depth"), ("çizge", "graph"),
    ("graf", "graph"), ("kenar", "edge"), ("tepe", "vertex"), ("komşu", "neighbor"), ("en kısa yol", "shortest path"),
    ("ağırlık", "weight"), ("döngü", "cycle"), ("gezinme", "traversal"), ("derinlik öncelikli", "depth-first"),
    ("genişlik öncelikli", "breadth-first"), ("arama", "search"), ("sıralama", "sorting"), ("ekle", "insert"),
    ("sil", "delete"), ("bul", "find"), ("karmaşıklık", "complexity"), ("sabit zaman", "constant time"),
    ("doğrusal", "linear"), ("algoritma", "algorithm"), ("işlem", "operation"), ("işlemci", "processor"),
    ("bellek", "memory"), ("dosya", "file"), ("süreç", "process"), ("iş parçacığı", "thread"), ("kilit", "lock"),
    ("kesme", "interrupt"), ("çizelgeleme", "scheduling"), ("sayfa", "page"), ("kilitlenme", "deadlock"),
    ("değer", "value"), ("tablo", "table"), ("indeks", "index"), ("fonksiyon", "function"), ("işlev", "function"),
    ("veri tabanı", "database"), ("veritabanı", "database"), ("sorgu", "query"), ("ağ", "network"), ("veri", "data"),
    ("bayt", "byte"), ("saniye", "second"), ("her", "every"), ("başlar", "begins"), ("başla", "begin"),
    ("kullanır", "uses"), ("kullan", "use"), ("sağlar", "provides"), ("gerektirir", "requires"),
    ("çalışır", "works"), ("yapılır", "is done"), ("kurulur", "is established"), ("kurulum", "setup"),
    ("kurar", "establishes"), ("kapatma", "closing"), ("sonra", "after"), ("önce", "before"), ("kadar", "until"),
    ("ilk", "first"), ("son", "last"), ("en küçük", "smallest"), ("en büyük", "largest"), ("en az", "at least"),
    ("en fazla", "at most"), ("aynı", "same"), ("farklı", "different"), ("garanti", "guarantee"),
    ("sıra", "order"), ("teslimat", "delivery"), ("teslim", "delivery"),
]

_ASCII = str.maketrans("çğıöşüâîûÇĞİÖŞÜ", "cgiosuaiuCGIOSU")


def _fold(text: str) -> str:
    return text.translate(_ASCII).lower()


def language_of(text: str) -> str:
    return "tr" if _is_turkish(text) else "en"


def _tr_to_en() -> list[tuple[re.Pattern, str]]:
    rules = []
    for tr, en in sorted(GLOSSARY, key=lambda p: -len(p[0])):
        words = _fold(tr).split()
        pattern = r"(?<![a-z0-9])" + r"\s+".join(re.escape(w) + r"[a-z]*" for w in words)
        rules.append((re.compile(pattern), en))
    return rules


def _en_to_tr() -> list[tuple[re.Pattern, str]]:
    best: dict[str, str] = {}
    for tr, en in GLOSSARY:
        best.setdefault(en.lower(), tr)
    rules = []
    for en, tr in sorted(best.items(), key=lambda p: -len(p[0])):
        words = en.split()
        pattern = r"(?<![a-z0-9])" + r"\s+".join(re.escape(w) + r"(?:s|es|ed|ing|ion|ions)?" for w in words) + r"(?![a-z0-9])"
        rules.append((re.compile(pattern), tr))
    return rules


_RULES = {"en": _tr_to_en(), "tr": _en_to_tr()}


def dictionary_translate(text: str, target: str) -> str | None:
    """Glossary terms of `text` replaced by the other language; unknown words stay. None when no term was
    found (there is nothing to compare differently)."""
    out = _fold(text) if target == "en" else text.lower()
    hits = 0
    for pattern, replacement in _RULES[target]:
        out, n = pattern.subn(" " + replacement + " ", out)
        hits += n
    return re.sub(r"\s+", " ", out).strip() if hits else None


# ── model translation ─────────────────────────────────────────────────────────────────────────
_ACRONYM = re.compile(r"(?<![A-Za-z])[A-Z][A-Z0-9]{1,9}(?![A-Za-z])")


def translation_is_faithful(original: str, translation: str) -> bool:
    """The translation keeps the numbers, the acronyms and the polarity of the original."""
    if not translation.strip() or translation.strip().lower() == original.strip().lower():
        return False
    if numbers(original) != numbers(translation):
        return False
    low = translation.lower()
    if any(a.lower() not in low for a in _ACRONYM.findall(original)):
        return False
    return has_negation(original) == has_negation(translation)


def llm_settings() -> tuple[str, str] | None:
    if os.environ.get("SELF_CHECK_TRANSLATE", "on").strip().lower() in ("0", "off", "false", "no"):
        return None
    url = os.environ.get("SELF_CHECK_LLM_BASE_URL") or os.environ.get("UNIFIED_LLM_BASE_URL", "")
    model = os.environ.get("SELF_CHECK_LLM_MODEL") or os.environ.get("UNIFIED_LLM_MODEL", "")
    return (url, model) if url and model and is_local_endpoint(url) else None


SYSTEM = (
    "You translate study sentences literally between Turkish and English. Keep every number, acronym, "
    "technical term, and every negation exactly. Do not add, explain, correct or summarise anything."
)


def model_translate(texts: list[str], target: str, complete=None, timeout: float = 40.0) -> list[str | None]:
    """Translations of `texts` into `target` ('en' or 'tr'), None where the model failed or the translation
    is not faithful. `complete(request) -> text` can be injected; by default the local model is used."""
    if not texts:
        return []
    language = "English" if target == "en" else "Turkish"
    user = (
        f"Translate each sentence into {language}. Return JSON "
        '{"translations": [...]} with exactly ' + f"{len(texts)} items, in order.\n" + json.dumps(texts, ensure_ascii=False)
    )
    request = LLMRequest(
        system=SYSTEM, user=user, temperature=0.0, max_output_tokens=min(3000, 120 * len(texts) + 200),
        json_mode=True, timeout_seconds=timeout,
        response_schema=obj({"translations": array(string(600), len(texts), len(texts))}),
    )
    try:
        if complete is None:
            settings = llm_settings()
            if settings is None:
                return [None] * len(texts)
            with httpx.Client() as client:
                raw = OpenAICompatibleProvider(settings[0], settings[1], client=client).complete(request).text
        else:
            raw = complete(request)
        items = json.loads(raw)["translations"]
    except (ProviderError, httpx.HTTPError, ValueError, KeyError, TypeError):
        return [None] * len(texts)
    if not isinstance(items, list) or len(items) != len(texts):
        return [None] * len(texts)
    return [t.strip() if isinstance(t, str) and translation_is_faithful(o, t) else None for o, t in zip(texts, items)]
