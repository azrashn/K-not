import { commonReason, groundTopics } from "../../src/learning/exam-plan";
import { buildExamProfile as profileExam } from "../../src/learning/exam-style";

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

describe("past exam boilerplate is not a topic", () => {
  it("drops header and scoring words", () => {
    const text = [1, 2, 3, 4].map((n) => `${n}. (10 puan) Ad Soyad Tarih: TCP bağlantısı nasıl kurulur? TCP sorusu`).join("\n");
    const terms = profileExam(text).topic_terms;
    expect(terms).toContain("bağlantısı");
    for (const w of ["puan", "soyad", "tarih", "sorusu"]) expect(terms).not.toContain(w);
  });
});
