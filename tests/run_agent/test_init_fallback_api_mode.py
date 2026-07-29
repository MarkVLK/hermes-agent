"""Regression test for #46527: the init-time fallback path (#17929) must
recompute ``api_mode`` for the fallback provider/model instead of inheriting it
from the (unreachable) primary.

Concretely: a primary configured as ``provider: nous`` with an explicit
``api_mode: codex_responses`` (required for Nous-served GPT-5.x reasoning
models) that has no usable credentials at init time falls back to
``provider: copilot`` / ``model: gpt-5-mini``.  Copilot's ``gpt-5-mini`` is the
documented exception that uses Chat Completions, not the Responses API (see
``tests/hermes_cli/test_model_switch_copilot_api_mode.py``).  Before the fix,
``agent.api_mode`` stayed ``"codex_responses"`` after the fallback activated,
so every request for the fallback model went out via the Responses API and
silently returned no reasoning/thinking content.
"""
from unittest.mock import MagicMock, patch

from run_agent import AIAgent


def _make_tool_defs():
    return [{"type": "function", "function": {"name": "web_search",
             "description": "search", "parameters": {"type": "object", "properties": {}}}}]


def _mock_client(api_key="fb-key-1234567890", base_url="https://api.githubcopilot.com"):
    c = MagicMock()
    c.api_key = api_key
    c.base_url = base_url
    c._default_headers = None
    return c


def _build_agent(fallback, resolver):
    with patch("agent.auxiliary_client.resolve_provider_client", side_effect=resolver), \
         patch("run_agent.get_tool_definitions", return_value=_make_tool_defs()), \
         patch("run_agent.check_toolset_requirements", return_value={}), \
         patch("run_agent.OpenAI", return_value=MagicMock()):
        return AIAgent(
            provider="nous",
            model="gpt-5.4-mini",
            api_mode="codex_responses",
            api_key=None,
            base_url=None,
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
            fallback_model=[fallback],
        )


def test_init_fallback_recomputes_api_mode_for_copilot_gpt5_mini():
    """Nous primary (api_mode=codex_responses, no creds) -> Copilot gpt-5-mini
    fallback must end up with api_mode=chat_completions, not codex_responses."""
    fb_client = _mock_client()

    def fake_resolve(provider, model=None, raw_codex=False,
                     explicit_base_url=None, explicit_api_key=None):
        if provider == "copilot":
            return fb_client, "gpt-5-mini"
        return None, None  # primary (nous) has no usable credentials

    agent = _build_agent({"provider": "copilot", "model": "gpt-5-mini"}, fake_resolve)

    assert agent.provider == "copilot"
    assert agent.model == "gpt-5-mini"
    assert agent._fallback_activated is True
    assert agent.api_mode == "chat_completions"


def test_init_fallback_keeps_codex_responses_for_openai_codex():
    """Nous primary (api_mode=codex_responses, no creds) -> openai-codex
    fallback must keep api_mode=codex_responses (openai-codex always uses the
    Responses API)."""
    fb_client = _mock_client(base_url="https://chatgpt.com/backend-api/codex")

    def fake_resolve(provider, model=None, raw_codex=False,
                     explicit_base_url=None, explicit_api_key=None):
        if provider == "openai-codex":
            return fb_client, "gpt-5.4-mini"
        return None, None

    agent = _build_agent({"provider": "openai-codex", "model": "gpt-5.4-mini"}, fake_resolve)

    assert agent.provider == "openai-codex"
    assert agent.model == "gpt-5.4-mini"
    assert agent._fallback_activated is True
    assert agent.api_mode == "codex_responses"


def test_init_fallback_preserves_native_anthropic_host():
    """The init-time path shares ``resolve_fallback_api_mode``, so main's
    native-Anthropic host rule (#32243, #49247) must survive here too: a custom
    fallback pointed at api.anthropic.com keeps anthropic_messages rather than
    dropping to chat_completions -> POST /v1/chat/completions -> 404."""
    fb_client = _mock_client(base_url="https://api.anthropic.com")

    def fake_resolve(provider, model=None, raw_codex=False,
                     explicit_base_url=None, explicit_api_key=None):
        if provider == "cron-anthropic":
            return fb_client, "claude-opus-4.8"
        return None, None

    agent = _build_agent(
        {"provider": "cron-anthropic", "model": "claude-opus-4.8"}, fake_resolve,
    )

    assert agent.provider == "cron-anthropic"
    assert agent._fallback_activated is True
    assert agent.api_mode == "anthropic_messages"
    # Recomputing the mode is only half the job: the native-Anthropic setup
    # block runs earlier in init against the *primary's* mode, so the init-time
    # fallback has to wire the Anthropic runtime itself. Without this the turn
    # would be handed to a None client.
    assert agent._anthropic_client is not None
    assert agent._anthropic_base_url == "https://api.anthropic.com"
    assert agent._anthropic_api_key == "fb-key-1234567890"
    # Third-party / custom provider names must never borrow ANTHROPIC_TOKEN's
    # OAuth identity headers (#1739).
    assert agent._is_anthropic_oauth is False
