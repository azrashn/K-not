import { DEMO_PASSWORD, demoSeed, isLocalDatabase } from '../../scripts/demo-users';

describe('demo users', () => {
  it('only runs against a database on this computer', () => {
    expect(isLocalDatabase('mysql://u:p@127.0.0.1:3306/knot')).toBe(true);
    expect(isLocalDatabase('mysql://u:p@localhost:3306/knot')).toBe(true);
    expect(isLocalDatabase('mysql://u:p@db.example.com:3306/knot')).toBe(false);
    expect(isLocalDatabase('not a url')).toBe(false);
  });

  it('gives every user the same easy password that still meets the length rule', () => {
    const out = demoSeed({ users: [{ email: 'a@x', display_name: 'A' }, { email: 'b@x', display_name: 'B', role: 'ADMIN' }], courses: [] }, DEMO_PASSWORD);
    expect(out.users.every((u) => u.password === DEMO_PASSWORD)).toBe(true);
    expect(out.users[1].role).toBe('ADMIN');
  });

  it('keeps the minimum password length', () => {
    expect(() => demoSeed({ users: [], courses: [] }, '123456')).toThrow(/at least 10/);
  });
});
