# SPDX-License-Identifier: Apache-2.0
# Adapted from HKUDS/DeepTutor, commit f7aed0744c36c5afef16a4261c31ebee1208cac2,
# deeptutor/agents/question/pipeline.py (_parse_quiz_payload/_normalize_quiz_payload).
# Copyright 2025 Data Intelligence Lab, The University of Hong Kong.
# Changes: standalone functions, strict four-option keys, K-NOT array/index contract,
# feedback alignment, no best-effort publication or invented answer fallback.
# Full license and provenance: third_party/deeptutor/.
"""Normalize named choices without coupling K-NOT to the upstream runtime."""

import json
import re

CHOICE_KEYS = ("A", "B", "C", "D")


def parse_quiz_payload(raw):
    text = (raw or "").strip()
    if not text:
        return {}
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        if start == -1:
            return {}
        try:
            parsed, _end = json.JSONDecoder().raw_decode(text[start:])
        except json.JSONDecodeError:
            return {}
    return parsed if isinstance(parsed, dict) else {}


def normalize_choice_payload(payload):
    normalized = dict(payload)
    options = normalized.get("options")
    if not isinstance(options, dict):
        # The public/legacy K-NOT shape remains valid; validate_draft still checks it.
        return normalized
    clean = {}
    for key, value in options.items():
        label = str(key).strip().upper()
        if label not in CHOICE_KEYS or label in clean or not isinstance(value, str):
            raise ValueError("Invalid named choices")
        clean[label] = value.strip()
    if set(clean) != set(CHOICE_KEYS) or any(not value for value in clean.values()):
        raise ValueError("Four named choices required")
    answer = normalized.get("expected")
    if not isinstance(answer, str) or answer.strip().upper() not in clean:
        raise ValueError("Named answer key required")
    feedback = normalized.get("option_feedback")
    if not isinstance(feedback, dict) or set(feedback) != set(CHOICE_KEYS):
        raise ValueError("Named option feedback required")
    normalized["options"] = [clean[key] for key in CHOICE_KEYS]
    normalized["expected"] = str(CHOICE_KEYS.index(answer.strip().upper()))
    normalized["option_feedback"] = [feedback[key] for key in CHOICE_KEYS]
    return normalized
