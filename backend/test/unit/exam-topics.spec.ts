import { examTopics } from "../../src/learning/exam-plan";
import {
  buildExamProfile, cleanTopicTerms, ExamProfile, isTopicTerm, mergeExamProfiles, sameRoot,
} from "../../src/learning/exam-style";

const profile = (topic_terms: string[]): ExamProfile => ({
  question_count: 1,
  formats: { MULTIPLE_CHOICE: 0, TRUE_FALSE: 0, CALCULATION: 0, OPEN: 1 },
  calculation_share: 0,
  average_stem_chars: 40,
  sample_stems: [],
  topic_terms,
});

// Ported from origin/feature/quiz-quality-overhaul (Fatih): backend/test/unit/exam-topics.spec.ts
describe("past exam boilerplate is not a topic", () => {
  it("drops header and scoring words", () => {
    const text = [1, 2, 3, 4].map((n) => `${n}. (10 puan) Ad Soyad Tarih: TCP bağlantısı nasıl kurulur? TCP sorusu`).join("\n");
    const terms = buildExamProfile(text).topic_terms;
    expect(terms).toContain("bağlantısı");
    for (const w of ["puan", "soyad", "tarih", "sorusu"]) expect(terms).not.toContain(w);
  });
});

describe("question words are not topics", () => {
  it("the terms of the failed exam keep only real subjects, one per root", () => {
    const stored = ["bytecode", "bellek", "hangi", "belleği", "collector", "nesne", "çalışabilmesinin"];
    expect(cleanTopicTerms(stored)).toEqual(["bytecode", "bellek", "collector", "nesne"]);
  });

  it.each([
    "hangi", "nedir", "nasıl", "neden", "kısaca", "açıklayınız", "yazınız", "doğru", "yanlış", "puan", "tarih",
    "soru", "cevap", "Hangisidir", "nelerdir", "çalışabilmesinin", "yapılabilmesi",
  ])("%s is not a topic", (word) => {
    expect(isTopicTerm(word)).toBe(false);
  });

  it.each(["bytecode", "bellek", "nesne", "collector", "kuyruk", "algoritmasının"])("%s is a topic", (word) => {
    expect(isTopicTerm(word)).toBe(true);
  });

  it("a new profile never takes question words or both forms of one word", () => {
    const text = [
      "1. Java'da bellek yönetimi hangi bileşen tarafından yapılır? Kısaca açıklayınız.",
      "2. Çöp toplayıcı belleği nasıl boşaltır? Açıklayınız.",
      "3. Bellek sızıntısı neden oluşur? Yazınız.",
      "4. Bytecode hangi ortamda çalışır?",
    ].join("\n");
    const terms = buildExamProfile(text).topic_terms;
    expect(terms[0]).toBe("bellek"); // bellek ×2 + belleği ×1, under the more frequent form
    expect(terms).not.toContain("belleği");
    for (const w of ["hangi", "kısaca", "açıklayınız", "nasıl", "neden", "yazınız"]) expect(terms).not.toContain(w);
    expect(terms).toContain("bytecode");
  });
});

describe("terms of one root count as one topic", () => {
  it.each([
    ["bellek", "belleği"], ["bellek", "belleğin"], ["nesne", "nesneler"], ["nesne", "nesnesi"],
    ["kuyruk", "kuyruğu"], ["ağaç", "ağacı"], ["algoritma", "algoritmaya"], ["Bellek", "BELLEĞİ"],
  ])("%s and %s share a root", (a, b) => {
    expect(sameRoot(a, b)).toBe(true);
    expect(sameRoot(b, a)).toBe(true);
  });

  it.each([["dizi", "dizin"], ["veri", "verim"], ["graf", "grafik"], ["bellek", "bytecode"]])(
    "%s and %s are different words",
    (a, b) => expect(sameRoot(a, b)).toBe(false),
  );

  it("profiles saved before these rules are cleaned when an exam is made from them", () => {
    expect(examTopics(undefined, profile(["hangi", "bellek", "belleği", "nesne"]))).toEqual(["bellek", "nesne"]);
  });

  it("topics the student wrote are kept as written", () => {
    expect(examTopics(["hangi", "bellek", "belleği"], profile([]))).toEqual(["hangi", "bellek", "belleği"]);
  });

  it("two exams with bellek and belleği share one topic that both exams count", () => {
    const merged = mergeExamProfiles([profile(["bellek", "hangi", "bytecode"]), profile(["belleği", "nesne"])]);
    expect(merged.topic_terms).toEqual(["bellek", "bytecode", "nesne"]);
    expect(merged.term_exams).toEqual({ bellek: 2, bytecode: 1, nesne: 1 });
  });

  it("an old single profile is cleaned too", () => {
    const merged = mergeExamProfiles([profile(["hangi", "bellek", "belleği"])]);
    expect(merged.topic_terms).toEqual(["bellek"]);
    expect(merged.term_exams).toEqual({ bellek: 1 });
  });
});
