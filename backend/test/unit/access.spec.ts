/** The visibility/ownership matrix of api-contracts.md §5. */
import type { AuthUser } from '../../src/common/request-context';
import { AccessService } from '../../src/courses/access.service';

const owner: AuthUser = { id: 'u-owner', role: 'USER' };
const other: AuthUser = { id: 'u-other', role: 'USER' };
const admin: AuthUser = { id: 'u-admin', role: 'ADMIN' };
const doc = (visibility: 'PRIVATE' | 'COURSE', deleted = false) => ({ visibility, ownerId: owner.id, deletedAt: deleted ? new Date() : null });

test.each([
  // [who, membership, visibility, canView, canManage]
  [owner, 'STUDENT', 'PRIVATE', true, true],
  [owner, null, 'PRIVATE', false, false],
  [other, 'STUDENT', 'PRIVATE', false, false],
  [other, 'INSTRUCTOR', 'PRIVATE', false, false],
  [admin, null, 'PRIVATE', false, true],
  [other, 'STUDENT', 'COURSE', true, false],
  [other, 'INSTRUCTOR', 'COURSE', true, true],
  [other, null, 'COURSE', false, false],
  [admin, null, 'COURSE', true, true],
  [owner, 'INSTRUCTOR', 'COURSE', true, true],
] as const)('%o member=%s %s → view=%s manage=%s', (user, membership, visibility, view, manage) => {
  expect(AccessService.canView(user, doc(visibility), membership)).toBe(view);
  expect(AccessService.canManage(user, doc(visibility), membership)).toBe(manage);
});

test('deleted documents are invisible and unmanageable for everyone', () => {
  for (const u of [owner, other, admin]) {
    expect(AccessService.canView(u, doc('COURSE', true), 'INSTRUCTOR')).toBe(false);
    expect(AccessService.canManage(u, doc('COURSE', true), 'INSTRUCTOR')).toBe(false);
  }
});
