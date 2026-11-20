"""Shared storage volume (`STORAGE_ROOT`). Originals are read-only; page artifacts are
written atomically (temp file → fsync → rename)."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath, PureWindowsPath


class UnsafeStorageKey(ValueError):
    """The key is absolute, contains `..`, or resolves outside STORAGE_ROOT."""


def pages_artifact_key(document_id: str, indexing_version: str) -> str:
    return f"documents/{document_id}/pages.{indexing_version}.json"


class LocalStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()

    def resolve(self, key: str) -> Path:
        if not key or "\x00" in key or "\\" in key:
            raise UnsafeStorageKey("storage_key is empty or contains forbidden characters")
        if PurePosixPath(key).is_absolute() or PureWindowsPath(key).is_absolute() or PureWindowsPath(key).drive:
            raise UnsafeStorageKey("storage_key must be relative")
        if any(p in ("..", ".", "") for p in key.split("/")):  # raw split: Path() would hide "//" and "./"
            raise UnsafeStorageKey("storage_key must not contain '.' or '..' segments")
        path = (self.root / key).resolve()  # follows symlinks
        if path != self.root and self.root not in path.parents:
            raise UnsafeStorageKey("storage_key resolves outside STORAGE_ROOT")
        return path

    def read_bytes(self, key: str) -> bytes:
        return self.resolve(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self.resolve(key).is_file()

    def write_atomic(self, key: str, data: bytes) -> None:
        path = self.resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
        try:  # make the rename itself durable
            dir_fd = os.open(path.parent, os.O_RDONLY)
        except OSError:
            return
        try:
            os.fsync(dir_fd)
        except OSError:
            pass
        finally:
            os.close(dir_fd)
