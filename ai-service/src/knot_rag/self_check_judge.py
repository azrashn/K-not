"""Meaning check for the self-check: a second opinion from the local model, never a verdict.

Word matching can say "in the source" for a sentence that means the opposite ("the server sends to the
client" against "the client sends to the server"). For claims that were found in a source the local model
is asked whether the passage SUPPORTS or CONTRADICTS the claim, and it must quote the deciding words.

What the student sees from it is only a warning ("the meaning may differ, check the source" + the quote),
and only when the quote really occurs in the passage. The label of the claim is never changed by the model.
"""

from __future__ import annotations

import json
import os

import httpx

from knot_rag.generation.providers.base import LLMRequest, ProviderError
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.self_check_translate import llm_settings
from knot_rag.structured import array, obj, string
from knot_rag.text import find_folded

SYSTEM = (
    "You compare a student's sentence with a passage from the course material. For each pair decide: "
    "SUPPORTS (the passage says the same thing), CONTRADICTS (the passage states something incompatible: "
    "opposite direction, roles swapped, opposite meaning, a different fact), or UNSURE. "
    "Answer CONTRADICTS only when it is clear. If the passage supports the sentence or you are not sure, "
    "do not answer CONTRADICTS. For CONTRADICTS copy the exact words of the passage that decide it "
    "into `quote`; otherwise leave `quote` empty."
)
VERDICTS = ("SUPPORTS", "CONTRADICTS", "UNSURE")
MAX_ITEMS = 25
PASSAGE_CHARS = 900


def judge_enabled() -> bool:
    return os.environ.get("SELF_CHECK_JUDGE", "on").strip().lower() not in ("0", "off", "false", "no") and llm_settings() is not None


def _judge_once(pairs: list[tuple[str, str]], complete=None, timeout: float = 60.0) -> list[dict | None]:
    """For each (claim, passage): {'verdict', 'quote'} with a verified quote for CONTRADICTS, or None when the
    model failed. A CONTRADICTS without a quote that is literally in the passage becomes UNSURE."""
    pairs = pairs[:MAX_ITEMS]
    if not pairs:
        return []
    payload = [{"index": i, "sentence": c, "passage": p[:PASSAGE_CHARS]} for i, (c, p) in enumerate(pairs)]
    request = LLMRequest(
        system=SYSTEM,
        user="Judge every pair. Return JSON {\"results\": [...]} with one item per pair, same order.\n" + json.dumps(payload, ensure_ascii=False),
        temperature=0.0, max_output_tokens=min(3000, 150 * len(pairs) + 200), json_mode=True, timeout_seconds=timeout,
        response_schema=obj({"results": array(obj({"index": {"type": "integer", "minimum": 0, "maximum": len(pairs) - 1},
                                                      "verdict": {"type": "string", "enum": list(VERDICTS)},
                                                      "quote": string(400)}), len(pairs), len(pairs))}),
    )
    try:
        if complete is None:
            settings = llm_settings()
            if settings is None:
                return [None] * len(pairs)
            with httpx.Client() as client:
                raw = OpenAICompatibleProvider(settings[0], settings[1], client=client).complete(request).text
        else:
            raw = complete(request)
        items = json.loads(raw)["results"]
    except (ProviderError, httpx.HTTPError, ValueError, KeyError, TypeError):
        return [None] * len(pairs)
    out: list[dict | None] = [None] * len(pairs)
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("index"), int) or not 0 <= item["index"] < len(pairs):
            continue
        verdict, quote = item.get("verdict"), item.get("quote")
        if verdict not in VERDICTS:
            continue
        passage = pairs[item["index"]][1]
        if verdict == "CONTRADICTS":
            span = find_folded(passage, quote) if isinstance(quote, str) and len(quote.strip()) >= 6 else None
            if span is None:
                verdict, quote = "UNSURE", ""
            else:
                quote = passage[span[0]:span[1]]
        else:
            quote = ""
        out[item["index"]] = {"verdict": verdict, "quote": quote}
    return out


def judge(pairs: list[tuple[str, str]], complete=None, timeout: float = 60.0) -> list[dict | None]:
    """Batch judgement, then every CONTRADICTS is asked again ALONE. A model that is distracted by the other
    pairs of a batch sometimes cries wolf; only a contradiction that holds up in both rounds (each with a
    quote that is literally in the passage) is kept, the rest becomes UNSURE."""
    pairs = pairs[:MAX_ITEMS]
    first = _judge_once(pairs, complete, timeout)
    out = list(first)
    for i, v in enumerate(first):
        if v and v["verdict"] == "CONTRADICTS":
            again = _judge_once([pairs[i]], complete, timeout)[0]
            if not again or again["verdict"] != "CONTRADICTS":
                out[i] = {"verdict": "UNSURE", "quote": ""}
    return out
