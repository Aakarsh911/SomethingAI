import { AnthropicModel } from "@/lib/ai/llm/anthropic";
import { GeminiModel } from "@/lib/ai/llm/gemini";
import {
  LLMConfigError,
  type LanguageModel,
  type ProviderSettings,
} from "@/lib/ai/llm/language-model";
import { OpenAICompatibleModel, OpenAIModel } from "@/lib/ai/llm/openai";

export * from "@/lib/ai/llm/language-model";

type Env = Record<string, string | undefined>;

type ProviderSpec = {
  /** Provider-specific key variable, read when LLM_API_KEY is unset. */
  keyEnv?: string;
  defaultModel?: string;
  /** Pre-LLM_* variable names, honoured so existing .env files keep working. */
  legacy?: { model: string; baseURL: string };
  requiresKey: boolean;
  requiresBaseURL?: boolean;
  create: (settings: ProviderSettings) => LanguageModel;
};

/** Every supported provider. Adding one is a class plus an entry here. */
const PROVIDERS: Record<string, ProviderSpec> = {
  openai: {
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-5.5",
    legacy: { model: "OPENAI_MODEL", baseURL: "OPENAI_BASE_URL" },
    requiresKey: true,
    create: (settings) => new OpenAIModel(settings),
  },
  anthropic: {
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-5-5",
    requiresKey: true,
    create: (settings) => new AnthropicModel(settings),
  },
  gemini: {
    keyEnv: "GEMINI_API_KEY",
    requiresKey: true,
    create: (settings) => new GeminiModel(settings),
  },
  "openai-compatible": {
    requiresKey: false,
    requiresBaseURL: true,
    create: (settings) => new OpenAICompatibleModel(settings),
  },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/**
 * Builds the model that designs workflows from the environment:
 * LLM_PROVIDER (default "openai"), LLM_API_KEY, LLM_MODEL and LLM_BASE_URL.
 * A bigger model trades cost and latency, both felt directly in the chat.
 */
export function createLanguageModel(env: Env = process.env): LanguageModel {
  const name = (env.LLM_PROVIDER || "openai").trim().toLowerCase();
  const spec = PROVIDERS[name];
  if (!spec) {
    throw new LLMConfigError(
      `Unknown LLM_PROVIDER "${name}". Use one of: ${PROVIDER_NAMES.join(", ")}.`,
    );
  }

  const apiKey = env.LLM_API_KEY || (spec.keyEnv ? env[spec.keyEnv] : undefined) || "";
  if (spec.requiresKey && !apiKey) {
    throw new LLMConfigError(
      `LLM_API_KEY${spec.keyEnv ? ` (or ${spec.keyEnv})` : ""} is not set.`,
    );
  }

  const model =
    env.LLM_MODEL || (spec.legacy ? env[spec.legacy.model] : undefined) || spec.defaultModel;
  if (!model) {
    throw new LLMConfigError(`LLM_MODEL is not set, and ${name} has no default model.`);
  }

  const baseURL =
    env.LLM_BASE_URL || (spec.legacy ? env[spec.legacy.baseURL] : undefined) || undefined;
  if (spec.requiresBaseURL && !baseURL) {
    throw new LLMConfigError(`LLM_BASE_URL is required for ${name}.`);
  }

  return spec.create({ apiKey, model, baseURL });
}
