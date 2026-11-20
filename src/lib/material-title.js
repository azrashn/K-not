// Kullanıcıya gösterilen materyal adı: dosya uzantısı (.mp4, .pdf, .pptx...) bilgi vermez, gizlenir.
// Tam ad (uzantılı) `title` özniteliğinde ve video ilerlemesi bölümünde durur.
export function displayTitle(name) {
  return String(name || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
