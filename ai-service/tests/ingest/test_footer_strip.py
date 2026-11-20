from knot_ingest.extraction import strip_repeated_footers


def test_repeated_last_line_is_removed_even_with_changing_page_numbers():
    pages = [f"Topic {i}\n- point {i}\nTransport Layer 3-{i}" for i in range(1, 6)]
    out = strip_repeated_footers(pages)
    assert all("Transport Layer" not in p for p in out)
    assert out[0] == "Topic 1\n- point 1"


def test_unique_last_lines_are_kept():
    pages = [f"Heading {i}\nbody text number {i}\nconclusion sentence {'x' * i}" for i in range(1, 6)]
    assert strip_repeated_footers(pages) == pages


def test_short_documents_are_untouched():
    pages = ["A\nfooter 1", "B\nfooter 2"]
    assert strip_repeated_footers(pages) == pages


def test_single_line_pages_never_become_empty():
    pages = ["Transport Layer 3"] * 5
    assert strip_repeated_footers(pages) == pages
