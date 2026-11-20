/**
 * Storage abstraction (module-boundaries.md §1, data-model.md §1). The local implementation
 * uses the volume shared with the Python service (`STORAGE_ROOT`). Keys are relative POSIX
 * paths; the same safety rules as WBS-2 apply (no absolute paths, no `.`/`..`, no escaping
 * the root through symlinks).
 */
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs, ReadStream, WriteStream } from 'node:fs';
import * as path from 'node:path';

import { APP_CONFIG, AppConfig } from '../config/config';

export class UnsafeStorageKey extends Error {}

export const originalKey = (documentId: string) => `documents/${documentId}/original.pdf`;
export const pagesKey = (documentId: string, indexingVersion: string) =>
  `documents/${documentId}/pages.${indexingVersion}.json`;
export const documentPrefix = (documentId: string) => `documents/${documentId}`;

export abstract class Storage {
  abstract createTemp(): Promise<{ key: string; stream: WriteStream }>;
  abstract move(fromKey: string, toKey: string): Promise<void>;
  abstract openRead(key: string): Promise<ReadStream>;
  abstract readText(key: string): Promise<string | null>;
  abstract exists(key: string): Promise<boolean>;
  abstract delete(key: string): Promise<void>;
  abstract deletePrefix(prefix: string): Promise<void>;
}

@Injectable()
export class LocalStorage extends Storage {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.root = path.resolve(config.storageRoot);
  }

  resolve(key: string): string {
    if (!key || key.includes('\0') || key.includes('\\') || path.posix.isAbsolute(key) || /^[A-Za-z]:/.test(key)) {
      throw new UnsafeStorageKey('unsafe storage key');
    }
    if (key.split('/').some((p) => p === '' || p === '.' || p === '..')) throw new UnsafeStorageKey('unsafe storage key');
    const full = path.resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new UnsafeStorageKey('unsafe storage key');
    return full;
  }

  private async realInsideRoot(full: string): Promise<void> {
    const real = await fs.realpath(full);
    const rootReal = await fs.realpath(this.root);
    if (real !== rootReal && !real.startsWith(rootReal + path.sep)) throw new UnsafeStorageKey('unsafe storage key');
  }

  async createTemp(): Promise<{ key: string; stream: WriteStream }> {
    const key = `tmp/${randomUUID()}`;
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    return { key, stream: createWriteStream(full, { flags: 'wx', mode: 0o640 }) };
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    const to = this.resolve(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(this.resolve(fromKey), to); // same volume: atomic
  }

  async openRead(key: string): Promise<ReadStream> {
    const full = this.resolve(key);
    await this.realInsideRoot(full);
    return createReadStream(full);
  }

  async readText(key: string): Promise<string | null> {
    const full = this.resolve(key);
    try {
      await this.realInsideRoot(full);
      return await fs.readFile(full, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await fs.rm(this.resolve(prefix), { recursive: true, force: true });
  }
}
