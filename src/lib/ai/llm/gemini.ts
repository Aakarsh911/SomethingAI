import { BaseLanguageModel, type ObjectRequest } from "@/lib/ai/llm/language-model";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/** Google's Gemini API, with a JSON response schema. */
export class GeminiModel extends BaseLanguageModel {
  readonly provider = "gemini";

  protected async requestObject<T>(request: ObjectRequest<T>): Promise<unknown> {
    const base = (this.settings.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
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
    )) as GenerateContentResponse;

    const text = body.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("");
    return this.parseJsonText(text);
  }
}
