import {
  BaseLanguageModel,
  LLMResponseError,
  type ObjectRequest,
} from "@/lib/ai/llm/language-model";

const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const API_VERSION = "2023-06-01";
const MAX_TOKENS = 8192;

type MessagesResponse = {
  content?: { type: string; input?: unknown }[];
};

/**
 * Anthropic's Messages API. Structured output comes from forcing a single
 * tool call whose input schema is the requested shape.
 */
export class AnthropicModel extends BaseLanguageModel {
  readonly provider = "anthropic";

  protected async requestObject<T>(request: ObjectRequest<T>): Promise<unknown> {
    const body = (await this.postJson(
      `${(this.settings.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/messages`,
      { "x-api-key": this.settings.apiKey, "anthropic-version": API_VERSION },
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
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
    )) as MessagesResponse;

    const call = body.content?.find((block) => block.type === "tool_use");
    if (!call) {
      throw new LLMResponseError("The model (anthropic) returned no structured output.");
    }
    return call.input;
  }
}
