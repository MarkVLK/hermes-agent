"""Regression tests for ``resolve_fallback_api_mode`` (#46527).

The resolver is the extraction of the api_mode block that used to live inline
in ``try_activate_fallback``, shared with the init-time fallback path in
``agent_init.py`` so both recompute the mode for the *new* backend.

Because it is an extraction, every branch main resolves today must keep
resolving the same way.  Review feedback on #46542 caught an earlier revision
that dropped main's native-Anthropic host rule (#32243, #49247) — applying it
would have regressed custom fallbacks targeting ``api.anthropic.com`` from
``anthropic_messages`` to ``chat_completions`` -> POST /v1/chat/completions ->
404.  The Nous dual-wire branch has the same hazard.  These tests pin the full
branch table so a future extraction cannot silently lose one.
"""
from types import SimpleNamespace

import pytest

from agent.chat_completion_helpers import resolve_fallback_api_mode


def _agent(*, azure=False, direct_openai=False, requires_responses=False):
    """Minimal stand-in exposing the three agent predicates the resolver uses."""
    return SimpleNamespace(
        _is_azure_openai_url=lambda url: azure,
        _is_direct_openai_url=lambda url: direct_openai,
        _provider_model_requires_responses_api=lambda model, provider=None: requires_responses,
    )


# --- native Anthropic host (the branch the earlier revision dropped) ----------

@pytest.mark.parametrize(
    "provider, base_url",
    [
        # Custom provider name, native host, no "/anthropic" path suffix — the
        # exact shape #32243/#49247 fixed. Must NOT fall through to chat.
        ("cron-anthropic", "https://api.anthropic.com"),
        ("cron-anthropic", "https://api.anthropic.com/"),
        ("cron-anthropic", "https://api.anthropic.com/v1"),
        # The two older signals must keep working too.
        ("anthropic", "https://example.test/v1"),
        ("custom", "https://gateway.test/anthropic"),
        ("custom", "https://gateway.test/anthropic/"),
    ],
)
def test_anthropic_native_host_and_suffix_resolve_to_anthropic_messages(provider, base_url):
    assert resolve_fallback_api_mode(
        _agent(), provider, "claude-opus-4.8", base_url,
    ) == "anthropic_messages"


def test_anthropic_host_match_is_exact_not_substring():
    """A lookalike host must not be treated as native Anthropic."""
    assert resolve_fallback_api_mode(
        _agent(), "custom", "claude-opus-4.8", "https://api.anthropic.com.attacker.test/v1",
    ) == "chat_completions"


# --- Nous dual-wire branch ----------------------------------------------------

@pytest.mark.parametrize("provider", ["nous", "nous-portal", "nousresearch"])
def test_nous_providers_delegate_to_nous_api_mode(provider, monkeypatch):
    """Portal is dual-wire; the resolver must defer to ``nous_api_mode`` rather
    than guessing from the URL."""
    monkeypatch.setattr(
        "hermes_cli.providers.nous_api_mode",
        lambda model: "anthropic_messages" if str(model).startswith("anthropic/") else "chat_completions",
    )
    assert resolve_fallback_api_mode(
        _agent(), provider, "anthropic/claude-opus-4.8", "https://inference-api.nousresearch.com/v1",
    ) == "anthropic_messages"
    assert resolve_fallback_api_mode(
        _agent(), provider, "Hermes-4-405B", "https://inference-api.nousresearch.com/v1",
    ) == "chat_completions"


def test_nous_branch_runs_before_anthropic_host_match(monkeypatch):
    """Branch order is load-bearing: a Nous slot pointed at an Anthropic-looking
    URL still resolves through nous_api_mode."""
    monkeypatch.setattr("hermes_cli.providers.nous_api_mode", lambda model: "chat_completions")
    assert resolve_fallback_api_mode(
        _agent(), "nous", "Hermes-4-405B", "https://api.anthropic.com/v1",
    ) == "chat_completions"


# --- the remaining branches ---------------------------------------------------

def test_openai_codex_always_responses():
    assert resolve_fallback_api_mode(
        _agent(), "openai-codex", "gpt-5.4", "https://chatgpt.com/backend-api/codex",
    ) == "codex_responses"


def test_azure_stays_on_chat_completions_even_for_gpt5():
    """Azure OpenAI serves gpt-5.x on /chat/completions and has no Responses API."""
    assert resolve_fallback_api_mode(
        _agent(azure=True, requires_responses=True), "custom", "gpt-5.4",
        "https://acct.openai.azure.com/openai/deployments/gpt-5.4",
    ) == "chat_completions"


def test_direct_openai_url_uses_responses():
    assert resolve_fallback_api_mode(
        _agent(direct_openai=True), "openai", "gpt-5.4", "https://api.openai.com/v1",
    ) == "codex_responses"


def test_model_family_requiring_responses_uses_responses():
    assert resolve_fallback_api_mode(
        _agent(requires_responses=True), "copilot", "gpt-5.4", "https://api.githubcopilot.com",
    ) == "codex_responses"


def test_copilot_gpt5_mini_exception_stays_on_chat_completions():
    """The #46527 symptom: gpt-5-mini is chat-only, so the provider/model
    predicate says no and the fallback must land on chat_completions instead of
    inheriting codex_responses from the primary."""
    assert resolve_fallback_api_mode(
        _agent(requires_responses=False), "copilot", "gpt-5-mini", "https://api.githubcopilot.com",
    ) == "chat_completions"


@pytest.mark.parametrize(
    "provider, base_url",
    [
        ("bedrock", "https://bedrock-runtime.us-east-1.amazonaws.com"),
        ("custom", "https://bedrock-runtime.us-west-2.amazonaws.com"),
    ],
)
def test_bedrock_resolves_to_converse(provider, base_url):
    assert resolve_fallback_api_mode(
        _agent(), provider, "anthropic.claude-opus-4-5", base_url,
    ) == "bedrock_converse"


def test_unknown_provider_defaults_to_chat_completions():
    assert resolve_fallback_api_mode(
        _agent(), "openrouter", "z-ai/glm-5", "https://openrouter.ai/api/v1",
    ) == "chat_completions"
