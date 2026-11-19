/** Azra's trial course: java-notlari.txt (a document without headings) and a video whose automatic
 *  transcript carries recognition errors ("Ceva object oriented", "Intelijayda'yı", "Final Neave"). */
import type { PoolMaterial, PoolSegment } from '../../../src/learning/generation/source-pool';

export const NOTES: PoolMaterial = { id: 'file_java', kind: 'TXT', title: 'java-notlari', status: 'READY', version: 'v1' };
export const SLIDES: PoolMaterial = { id: 'pdf_oop', kind: 'PDF', title: 'Nesneye yönelik programlama', status: 'READY', version: 'v1' };
export const VIDEO: PoolMaterial = { id: 'video_java', kind: 'VIDEO', title: '2 Dakikada Java   Java Nedir, Ne İşe Yarar', status: 'READY', version: 'v1' };

export const NOTE_SEGMENTS: PoolSegment[] = [
  { id: 'n1', text: "Java, 1995 yılında Sun Microsystems tarafından geliştirilen nesne yönelimli bir programlama dilidir. Java kaynak kodu derleyici tarafından bytecode'a çevrilir. Bytecode, Java Sanal Makinesi (JVM) üzerinde çalışır. Böylece aynı program farklı işletim sistemlerinde değişmeden çalışabilir." },
  { id: 'n2', text: "Sınıf, nesnelerin şablonudur. Nesne, bir sınıfın örneğidir ve durumunu alanlarında tutar. Kalıtım, bir sınıfın başka bir sınıfın özelliklerini devralmasını sağlar. Java'da bir sınıf yalnızca bir sınıftan kalıtım alabilir." },
  { id: 'n3', text: "final anahtar sözcüğüyle tanımlanan değişkenin değeri sonradan değiştirilemez. final olarak işaretlenen bir sınıftan kalıtım alınamaz. final metotlar alt sınıflarda geçersiz kılınamaz." },
  { id: 'n4', text: "Çöp toplayıcı, artık kullanılmayan nesnelerin belleğini otomatik olarak geri kazanır. Programcı belleği elle serbest bırakmak zorunda değildir. Bir nesneye hiçbir referans kalmadığında nesne toplanmaya uygun hale gelir. Toplama zamanı JVM tarafından belirlenir. System.gc çağrısı yalnızca bir istektir. Bellek sızıntısı Java'da da referanslar unutulduğunda oluşabilir." },
  { id: 'n5', text: "Bir dizinin uzunluğu oluşturulduktan sonra değişmez. Dizinin ilk elemanının indeksi 0'dır. 10 elemanlı bir dizinin son indeksi 9'dur." },
];
export const VIDEO_SEGMENTS: PoolSegment[] = [
  { id: 'v1', text: 'Ceva object oriented bir programlama dilidir arkadaşlar. Intelijayda yı derleicisine yazıyoruz kodu.', location: { kind: 'video', start_ms: 0 } },
  { id: 'v2', text: 'Final Neave anahtar kelimesi ile değişken sabit olur. Object her şeyin atasıdır diyebiliriz.', location: { kind: 'video', start_ms: 20000 } },
];

export const SEGMENTS = new Map<string, PoolSegment[]>([
  [NOTES.id, NOTE_SEGMENTS],
  [VIDEO.id, VIDEO_SEGMENTS],
  [SLIDES.id, [
    { id: 's1', text: 'Kapsülleme\nKapsülleme, bir sınıfın verisini dışarıdan gizler. Alanlara yalnızca metotlar üzerinden erişilir.', location: { kind: 'page', page: 1 } },
    { id: 's2', text: '[Bu sayfada çıkarılabilir metin yok.]', location: { kind: 'page', page: 2, empty: true } },
  ]],
]);

/** A knowledge service double: materials and their segments; preview of an unknown id throws. */
export function knowledge(materials: PoolMaterial[], segments = SEGMENTS) {
  return {
    materials: jest.fn().mockResolvedValue(materials),
    preview: jest.fn(async (_u: unknown, _c: unknown, id: string) => {
      if (!segments.has(id)) throw new Error('unreadable');
      return { segments: segments.get(id) };
    }),
  };
}
