"""LLM provider configuration.

Port of ``src/llm-config.js``. The provider is selected from
``LLM_PROVIDER`` (defaults to ``tokenrouter``); the model can be
overridden via ``LLM_MODEL``.
"""

from __future__ import annotations

import os
from types import MappingProxyType


PROVIDERS: MappingProxyType = MappingProxyType({
    "tokenrouter": {
        "base_url": "https://api.tokenrouter.com/v1/chat/completions",
        "model": "MiniMax-M3",
        "api_key_env": "TOKENROUTER_API_KEY",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1/chat/completions",
        "model": "deepseek/deepseek-v4-flash",
        "api_key_env": "OPENROUTER_API_KEY",
    },
})


active_provider = os.environ.get("LLM_PROVIDER", "tokenrouter")
_config = PROVIDERS.get(active_provider)
if _config is None:
    raise RuntimeError(
        f"Unknown LLM_PROVIDER {active_provider!r}. "
        f"Valid: {', '.join(PROVIDERS.keys())}"
    )


def _resolve(name: str):
    return os.environ.get(name, _config[name])


base_url: str = _config["base_url"]
model: str = os.environ.get("LLM_MODEL", _config["model"])
api_key_env: str = _config["api_key_env"]
provider_name: str = active_provider
api_key: str = os.environ.get(api_key_env, "")
