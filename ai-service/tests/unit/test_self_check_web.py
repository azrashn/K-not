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
