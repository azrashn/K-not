import { commonReason, examTopics, groundTopics } from "../../src/learning/exam-plan";
import {
  buildExamProfile, cleanTopicTerms, ExamProfile, isTopicTerm, mergeExamProfiles, sameRoot,
} from "../../src/learning/exam-style";

const SOURCES = [
  { title: "Chapter_3", text: "Transport vs. network layer services and protocols\ntransport layer: communication between processes" },
  { title: "Chapter_3", text: "TCP: overview\nreliable, in-order byte stream; TCP uses a three-way handshake" },
  { title: "Chapter_6", text: "Link layer: services\nframing, link access: encapsulate datagram into frame" },
  { title: "Chapter_6", text: "Chapter 6\n12" },
];

describe("exam topics grounded in the course sources", () => {
  it("keeps past-exam terms the sources contain, most frequent first, and drops the rest", () => {
    const { topics, dropped } = groundTopics(["puan", "TCP", "framing", "Dijkstra"], SOURCES, 2);
    expect(topics.slice(0, 2)).toEqual(["TCP", "framing"]);
    expect(dropped).toEqual(["puan", "Dijkstra"]);
  });

  it("fills up with source headings when the past exam shares no words with the course", () => {
    const { topics } = groundTopics(["kalıtım", "polimorfizm"], SOURCES, 5);
    expect(topics).toContain("Link layer: services");
    expect(topics).toContain("TCP: overview");
    expect(topics).not.toContain("Chapter 6"); // a bare chapter number is not a topic
    expect(new Set(topics).size).toBe(topics.length);
  });

  it("takes headings from every material in turn, not only the first long one", () => {
    const { topics } = groundTopics([], SOURCES, 2);
    expect(topics.slice(0, 2)).toEqual(["Transport vs. network layer services and protocols", "Link layer: services"]);
  });

  it("names the reason most attempts failed with", () => {
    expect(commonReason([{ reason: "a" }, { reason: "b" }, { reason: "b" }])).toEqual({ reason: "b", count: 2 });
    expect(commonReason([])).toBeNull();
  });
});

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
