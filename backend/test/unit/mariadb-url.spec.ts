import { mariaDbUrl } from '../../src/prisma/prisma.service';

describe('mariaDbUrl', () => {
  it('switches the scheme the driver expects', () => {
    expect(mariaDbUrl('mysql://u:p@db.example.com:3306/app')).toBe('mariadb://u:p@db.example.com:3306/app');
  });

  it.each(['127.0.0.1', 'localhost', '[::1]'])('allows the public-key login on loopback %s', (host) => {
    expect(mariaDbUrl(`mysql://u:p@${host}:3306/app`)).toContain('allowPublicKeyRetrieval=true');
  });

  it('never enables it for a remote host', () => {
    expect(mariaDbUrl('mysql://u:p@db.example.com:3306/app')).not.toContain('allowPublicKeyRetrieval');
  });

  it('respects an explicit choice in the URL', () => {
    expect(mariaDbUrl('mysql://u:p@127.0.0.1:3306/app?allowPublicKeyRetrieval=false')).toContain('allowPublicKeyRetrieval=false');
  });

  it('keeps special characters of the password intact', () => {
    const out = mariaDbUrl('mysql://u:p%40ss%2Fw@127.0.0.1:3306/app');
    expect(new URL(out).password).toBe('p%40ss%2Fw');
  });

  it('returns a malformed URL unchanged apart from the scheme', () => {
    expect(mariaDbUrl('mysql://not a url')).toBe('mariadb://not a url');
  });
});
