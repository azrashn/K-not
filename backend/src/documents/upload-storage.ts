/**
 * Multer storage engine: streams the upload to `tmp/{uuid}` on the storage volume while
 * computing SHA-256 and capturing the first bytes for the `%PDF-` magic check
 * (data-model.md §4 step 1). The file is never buffered in memory.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import type { StorageEngine } from 'multer';

import { Storage } from '../storage/storage';

export interface StoredUpload {
  tempKey: string;
  size: number;
  sha256: string;
  magicOk: boolean;
  originalname: string;
}

const PDF_MAGIC = Buffer.from('%PDF-');

export class HashingTempStorage implements StorageEngine {
  constructor(private readonly storage: Storage) {}

  _handleFile(_req: Request, file: Express.Multer.File, cb: (error?: any, info?: Partial<Express.Multer.File>) => void): void {
    this.storage.createTemp().then(({ key, stream: out }) => {
      const hash = createHash('sha256');
      let size = 0;
      let head = Buffer.alloc(0);
      let done = false;
      const finish = (err?: unknown, info?: Partial<StoredUpload>) => {
        if (done) return;
        done = true;
        if (err) {
          out.destroy();
          this.storage.delete(key).finally(() => cb(err));
        } else {
          cb(null, info as unknown as Partial<Express.Multer.File>);
        }
      };
      file.stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        hash.update(chunk);
        if (head.length < PDF_MAGIC.length) head = Buffer.concat([head, chunk]).subarray(0, PDF_MAGIC.length);
      });
      // Size limit hit: multer reports LIMIT_FILE_SIZE; make sure the partial file is removed.
      file.stream.on('limit', () => {
        out.destroy();
        void this.storage.delete(key);
      });
      file.stream.on('error', (e: unknown) => finish(e));
      out.on('error', (e) => finish(e));
      out.on('finish', () => finish(undefined, {
        tempKey: key, size, sha256: hash.digest('hex'), magicOk: head.equals(PDF_MAGIC), originalname: file.originalname,
      }));
      file.stream.pipe(out);
    }, cb);
  }

  _removeFile(_req: Request, file: Express.Multer.File & Partial<StoredUpload>, cb: (error: Error | null) => void): void {
    if (!file.tempKey) return cb(null);
    this.storage.delete(file.tempKey).then(() => cb(null), (e) => cb(e));
  }
}
