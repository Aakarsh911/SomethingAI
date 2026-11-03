import { z } from "zod";

/** One turn of a conversation with the model. */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ObjectRequest<T> = {
  system: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Short snake_case name for the schema, e.g. "workflow_plan". */
  name: string;
};

/** What every provider needs to be constructed. */
export type ProviderSettings = {
  apiKey: string;
  model: string;
  /** Overrides the provider's default endpoint. */
  baseURL?: string;
};

/** Base for errors worth showing the user as-is. */
export class LLMError extends Error {}

/** The provider is misconfigured: unknown name, missing key or model. */
export class LLMConfigError extends LLMError {}

/** The provider answered, but not with something usable. */
export class LLMResponseError extends LLMError {}

/** A chat model that can answer in a given JSON shape. */
export interface LanguageModel {
  readonly provider: string;
  readonly model: string;
  generateObject<T>(request: ObjectRequest<T>): Promise<T>;
}

/**
 * Shared plumbing for providers. Subclasses only translate a request into
 * their wire format; validation against the schema happens here, once, so no
 * provider can hand back an object of the wrong shape.
 */
export abstract class BaseLanguageModel implements LanguageModel {
  abstract readonly provider: string;

  constructor(protected readonly settings: ProviderSettings) {}

  get model(): string {
    return this.settings.model;
  }

  async generateObject<T>(request: ObjectRequest<T>): Promise<T> {
    const raw = await this.requestObject(request);
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new LLMResponseError(
        `The model (${this.provider}) returned output that does not match the expected shape.`,
      );
    }
    return parsed.data;
  }

  /** Sends the request and returns the model's unvalidated JSON value. */
  protected abstract requestObject<T>(request: ObjectRequest<T>): Promise<unknown>;

  protected jsonSchema(schema: z.ZodType): Record<string, unknown> {
    // Some providers reject the "$schema" marker, and none need it.
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    delete json.$schema;
    return json;
  }

  protected parseJsonText(text: string | null | undefined): unknown {
    if (!text) {
      throw new LLMResponseError(`The model (${this.provider}) returned no output.`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new LLMResponseError(`The model (${this.provider}) returned malformed JSON.`);
    }
  }

  /** POSTs JSON and returns the decoded body, surfacing the provider's error message. */
  protected async postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = (data as { error?: { message?: string } } | null)?.error?.message;
      throw new Error(
        `${this.provider} answered ${response.status}${message ? `: ${message}` : ""}`,
      );
    }
    return data;
  }
}
