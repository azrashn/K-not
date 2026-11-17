import json

import httpx
import pytest

from knot_rag.generation.providers import (
    LLMRequest,
    OpenAICompatibleProvider,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)

REQ = LLMRequest(system="s", user="u", timeout_seconds=1.0)


def provider(handler, key="sk-test"):
    return OpenAICompatibleProvider("http://llm.local/v1", "test-model", key, client=httpx.Client(transport=httpx.MockTransport(handler)))


def ok(content="{}", finish="stop"):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": finish}]})


def test_sends_openai_compatible_body():
    seen = {}

    def h(req):
        seen["url"] = str(req.url)
        seen["auth"] = req.headers.get("authorization")
        seen["body"] = json.loads(req.content)
        return ok('{"status":"insufficient"}')

    out = provider(h).complete(REQ)
    assert out.text == '{"status":"insufficient"}'
    assert seen["url"] == "http://llm.local/v1/chat/completions"
    assert seen["auth"] == "Bearer sk-test"
    assert seen["body"]["model"] == "test-model"
    assert seen["body"]["response_format"] == {"type": "json_object"}
    assert [m["role"] for m in seen["body"]["messages"]] == ["system", "user"]


def test_no_auth_header_without_key():
    def h(req):
        assert "authorization" not in req.headers
        return ok()

    provider(h, key="").complete(REQ)


@pytest.mark.parametrize(
    "status,exc",
    [(401, ProviderAuthError), (403, ProviderAuthError), (429, ProviderRateLimitError), (500, ProviderUnavailableError), (400, ProviderError)],
)
def test_http_errors_are_classified(status, exc):
    with pytest.raises(exc):
        provider(lambda r: httpx.Response(status, json={})).complete(REQ)


def test_timeout_and_connection_errors():
    def timeout(r):
        raise httpx.ReadTimeout("slow", request=r)

    def down(r):
        raise httpx.ConnectError("refused", request=r)

    with pytest.raises(ProviderTimeoutError):
        provider(timeout).complete(REQ)
    with pytest.raises(ProviderUnavailableError):
        provider(down).complete(REQ)


@pytest.mark.parametrize("resp", [httpx.Response(200, text="<html>"), httpx.Response(200, json={"choices": []}), ok(""), ok("{}", finish="length")])
def test_unusable_responses(resp):
    with pytest.raises(ProviderResponseError):
        provider(lambda r: resp).complete(REQ)


SCHEMA_REQ = LLMRequest(system="s", user="u", timeout_seconds=1.0, json_mode=True, response_schema={"type": "object", "properties": {}})


@pytest.mark.parametrize("status", [400, 422, 500, 501])
def test_a_rejected_json_schema_is_retried_once_as_plain_json_mode(status):
    formats = []

    def h(req):
        fmt = json.loads(req.content)["response_format"]["type"]
        formats.append(fmt)
        return httpx.Response(status, json={"error": "cannot build grammar"}) if fmt == "json_schema" else ok('{"claims":[]}')

    assert provider(h).complete(SCHEMA_REQ).text == '{"claims":[]}'
    assert formats == ["json_schema", "json_object"]


def test_the_plain_json_retry_is_not_endless_and_still_reports_the_failure():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(500)

    with pytest.raises(ProviderUnavailableError):
        provider(h).complete(SCHEMA_REQ)
    assert len(calls) == 2


def test_requests_without_a_schema_are_never_retried():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(500)

    with pytest.raises(ProviderUnavailableError):
        provider(h).complete(REQ)
    assert len(calls) == 1
