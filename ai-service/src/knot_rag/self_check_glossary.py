"""Course glossary for the self-check: term pairs (Turkish <-> English) learned from the course's own
materials, updated whenever a material is indexed or removed.

Stored as one small JSON file per course under STORAGE_ROOT/self-check-glossary/<course>.json (no database).
Three sources, from the safest to the most general:
* pairs the material itself gives, such as "çerçeve (frame)" or "frame (çerçeve)";
* the material's most frequent terms, translated once by the local model in the background (`fill`);
* the built-in glossary of self_check_translate, which stays as the fallback.
Pairs only help to COMPARE a claim written in the other language; nothing here is shown as a fact.
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections import Counter
from pathlib import Path

from knot_rag.self_check_translate import language_of
from knot_rag.text import STOPWORDS, fold

_SAFE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_LOCK = threading.Lock()
TOP_TERMS = 60
MAX_PAIRS = 400
_BRACKET = re.compile(r"([A-Za-zÇĞİÖŞÜçğıöşüâîû][A-Za-zÇĞİÖŞÜçğıöşüâîû \-]{2,40}?)\s*\(\s*([A-Za-zÇĞİÖŞÜçğıöşüâîû][A-Za-zÇĞİÖŞÜçğıöşüâîû \-]{2,40})\s*\)")
_TR_MARK = re.compile(r"[çğıöşüÇĞİÖŞÜ]")
_WORD = re.compile(r"[A-Za-zÇĞİÖŞÜçğıöşüâîû][A-Za-zÇĞİÖŞÜçğıöşüâîû\-]{3,}")


def _path(course_id: str) -> Path | None:
    root = os.environ.get("STORAGE_ROOT")
    if not root or not _SAFE.match(course_id):
        return None
    return Path(root).resolve() / "self-check-glossary" / f"{course_id}.json"


def _read(course_id: str) -> dict:
    path = _path(course_id)
    if path is None or not path.exists():
        return {"materials": {}, "model": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) and isinstance(data.get("materials"), dict) else {"materials": {}, "model": {}}
    except (OSError, ValueError):
        return {"materials": {}, "model": []}


def _write(course_id: str, data: dict) -> None:
    path = _path(course_id)
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def extract_pairs(texts: list[str]) -> list[list[str]]:
    """[tr, en] pairs written in the text as `term (other-language term)`. Which side is Turkish follows
    from the language of the sentence around the brackets."""
    found: dict[tuple[str, str], int] = {}
    for text in texts:
        for m in _BRACKET.finditer(text):
            left, right = m.group(1).strip(), m.group(2).strip()
            if fold(left) == fold(right) or len(left.split()) > 4 or len(right.split()) > 4:
                continue
            context = text[max(0, m.start() - 90):m.start()] + " " + text[m.end():m.end() + 90]
            turkish_sentence = language_of(context) == "tr" or bool(_TR_MARK.search(left)) and not _TR_MARK.search(right)
            if turkish_sentence and _TR_MARK.search(right):
                continue
            if not turkish_sentence and _TR_MARK.search(left):
                continue
            pair = (left, right) if turkish_sentence else (right, left)
            found[pair] = found.get(pair, 0) + 1
    return [list(p) for p, _ in sorted(found.items(), key=lambda kv: -kv[1])[:MAX_PAIRS]]


def top_terms(texts: list[str], limit: int = TOP_TERMS) -> list[str]:
    counts: Counter[str] = Counter()
    for text in texts:
        for word in _WORD.findall(text):
            low = fold(word)
            if low in STOPWORDS or low.isdigit():
                continue
            counts[word if word.isupper() else word.lower()] += 1
    return [w for w, n in counts.most_common(limit * 2) if n >= 2][:limit]


def update_material(course_id: str, material_id: str, version: str, texts: list[str]) -> bool:
    """Called after a material was indexed: replaces its entries. Returns False when nothing is stored."""
    if _path(course_id) is None or not _SAFE.match(material_id):
        return False
    entry = {"version": version, "pairs": extract_pairs(texts), "terms": top_terms(texts)}
    with _LOCK:
        data = _read(course_id)
        old = data["materials"].get(material_id)
        data["materials"][material_id] = {**entry, "filled": bool(old and old.get("version") == version and old.get("filled"))}
        _write(course_id, data)
    return True


def remove_material(course_id: str, material_id: str) -> None:
    if _path(course_id) is None:
        return
    with _LOCK:
        data = _read(course_id)
        if data["materials"].pop(material_id, None) is not None:
            _write(course_id, data)


def course_pairs(course_id: str, material_ids: list[str] | None = None) -> list[tuple[str, str]]:
    """[(tr, en)] of the course: pairs from the materials (all or the selected ones) plus model pairs."""
    data = _read(course_id)
    out: dict[tuple[str, str], None] = {}
    for mid, entry in data["materials"].items():
        if material_ids is None or mid in material_ids:
            for tr, en in entry.get("pairs", []):
                out[(tr, en)] = None
    for tr, en in data.get("model", []):
        out[(tr, en)] = None
    return list(out)


def _model_pairs(terms: list[str], complete=None) -> list[tuple[str, str]]:
    """[(tr, en)] from the local model: it gives both forms of every term, so the direction never has to be
    guessed from a single word. Entries that do not contain the original term are dropped."""
    from knot_rag.generation.providers.base import LLMRequest, ProviderError
    from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
    from knot_rag.self_check_translate import llm_settings
    from knot_rag.structured import array, obj, string

    import httpx

    request = LLMRequest(
        system="You give the Turkish and the English form of computer-science course terms. Keep acronyms as they are. Do not explain.",
        user='For each term return {"term", "tr", "en"}. Return JSON {"items": [...]} in the same order.' + chr(10) + json.dumps(terms, ensure_ascii=False),
        temperature=0.0, max_output_tokens=min(3000, 60 * len(terms) + 200), json_mode=True, timeout_seconds=60.0,
        response_schema=obj({"items": array(obj({"term": string(80), "tr": string(80), "en": string(80)}), 0, len(terms))}),
    )
    try:
        if complete is None:
            settings = llm_settings()
            if settings is None:
                return []
            with httpx.Client() as client:
                raw = OpenAICompatibleProvider(settings[0], settings[1], client=client).complete(request).text
        else:
            raw = complete(request)
        items = json.loads(raw)["items"]
    except (ProviderError, httpx.HTTPError, ValueError, KeyError, TypeError):
        return []
    out = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not all(isinstance(item.get(k), str) for k in ("term", "tr", "en")):
            continue
        tr, en = item["tr"].strip(), item["en"].strip()
        if not tr or not en or fold(tr) == fold(en) or _TR_MARK.search(en):
            continue
        if fold(item["term"]) not in (fold(tr), fold(en)):
            continue
        out.append((tr, en))
    return out


def fill(course_id: str, material_id: str, complete=None) -> int:
    """Pairs for the material's frequent terms that have none yet (one batch, local model). Returns how
    many were added; 0 when the model is not available. Done once per material version."""
    with _LOCK:
        data = _read(course_id)
        entry = data["materials"].get(material_id)
        if not entry or entry.get("filled"):
            return 0
        have = {fold(x) for pair in entry.get("pairs", []) for x in pair} | {fold(x) for pair in data.get("model", []) for x in pair}
        terms = [t for t in entry.get("terms", []) if fold(t) not in have and not t.isupper()][:TOP_TERMS]
    pairs = _model_pairs(terms, complete) if terms else []
    with _LOCK:
        data = _read(course_id)
        known = {tuple(p) for p in data.get("model", [])}
        data["model"] = list(data.get("model", [])) + [list(p) for p in pairs if p not in known]
        if material_id in data["materials"]:
            data["materials"][material_id]["filled"] = bool(pairs) or not terms
        _write(course_id, data)
    return len(pairs)


def fill_in_background(course_id: str, material_id: str) -> None:
    """Best-effort, never blocks or breaks indexing."""
    def run():
        try:
            fill(course_id, material_id)
        except Exception:  # the glossary is an aid; a failure here must not matter
            pass

    threading.Thread(target=run, name="self-check-glossary", daemon=True).start()
