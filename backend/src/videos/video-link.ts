import { ApiError } from '../common/errors';

/** Parse identifiers, then rebuild fixed HTTPS origins; never fetch submitted URLs. */
export function canonicalVideoLink(value: string): string {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error();
    const host = u.hostname.toLowerCase();
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
      const parts = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
      const id = host === 'youtu.be' ? parts[0] : u.pathname === '/watch' ? u.searchParams.get('v') :
        parts.length === 2 && ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : '';
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (host === 'drive.google.com') {
      const match = /^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/view|\/preview)?\/?$/.exec(u.pathname);
      const id = match?.[1] || (['/open', '/uc'].includes(u.pathname) ? u.searchParams.get('id') : '');
      if (id && /^[A-Za-z0-9_-]{10,200}$/.test(id)) return `https://drive.google.com/file/d/${id}/view`;
    }
  } catch { /* Return the same safe message for all unsupported inputs. */ }
  throw new ApiError('VALIDATION_ERROR', 'Geçerli bir HTTPS YouTube videosu veya Google Drive dosya bağlantısı girin.');
}
