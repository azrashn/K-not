# DeepTutor adaptation

- Upstream: https://github.com/HKUDS/DeepTutor
- Commit: `f7aed0744c36c5afef16a4261c31ebee1208cac2`
- License: Apache-2.0; upstream license copied unchanged to `LICENSE`.
- Copyright notice: 2025 Data Intelligence Lab, The University of Hong Kong.
- Adapted code: `deeptutor/agents/question/pipeline.py`, `_parse_quiz_payload`
  and choice branch of `_normalize_quiz_payload` (approximately lines 1385–1450).
- Destination: `ai-service/src/knot_rag/quiz_payload.py`.
- Changes: standalone helpers, strict A–D choices, deterministic conversion to
  K-NOT option arrays/zero-based keys, aligned feedback and retained exact citations.
- Design reference: same upstream `prompts/en/pipeline.yaml`, plan/quiz phases;
  implemented as bounded local calls rather than installing its agent runtime.
- Full application, tool execution, best-effort invalid question emission,
  placeholder answers and external research are not imported.
- K-NOT's original authorship/license is unchanged. Further upstream code is not
  vendored. No additional model or training dataset is bundled by this adaptation.

Inspected alternatives: Questgen.ai `edf8f6aa6c1ad5e803ce2b6adfac8825a3e5a553`
(MIT, old Torch 2.0.1/Transformers 4.29.2/Sense2Vec stack) and Leaf
`0870a22ce73a87b28fdb53dec831d0cac694ba47` (MIT, English SQuAD/RACE and custom
T5 checkpoints). Neither was installed or copied. Their pretrained English
pipelines do not establish Turkish quality and would add incompatible dependencies.
