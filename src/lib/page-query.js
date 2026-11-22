// What a page keeps in its address after "?" ("#/dersler/c/sinavlar?exam=…", "#/dersler/c/quiz?set=…&q=…"),
// so going to another page and back, or a reload, opens the same thing again. The route itself ignores the
// query (app/store parseHash).

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/** One id from the hash query, or null (anything that is not a plain id is ignored). */
export function hashParam(hash, key) {
  const query = String(hash || '').split('?')[1];
  if (!query) return null;
  const value = new URLSearchParams(query).get(key);
  return value && ID.test(value) ? value : null;
}

/** `base` ("#/dersler/c/quiz") with the given params; empty values are left out. */
export function hashWith(base, params = {}) {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
  return query ? `${base}?${query}` : base;
}

/** Writes the params into the address without a new history entry or a route change (the page stays
 *  mounted). Only while the address is on `base`: on another page the address is left alone. */
export function rememberInHash(base, params = {}) {
  if (typeof window === 'undefined') return;
  if (window.location.hash.split('?')[0] !== base) return;
  const next = hashWith(base, params);
  if (window.location.hash !== next) window.history.replaceState(window.history.state, '', next);
}
