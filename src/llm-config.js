import createLogger from "./logger.js";

const log = createLogger("llm-config");

const PROVIDERS = {
  tokenrouter: {
    baseUrl: "https://api.tokenrouter.com/v1/chat/completions",
    model: "MiniMax-M3",
    apiKeyEnv: "TOKENROUTER_API_KEY",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    model: "deepseek/deepseek-v4-flash",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
};

const activeProvider = process.env.LLM_PROVIDER || "tokenrouter";

const config = PROVIDERS[activeProvider];

if (!config) {
  throw new Error(`Unknown LLM_PROVIDER "${activeProvider}". Valid: ${Object.keys(PROVIDERS).join(", ")}`);
}

export const baseUrl = config.baseUrl;
export const model = process.env.LLM_MODEL || config.model;
export const apiKeyEnv = config.apiKeyEnv;
export const providerName = activeProvider;

log.info("provider configured", { provider: activeProvider, model, baseUrl: config.baseUrl });
