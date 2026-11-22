from knot_rag import quiz_engine as qe


def _src(text):
    return [{"source": {"id": "s1"}, "text": text}]


def test_slide_footer_is_never_numbered():
    text = (
        "Additional Chapter 5 slides\n\nNetwork Layer: 5-119\n\n"
        "The network layer moves segments from the sending host to the receiving host across routers."
    )
    sentences = qe.number_sentences(_src(text))
    reads = [s["read"] for s in sentences]
    assert not any("5-119" in r for r in reads)
    assert any("moves segments" in r for r in reads)


def test_page_furniture_detector():
    assert qe.is_page_furniture("Network Layer: 5-119")
    assert qe.is_page_furniture("5-119")
    assert not qe.is_page_furniture("UDP adds only multiplexing and a checksum to the services of IP.")
