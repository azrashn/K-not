"""Local constrained-output schemas; semantic validation remains independent."""


def obj(properties):
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def string(limit=1200):
    return {"type": "string", "maxLength": limit}


def array(items, minimum=0, maximum=15):
    return {"type": "array", "items": items, "minItems": minimum, "maxItems": maximum}


def explanation_schema(source_count, claim_limit, visual=False, mode="default"):
    p = {
        "claims": array(
            obj(
                {
                    "text": string(1800),
                    "sources": array(
                        {"type": "integer", "minimum": 1, "maximum": source_count},
                        1,
                        source_count,
                    ),
                }
            ),
            0,
            claim_limit,
        ),
        "clarification": string(700),
    }
    if visual:
        p["visual_observation"] = obj(
            {
                "observations": array(string(500), 1, 15),
                "uncertainties": array(string(300), 0, 8),
                "needs_clarification": {"type": "boolean"},
            }
        )
    generated = obj(p)
    minimum = (
        3 if mode in ("step_by_step", "detailed") else 2 if mode == "example" else 1
    )
    generated["properties"]["claims"]["minItems"] = minimum
    clarification = obj(
        {
            **p,
            "claims": array(p["claims"]["items"], 0, 0),
            "clarification": {"type": "string", "minLength": 20, "maxLength": 700},
        }
    )
    return {"anyOf": [generated, clarification]}


def visual_review_schema():
    return obj(
        {
            "all_parts_answered": {"type": "boolean"},
            "relations_supported": {"type": "boolean"},
            "missing_conditions": array(string(200), 0, 8),
            "clarification": string(500),
        }
    )


def quiz_schema(kind, source_count):
    n = 4 if kind == "MULTIPLE_CHOICE" else 2 if kind == "TRUE_FALSE" else 0
    expected = (
        {"type": "string", "enum": [str(i) for i in range(n)]} if n else string(180)
    )
    return obj(
        {
            "question": string(900),
            "objective": string(300),
            "options": array(string(180), n, n),
            "expected": expected,
            "quote": string(1600),
            "source_index": {"type": "integer", "minimum": 1, "maximum": source_count},
            "explanation": string(1400),
            "option_feedback": array(string(700), n, n),
        }
    )


def quiz_review_schema(kind):
    n = 4 if kind == "MULTIPLE_CHOICE" else 2 if kind == "TRUE_FALSE" else 0
    expected = (
        {
            "type": "string",
            "enum": [str(i) for i in range(4 if kind == "MULTIPLE_CHOICE" else 2)],
        }
        if kind in ("MULTIPLE_CHOICE", "TRUE_FALSE")
        else string(180)
    )
    return obj(
        {
            "expected": expected,
            **{
                k: {"type": "boolean"}
                for k in (
                    "clear",
                    "topic_related",
                    "answer_supported",
                    "single_correct",
                    "distractors_valid",
                )
            },
            "reason": string(500),
            "option_judgments": array(
                obj(
                    {
                        "index": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": max(0, n - 1),
                        },
                        "correct": {"type": "boolean"},
                        "reason": string(400),
                    }
                ),
                n,
                n,
            ),
        }
    )
