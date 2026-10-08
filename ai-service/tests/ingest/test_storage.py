"""T10 (storage_key safety) and atomic artifact writes."""

import os

import pytest

from knot_ingest.storage import LocalStorage, UnsafeStorageKey, pages_artifact_key


@pytest.fixture
def storage(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    return LocalStorage(root)


@pytest.mark.parametrize("key", [
    "../outside.pdf", "documents/../../outside.pdf", "/etc/passwd", "C:\\Windows\\x.pdf", "C:/x.pdf",
    "documents\\x.pdf", "", "documents//x.pdf", "./documents/x.pdf", "documents/x.pdf\x00.txt",
])
def test_unsafe_keys_are_rejected(storage, key):
    with pytest.raises(UnsafeStorageKey):
        storage.resolve(key)


def test_symlink_leaving_the_root_is_rejected(storage, tmp_path):
    outside = tmp_path / "secret"
    outside.mkdir()
    (outside / "x.pdf").write_bytes(b"%PDF-")
    os.symlink(outside, storage.root / "documents")
    with pytest.raises(UnsafeStorageKey):
        storage.resolve("documents/x.pdf")


def test_valid_key_resolves_inside_the_root(storage):
    assert storage.resolve("documents/d1/original.pdf") == storage.root / "documents/d1/original.pdf"
    assert pages_artifact_key("d1", "c1") == "documents/d1/pages.c1.json"


def test_atomic_write_leaves_no_temp_file(storage):
    storage.write_atomic("documents/d1/pages.c1.json", b'{"a":1}')
    storage.write_atomic("documents/d1/pages.c1.json", b'{"a":2}')
    folder = storage.root / "documents/d1"
    assert sorted(p.name for p in folder.iterdir()) == ["pages.c1.json"]
    assert (folder / "pages.c1.json").read_bytes() == b'{"a":2}'
