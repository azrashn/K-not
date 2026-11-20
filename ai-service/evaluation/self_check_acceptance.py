"""Acceptance run of the self-check against a REAL index (the one the running services filled).

    python evaluation/self_check_acceptance.py [--chroma .chroma] [--claims evaluation/self_check_claims_computer_network.json]

Claims carry a `kind`: true (found in the course), fake (invented), conflict (contradicts the course),
conflict_hard (contradicts it in a way slide text cannot show: reported only).
Hard criteria, the run fails when one is broken:
  * a fake claim is never IN_SOURCE and never CONFLICTS (no invented contradiction either);
  * a true claim is never CONFLICTS;
  * a conflict claim is never IN_SOURCE;
  * no UNCHECKED / NOT_IN_SOURCE claim shows a source;
  * no quote shown to the student is unreadable text (number tables, mixed alphabets).
Reported: how many true claims were found, how many conflicts were caught. Uses the local model for
translation / meaning check when UNIFIED_LLM_BASE_URL and UNIFIED_LLM_MODEL are set.
"""

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.stdout.reconfigure(encoding="utf-8")

from knot_rag.bootstrap import build_components  # noqa: E402
from knot_rag.config import Settings  # noqa: E402
from knot_rag.self_check import SelfCheck, self_check  # noqa: E402
from knot_rag.self_check_norm import is_readable  # noqa: E402
from knot_rag.unified import Material, UnifiedIndex  # noqa: E402


def open_index(chroma: str):
    settings = Settings(
        embedding_backend="sentence_transformers", embedding_model="intfloat/multilingual-e5-small",
        embedding_query_prefix="query: ", embedding_document_prefix="passage: ",
        embedding_revision="614241f622f53c4eeff9890bdc4f31cfecc418b3", chroma_mode="persistent", chroma_path=chroma)
    index = UnifiedIndex(build_components(settings))
    rows = index.collection().get(where={"marker": False}, include=["metadatas"], limit=100000)
    courses: dict[str, dict[str, Material]] = {}
    for m in rows["metadatas"]:
        courses.setdefault(m["course_id"], {})[m["material_id"]] = Material(
            id=m["material_id"], version=m["version"], kind=m["kind"], title=m["title"])
    course = max(courses, key=lambda c: len(courses[c]))
    return index, course, list(courses[course].values())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chroma", default=str(ROOT / ".chroma"))
    ap.add_argument("--claims", default=str(ROOT / "evaluation" / "self_check_claims_computer_network.json"))
    args = ap.parse_args()
    claims = json.loads(Path(args.claims).read_text(encoding="utf-8"))
    index, course, materials = open_index(args.chroma)
    print(f"course {course}: {[m.title for m in materials]}")
    started = time.time()
    results = {}
    for item in claims:  # one claim per request: the labels never depend on a neighbour
        r = self_check(index, SelfCheck(course_id=course, materials=materials, text=item["text"]))
        results[item["text"]] = r["claims"][0] if r["claims"] else None
    print(f"{len(claims)} claims in {time.time() - started:.0f} s\n")

    broken, found, caught, trues, conflicts = [], 0, 0, 0, 0
    for item in claims:
        c = results[item["text"]]
        label = c["label"] if c else "SKIPPED"
        kind = item["kind"]
        marks = []
        if kind == "fake" and label in ("IN_SOURCE", "CONFLICTS"):
            marks.append("fake claim reported as " + label)
        if kind == "true":
            trues += 1
            found += label == "IN_SOURCE"
            if label == "CONFLICTS":
                marks.append("true claim reported as CONFLICTS")
        if kind == "conflict_hard":
            # Slide bullets give no sentence to compare direction with: reported, not a hard criterion.
            conflicts += 1
            caught += label == "CONFLICTS"
            if label == "IN_SOURCE":
                marks_info = "MISSED (known limit)"
                print(f"{kind:9} {label:13}   {item['text'][:80]}   <-- {marks_info}")
                continue
        if kind == "conflict":
            conflicts += 1
            caught += label == "CONFLICTS"
            if label == "IN_SOURCE":
                marks.append("contradicting claim reported as IN_SOURCE")
        if c and label in ("UNCHECKED", "NOT_IN_SOURCE") and c["sources"]:
            marks.append("sources shown on " + label)
        for s in (c["sources"] if c else []):
            if not is_readable(s["quote"]):
                marks.append("unreadable quote: " + s["quote"][:40])
        warn = " W" if c and c.get("meaning_warning") else ""
        print(f"{kind:9} {label:13}{warn:2} {item['text'][:80]}" + (f"   <-- {'; '.join(marks)}" if marks else ""))
        broken += [f"{item['text'][:60]}: {m}" for m in marks]
    print(f"\ntrue claims found: {found}/{trues}   contradictions caught: {caught}/{conflicts}")
    if broken:
        print("\nBROKEN CRITERIA:")
        print("\n".join(" - " + b for b in broken))
        return 1
    print("\nall hard criteria hold")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
