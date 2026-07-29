"""Regression tests for #46527: Copilot primary api_mode resolution must not
honor a stale/incompatible explicit ``api_mode``.

The gateway resolves and snapshots the primary provider/model at startup via
``resolve_runtime_provider`` -> ``_copilot_runtime_api_mode``.  When the config
carries a stale ``api_mode`` left over from a previous primary and the model is
later changed, the old code honored the pin verbatim in whichever direction it
happened to be stale:

* ``api_mode: codex_responses`` (e.g. from a previous Nous/Codex primary) with
  Copilot ``gpt-5-mini`` dispatched through the Responses API — which Copilot
  serves on chat completions only — and the response came back with no
  reasoning/thinking content (the symptom in #46527).
* ``api_mode: chat_completions`` left behind when the model moved up to a
  GPT-5.x slot pinned a Responses-only model to the chat wire.

The guard arbitrates in both directions against the *active target model*,
using the pure-regex Copilot family rule so no network call is needed.
"""
from hermes_cli.runtime_provider import _copilot_runtime_api_mode


# --- stale codex_responses -> chat_completions --------------------------------

def test_stale_codex_responses_vetoed_for_gpt5_mini():
    """gpt-5-mini + stale api_mode=codex_responses must resolve to chat_completions."""
    cfg = {"provider": "copilot", "default": "gpt-5-mini", "api_mode": "codex_responses"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "chat_completions"


def test_explicit_codex_responses_kept_for_gpt5_variant():
    """gpt-5.4-mini legitimately uses the Responses API on Copilot — an explicit
    codex_responses must still be honored (no over-correction)."""
    cfg = {"provider": "copilot", "default": "gpt-5.4-mini", "api_mode": "codex_responses"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "codex_responses"


def test_no_explicit_mode_derives_chat_completions_for_gpt5_mini(monkeypatch):
    """Without an explicit api_mode, gpt-5-mini derives chat_completions (unchanged)."""
    monkeypatch.setattr(
        "hermes_cli.models.copilot_model_api_mode",
        lambda model, api_key=None: "chat_completions",
    )
    cfg = {"provider": "copilot", "default": "gpt-5-mini"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "chat_completions"


def test_stale_mode_from_different_provider_not_honored(monkeypatch):
    """When the config's provider doesn't match copilot, the explicit mode is
    not honored at all (existing _provider_supports_explicit_api_mode guard),
    so gpt-5-mini still derives chat_completions."""
    monkeypatch.setattr(
        "hermes_cli.models.copilot_model_api_mode",
        lambda model, api_key=None: "chat_completions",
    )
    cfg = {"provider": "nous", "default": "gpt-5-mini", "api_mode": "codex_responses"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "chat_completions"


# --- stale chat_completions -> codex_responses (the other direction) ----------

def test_stale_chat_completions_promoted_for_gpt5_family():
    """Review feedback on #46542: the guard must not be one-directional.  A
    stale ``chat_completions`` pin on a Responses-only Copilot GPT-5.x slot was
    still accepted, so the model kept getting the wrong wire."""
    cfg = {"provider": "copilot", "default": "gpt-5.4", "api_mode": "chat_completions"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "codex_responses"


def test_explicit_chat_completions_kept_for_gpt5_mini():
    """gpt-5-mini is the documented chat-only exception — an explicit
    chat_completions stays chat_completions (no over-correction)."""
    cfg = {"provider": "copilot", "default": "gpt-5-mini", "api_mode": "chat_completions"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "chat_completions"


def test_explicit_chat_completions_kept_for_non_gpt_model():
    """Copilot's Claude/Gemini slots ride the chat endpoint — an explicit
    chat_completions must survive."""
    cfg = {"provider": "copilot", "default": "claude-opus-4.8", "api_mode": "chat_completions"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "chat_completions"


# --- arbitration uses the active target model, not the persisted default ------

def test_guard_arbitrates_against_target_model_not_stale_default():
    """The stale pin must be resolved against the model actually being resolved
    for this runtime (MoA slot / fallback / mid-session switch), matching how
    the no-pin path already derives its mode."""
    cfg = {"provider": "copilot", "default": "gpt-5.4", "api_mode": "codex_responses"}
    assert _copilot_runtime_api_mode(
        cfg, api_key="x", target_model="gpt-5-mini",
    ) == "chat_completions"

    cfg = {"provider": "copilot", "default": "gpt-5-mini", "api_mode": "chat_completions"}
    assert _copilot_runtime_api_mode(
        cfg, api_key="x", target_model="gpt-5.4",
    ) == "codex_responses"


def test_vendor_prefixed_model_id_resolves_by_family():
    """Catalog-copied ids carry a ``vendor/`` prefix; the family regex is
    anchored at ^gpt- so the prefix must be stripped before arbitration,
    otherwise every prefixed id reads as a non-GPT slot."""
    cfg = {"provider": "copilot", "default": "copilot/gpt-5.4", "api_mode": "codex_responses"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "codex_responses"


# --- modes outside the chat/Responses pair are left alone ---------------------

def test_non_wire_pair_modes_are_untouched():
    """anthropic_messages / bedrock_converse / codex_app_server are deliberate
    opt-ins the Copilot family rule says nothing about — never rewrite them."""
    for mode in ("anthropic_messages", "bedrock_converse", "codex_app_server"):
        cfg = {"provider": "copilot", "default": "gpt-5-mini", "api_mode": mode}
        assert _copilot_runtime_api_mode(cfg, api_key="x") == mode


def test_explicit_mode_without_model_name_is_kept():
    """No model to arbitrate against — the explicit pin stands."""
    cfg = {"provider": "copilot", "api_mode": "codex_responses"}
    assert _copilot_runtime_api_mode(cfg, api_key="x") == "codex_responses"
