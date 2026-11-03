import OpenAI from "openai";
import { zodResponseFormat, zodTextFormat } from "openai/helpers/zod";
import {
  BaseLanguageModel,
  type ObjectRequest,
  type ProviderSettings,
} from "@/lib/ai/llm/language-model";

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
