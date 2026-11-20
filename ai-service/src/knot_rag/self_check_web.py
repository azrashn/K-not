"""Optional web check of ONE claim, started by the student with a button (never automatic).

Only the claim sentence is sent, to Wikipedia (Turkish and/or English by the claim's language): no course,
user or material information. The answer is kept apart from the course materials: it is "found on the web"
or "not found there", never "in your sources", and it is not counted in the self-check summary. A web page
matching the words does not prove the claim true; the interface says so.
"""

from __future__ import annotations

import hashlib
import os
import re

import httpx

from knot_rag.self_check import classify
from knot_rag.self_check_translate import language_of
from knot_rag.text import STOPWORDS, content_tokens, fold

TIMEOUT = 8.0
MAX_HITS = 3
# Wikimedia rejects anonymous or unidentified clients (403). A declared bot identity, no personal data.
USER_AGENT = "Mozilla/5.0 (compatible; KnotSelfCheck/1.0; self-hosted study tool; +https://localhost)"
_ACRONYM = re.compile(r"(?<![A-Za-z])[A-Z][A-Z0-9]{1,9}(?![A-Za-z])")


def web_enabled() -> bool:
    return os.environ.get("SELF_CHECK_WEB", "on").strip().lower() not in ("0", "off", "false", "no")


def _query(claim: str) -> str:
    """The few words that identify the topic: acronyms first, then the longest content words."""
    acronyms = list(dict.fromkeys(_ACRONYM.findall(claim)))
    words = [w for w in dict.fromkeys(content_tokens(claim)) if not w.isdigit() and w not in STOPWORDS]
    words.sort(key=len, reverse=True)
    return " ".join((acronyms + words)[:6])


def _http_get(url: str, params: dict) -> dict:
    with httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}, follow_redirects=False) as client:
        response = client.get(url, params=params)
        response.raise_for_status()
        return response.json()


def _page_url(lang: str, title: str) -> str:
    return f"https://{lang}.wikipedia.org/wiki/" + title.replace(" ", "_")


def web_check(claim: str, fetch=None) -> dict:
    """{'status': FOUND | NOT_FOUND | UNAVAILABLE, 'sources': [{title, url, quote, site}]}"""
    if not web_enabled():
        return {"status": "UNAVAILABLE", "sources": []}
    get = fetch or _http_get
    lang = "tr" if language_of(claim) == "tr" else "en"
    query = _query(claim)
    if not query:
        return {"status": "NOT_FOUND", "sources": []}
    try:
        found = get(f"https://{lang}.wikipedia.org/w/api.php",
                    {"action": "query", "list": "search", "srsearch": query, "srlimit": MAX_HITS, "format": "json", "srprop": ""})
        titles = [h["title"] for h in found.get("query", {}).get("search", []) if isinstance(h.get("title"), str)][:MAX_HITS]
        if not titles:
            return {"status": "NOT_FOUND", "sources": []}
        # One request per page: the API caps extracts at ~1200 characters when several pages are asked at once.
        pages = {}
        for n, title in enumerate(titles[:2]):
            reply = get(f"https://{lang}.wikipedia.org/w/api.php",
                        {"action": "query", "prop": "extracts", "explaintext": 1, "exchars": 12000,
                         "titles": title, "format": "json", "redirects": 1})
            for key, page in (reply.get("query", {}).get("pages", {}) or {}).items():
                pages[f"{n}-{key}"] = page
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return {"status": "UNAVAILABLE", "sources": []}
    evidence = []
    for page in pages.values():
        text, title = page.get("extract"), page.get("title")
        if isinstance(text, str) and isinstance(title, str) and text.strip():
            evidence.append({"id": hashlib.sha256((lang + title).encode()).hexdigest(), "material_id": "web", "title": title,
                             "kind": "WEB", "location": {"page": 1}, "text": text})
    if not evidence:
        return {"status": "NOT_FOUND", "sources": []}
    result = classify(claim, evidence)
    # Only a clear match counts as found; a contradiction on the web is not reported (a page may be about
    # something else), the answer then is simply "not found".
    if result["label"] != "IN_SOURCE":
        return {"status": "NOT_FOUND", "sources": []}
    by_id = {e["id"]: e for e in evidence}
    sources = []
    for s in result["sources"][:2]:
        title = by_id[s["source_id"]]["title"]
        sources.append({"title": title, "url": _page_url(lang, title), "quote": s["quote"], "site": f"{lang}.wikipedia.org"})
    return {"status": "FOUND", "sources": sources}
