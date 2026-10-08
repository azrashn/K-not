import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { _scrubForTest } from '../../src/common/logging';
import { newId } from '../../src/common/ids';
import { RateLimiter } from '../../src/common/rate-limit';
import { IDENTIFIER } from '../../src/common/validation';
import type { AppConfig } from '../../src/config/config';
import { documentDto, MESSAGE_TR } from '../../src/documents/document-dto';
import { sanitizeFilename } from '../../src/documents/documents.service';
import { LocalStorage, UnsafeStorageKey } from '../../src/storage/storage';

test('ids are unique, cuid-shaped and valid WBS-3 Identifiers', () => {
  const ids = new Set(Array.from({ length: 5000 }, newId));
  expect(ids.size).toBe(5000);
  for (const id of ids) expect(id).toMatch(/^c[0-9a-z]{24}$/);
  expect(IDENTIFIER.test(newId())).toBe(true);
});

test('rate limiter: fixed window per key', () => {
  let now = 0;
  const rl = new RateLimiter(2, 60_000, () => now);
  expect([rl.take('a'), rl.take('a'), rl.take('a'), rl.take('b')]).toEqual([true, true, false, true]);
  now = 60_000;
  expect(rl.take('a')).toBe(true);
});

test('log scrubbing redacts sensitive keys at any depth', () => {
  expect(_scrubForTest({ event: 'x', password: 'p', nested: { token: 't', question: 'q', text: 'doc' }, ok: 1 }))
    .toEqual({ event: 'x', password: '[redacted]', nested: { token: '[redacted]', question: '[redacted]', text: '[redacted]' }, ok: 1 });
});

test('file names: path components and control characters are removed, length is bounded', () => {
  expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
  expect(sanitizeFilename('C:\\Users\\a\\Ders Notu ç.pdf')).toBe('Ders Notu ç.pdf');
  expect(sanitizeFilename('a\u0000b\u001fc.pdf')).toBe('abc.pdf');
  expect(sanitizeFilename('x'.repeat(400) + '.pdf')).toHaveLength(255);
  expect(sanitizeFilename('')).toBe('document.pdf');
});

test('storage keys cannot escape the root', () => {
  const s = new LocalStorage({ storageRoot: mkdtempSync(path.join(tmpdir(), 'st-')) } as AppConfig);
  for (const k of ['../x', '/etc/passwd', 'a//b', './a', 'a/../../b', 'C:/x', 'a\\b', '', 'a\u0000b']) {
    expect(() => s.resolve(k)).toThrow(UnsafeStorageKey);
  }
  expect(s.resolve('documents/d/original.pdf').endsWith(path.join('documents', 'd', 'original.pdf'))).toBe(true);
});

test('status mapping and Turkish messages follow document-contract.md §9 / lifecycle §5', () => {
  const base = { id: 'd', courseId: 'c', ownerId: 'o', visibility: 'COURSE', documentType: 'slide', title: 't', originalFilename: 'f.pdf',
    mimeType: 'application/pdf', sizeBytes: 1, pageCount: null, createdAt: new Date(0), updatedAt: new Date(0), errorCode: null, errorRetryable: null } as never;
  const ui = (status: string) => documentDto({ ...(base as object), status } as never, { canDelete: false }).status.ui_state;
  expect(['UPLOADED', 'EXTRACTING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED'].map(ui))
    .toEqual(['uploaded', 'reading', 'preparing', 'preparing', 'preparing', 'ready', 'error']);
  const failed = documentDto({ ...(base as object), status: 'FAILED', errorCode: 'ENCRYPTED_PDF', errorRetryable: false } as never, { canDelete: true });
  expect(failed.status.error).toEqual({ code: 'ENCRYPTED_PDF', message_tr: MESSAGE_TR.ENCRYPTED_PDF, retryable: false });
  for (const code of ['SOURCE_NOT_FOUND', 'SOURCE_CHECKSUM_MISMATCH', 'UNSUPPORTED_FORMAT', 'ENCRYPTED_PDF', 'CORRUPT_PDF', 'NO_TEXT_LAYER',
    'EMPTY_DOCUMENT', 'TOO_LARGE', 'UNSUPPORTED_INDEXING_VERSION', 'INDEX_CONFIG_MISMATCH', 'EMBEDDING_FAILED', 'INDEX_UNAVAILABLE',
    'VERIFICATION_FAILED', 'STORAGE_WRITE_FAILED', 'STALLED', 'WORKER_SHUTDOWN', 'INTERNAL']) {
    expect(MESSAGE_TR[code]).toBeTruthy();
  }
});
