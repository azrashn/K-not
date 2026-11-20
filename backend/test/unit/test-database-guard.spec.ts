import { requireTestDatabase, truncateAll } from '../support/db';
test('test database boundary rejects development and unrelated database names', () => {
  expect(requireTestDatabase('mysql://test@localhost/knot_test_w1')).toBe('knot_test_w1');
  for (const name of ['knot_dev', 'mysql', 'opentutor', 'knot_test_w1;DROP TABLE User', 'knot_test_wx']) {
    expect(() => requireTestDatabase(`mysql://test@localhost/${name}`)).toThrow('Refusing');
  }
});
test('cleanup refuses a client that was not made by the test DB factory', async () => {
  await expect(truncateAll({} as any)).rejects.toThrow('non-test');
});
