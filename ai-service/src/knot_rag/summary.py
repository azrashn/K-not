"""Source-bound summary and key concepts for one material.

The model may only write points that quote a passage appearing verbatim in one of the numbered
sources. The server re-checks every quote and drops points it cannot verify; if nothing survives,
no summary is returned. Local-model-only, like the quiz pipeline.
"""

import json
import os
import re

import httpx
from fastapi import HTTPException

from knot_rag.generation.providers.base import LLMRequest, ProviderError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.generation.providers.policy import is_local_endpoint
from knot_rag.structured import array, obj, string

MAX_SOURCES = 12
MAX_ITEMS = 10
SOURCE_CHARS = 1800
FOCI = ("summary", "concepts")


def summary_schema(focus, source_count):
    source = {"type": "integer", "minimum": 1, "maximum": source_count}
    if focus == "concepts":
        item = obj({"term": string(80), "explanation": string(400), "quote": string(600), "source_index": source})
        return obj({"concepts": array(item, 1, MAX_ITEMS)})
    item = obj({"text": string(400), "quote": string(600), "source_index": source})
    return obj({"points": array(item, 1, MAX_ITEMS)})


def _exact_quote(quote, source_text):
    """The quote as it appears in the source (whitespace may differ); None when absent."""
    tokens = quote.split()
    if not tokens:
        return None
    match = re.search(r"\s+".join(re.escape(t) for t in tokens), source_text)
    return match.group(0) if match else None


def verified_items(raw, focus, sources):
    """(verified items, number the model proposed). Unverifiable items are dropped."""
    key = "concepts" if focus == "concepts" else "points"
    proposed = raw.get(key) if isinstance(raw, dict) else None
    if not isinstance(proposed, list):
        return [], 0
    items = []
    for entry in proposed[:MAX_ITEMS]:
        if not isinstance(entry, dict):
            continue
        n = entry.get("source_index")
        if type(n) is not int or not 1 <= n <= len(sources):
            continue
        raw_quote = entry.get("quote")
        quote = _exact_quote(raw_quote, sources[n - 1]["text"]) if isinstance(raw_quote, str) else None
        if not quote or len(quote) < 8:
            continue
        if focus == "concepts":
            term, explanation = entry.get("term"), entry.get("explanation")
            if not isinstance(term, str) or not 2 <= len(term.strip()) <= 80:
                continue
            if not isinstance(explanation, str) or not 8 <= len(explanation.strip()) <= 400:
                continue
            items.append({"term": term.strip(), "explanation": explanation.strip(), "quote": quote, "source_index": n})
        else:
            text = entry.get("text")
            if not isinstance(text, str) or not 8 <= len(text.strip()) <= 400:
                continue
            items.append({"text": text.strip(), "quote": quote, "source_index": n})
    return items, len(proposed)


def build_summary(provider, focus, language, sources, terms=None):
    numbered = "\n\n".join(f"[{i}] {s['text'][:SOURCE_CHARS]}" for i, s in enumerate(sources, 1))
    lang = "Turkish" if language == "tr" else "English"
    hint = ""
    clean_terms = [t for t in (terms or []) if isinstance(t, str) and 2 <= len(t) <= 60][:16]
    if clean_terms:
        hint = " Terms this material stresses (prefer concepts among them): " + ", ".join(clean_terms) + "."
    if focus == "concepts":
        task = (
            "List the 6 to 10 key concepts a student must know, each from a different source when possible. "
            "term: the concept as the source names it (English term as written in the source). "
            f"explanation: ONE or TWO sentences in {lang} that explain what the concept is and why it matters, "
            "written in your own words from what the source says. "
            "quote: ONE sentence or bullet copied exactly from the source that supports the explanation. "
            'Return JSON {"concepts":[{"term","explanation","quote","source_index"}]}.'
        )
    else:
        task = (
            "Write 6 to 10 points that together summarize the material from beginning to end, in the order of the "
            "sources, covering different sources. "
            f"text: ONE or TWO sentences in {lang} that state the idea (not a copy of the quote, not a title). "
            "quote: ONE sentence or bullet copied exactly from the source that supports the point. "
            'Skip titles, page numbers and diagram labels. Return JSON {"points":[{"text","quote","source_index"}]}.'
        )
    system = (
        f"Write in {lang}. Use ONLY the numbered sources. {task}{hint} "
        "quote must be copied exactly, word for word, from the source named by source_index. "
        "Do not add facts that no source states."
    )
    try:
        result = provider.complete(
            LLMRequest(
                system=system,
                user=numbered,
                temperature=0.0,
                max_output_tokens=1800,
                timeout_seconds=110,
                response_schema=summary_schema(focus, len(sources)),
            )
        )
        raw = json.loads(result.text)
    except (ProviderError, ValueError):
        raise HTTPException(422, "Kaynaklı özet çıkarılamadı.")
    items, proposed = verified_items(raw, focus, sources)
    if not items:
        raise HTTPException(422, "Kaynaklı özet çıkarılamadı.")
    return {
        "focus": focus,
        "items": items,
        "dropped": proposed - len(items),
        "quality": {"quote_verified": True, "model_generated": True},
    }


def summarize(body):
    url = os.environ.get("SUMMARY_LLM_BASE_URL") or os.environ.get("UNIFIED_LLM_BASE_URL", "")
    model = os.environ.get("SUMMARY_LLM_MODEL") or os.environ.get("UNIFIED_LLM_MODEL", "")
    if not url or not model or not is_local_endpoint(url):
        raise HTTPException(503, "Local summary model unavailable")
    sources = [s for s in body.evidence[:MAX_SOURCES] if isinstance(s.get("text"), str) and s["text"].strip()]
    if not sources:
        raise HTTPException(422, "No source for summary")
    with httpx.Client() as client:
        provider = OpenAICompatibleProvider(url, model, client=client)
        return build_summary(provider, body.focus, body.language, sources, body.terms)
