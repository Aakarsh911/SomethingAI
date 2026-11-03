import OpenAI from "openai";
import { zodResponseFormat, zodTextFormat } from "openai/helpers/zod";
import {
  BaseLanguageModel,
  LLMConfigError,
  LLMResponseError,
  type LanguageModel,
  type ObjectRequest,
  type ProviderSettings,
} from "@/lib/ai/llm/language-model";

export * from "@/lib/ai/llm/language-model";

/*
 * Every provider lives in this file. To add one, write a class extending
 * BaseLanguageModel and register it in PROVIDERS at the bottom.
 */

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** OpenAI itself, through the Responses API with strict Structured Outputs. */
export class OpenAIModel extends BaseLanguageModel {
  readonly provider = "openai";
  private readonly client: OpenAI;

  constructor(settings: ProviderSettings) {
    super(settings);
    this.client = new OpenAI({ apiKey: settings.apiKey, baseURL: settings.baseURL });
  }

  protected async requestObject<T>(request: ObjectRequest<T>): Promise<unknown> {
    const response = await this.client.responses.parse({
      model: this.model,
      input: [{ role: "system", content: request.system }, ...request.messages],
      text: { format: zodTextFormat(request.schema, request.name) },
    });
    return response.output_parsed;
  }
}

/**
 * Any server that speaks OpenAI's Chat Completions API: OpenRouter, Groq,
 * Together, DeepSeek, vLLM, Ollama and the like. Needs LLM_BASE_URL.
 */
export class OpenAICompatibleModel extends BaseLanguageModel {
  readonly provider = "openai-compatible";
  private readonly client: OpenAI;

  constructor(settings: ProviderSettings) {
    super(settings);
    // Local servers often take no key, but the SDK refuses an empty one.
    this.client = new OpenAI({ apiKey: settings.apiKey || "none", baseURL: settings.baseURL });
  }

  protected async requestObject<T>(request: ObjectRequest<T>): Promise<unknown> {
    const completion = await this.client.chat.completions.parse({
      model: this.model,
      messages: [{ role: "system", content: request.system }, ...request.messages],
      response_format: zodResponseFormat(request.schema, request.name),
    });
    return completion.choices[0]?.message.parsed;
  }
}

/**
 * Anthropic's Messages API. Structured output comes from forcing a single
 * tool call whose input schema is the requested shape.
 */
export class AnthropicModel extends BaseLanguageModel {
  readonly provider = "anthropic";

  protected async requestObject<T>(request: ObjectRequest<T>): Promise<unknown> {
    const body = (await this.postJson(
      `${trimSlash(this.settings.baseURL ?? "https://api.anthropic.com/v1")}/messages`,
      { "x-api-key": this.settings.apiKey, "anthropic-version": "2023-06-01" },
      {
        model: this.model,
        max_tokens: 8192,
        system: request.system,
        messages: request.messages,
        tools: [
          {
            name: request.name,
            description: "Return the result in this exact shape.",
            input_schema: this.jsonSchema(request.schema),
          },
        ],
        tool_choice: { type: "tool", name: request.name },
      },
    )) as { content?: { type: string; input?: unknown }[] };

    const call = body.content?.find((block) => block.type === "tool_use");
    if (!call) {
      throw new LLMResponseError("The model (anthropic) returned no structured output.");
    }
    return call.input;
  }
}

/** Google's Gemini API, with a JSON response schema. */
export class GeminiModel extends BaseLanguageModel {
  readonly provider = "gemini";

  protected async requestObject<T>(request: ObjectRequest<T>): Promise<unknown> {
    const base = trimSlash(
      this.settings.baseURL ?? "https://generativelanguage.googleapis.com/v1beta",
    );
    const body = (await this.postJson(
      `${base}/models/${encodeURIComponent(this.model)}:generateContent`,
      { "x-goog-api-key": this.settings.apiKey },
      {
        systemInstruction: { parts: [{ text: request.system }] },
        // Gemini calls the assistant role "model".
        contents: request.messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: this.jsonSchema(request.schema),
        },
      },
    )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

    const text = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    return this.parseJsonText(text);
  }
}

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

/** Every supported provider, keyed by its LLM_PROVIDER value. */
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
