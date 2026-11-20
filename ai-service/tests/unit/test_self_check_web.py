import httpx

from knot_rag.self_check_web import _query, web_check

EXTRACT = ("TCP slow start is an algorithm. The congestion window starts at one maximum segment size and doubles every round trip "
           "time until the first loss event. After a loss the sender enters congestion avoidance.")


def fake(responses):
    calls = []

    def fetch(url, params):
        calls.append((url, dict(params)))
        return responses[len(calls) - 1]

    fetch.calls = calls
    return fetch


def test_found_keeps_the_site_url_and_quote_and_sends_only_the_claim_words():
    fetch = fake([{"query": {"search": [{"title": "TCP congestion control"}]}},
                  {"query": {"pages": {"1": {"title": "TCP congestion control", "extract": EXTRACT}}}}])
    r = web_check("TCP slow start begins with a congestion window of one maximum segment size and doubles it every round trip time.", fetch)
    assert r["status"] == "FOUND"
    assert r["sources"][0]["url"] == "https://en.wikipedia.org/wiki/TCP_congestion_control"
    assert r["sources"][0]["site"] == "en.wikipedia.org" and r["sources"][0]["quote"]
    assert fetch.calls[0][0].startswith("https://en.wikipedia.org/")
    assert "TCP" in fetch.calls[0][1]["srsearch"] and "course" not in fetch.calls[0][1]["srsearch"].lower()


def test_turkish_claim_asks_turkish_wikipedia_and_unrelated_text_is_not_found():
    fetch = fake([{"query": {"search": [{"title": "Kuantum"}]}},
                  {"query": {"pages": {"1": {"title": "Kuantum", "extract": "Kuantum fiziği atom altı parçacıkları inceler ve dalga işlevi ile anlatılır."}}}}])
    r = web_check("TCP her segmenti AES ile şifreler ve yeniden gönderir.", fetch)
    assert fetch.calls[0][0].startswith("https://tr.wikipedia.org/")
    assert r == {"status": "NOT_FOUND", "sources": []}


def test_network_failure_is_unavailable_never_found():
    def boom(url, params):
        raise httpx.ConnectError("no network")

    assert web_check("TCP uses a three-way handshake to open a connection.", boom) == {"status": "UNAVAILABLE", "sources": []}
    assert web_check("TCP uses a three-way handshake to open a connection.", fake([{"query": {"search": []}}])) == {"status": "NOT_FOUND", "sources": []}


def test_switch_off(monkeypatch):
    monkeypatch.setenv("SELF_CHECK_WEB", "off")
    assert web_check("TCP uses a three-way handshake.", fake([]))["status"] == "UNAVAILABLE"


def test_query_prefers_acronyms_and_long_words():
    assert _query("TCP uses a three-way handshake to open a connection").split()[0] == "TCP"


def test_the_client_identifies_itself_as_a_bot_without_personal_data():
    from knot_rag.self_check_web import USER_AGENT

    assert "compatible" in USER_AGENT and "Knot" in USER_AGENT
    assert "@" not in USER_AGENT  # no e-mail, no names


def test_the_relevant_part_of_a_long_article_is_found_not_only_its_lead():
    lead = "Transport Layer Security is a cryptographic protocol. " * 30
    filler = ("The history of the protocol covers many versions and many working groups over the years. " * 20 + "\n") * 8
    deep = "After the handshake both sides encrypt the connection using a symmetric session key derived from the shared secret.\n"
    long_text = lead + "\n" + filler + deep + filler
    assert len(long_text) > 6000 and long_text.index("symmetric session key") > 1200
    fetch = fake([{"query": {"search": [{"title": "Transport Layer Security"}]}},
                  {"query": {"pages": {"1": {"title": "Transport Layer Security", "extract": long_text}}}}])
    r = web_check("TLS encrypts the connection using a symmetric session key.", fetch)
    assert r["status"] == "FOUND" and "symmetric session key" in r["sources"][0]["quote"]
    # the page request asks for the whole article: `exchars` would cap it at 1200 characters
    assert "exchars" not in fetch.calls[1][1]
