/**
 * LLM Provider Abstraction
 * Supports Claude (Anthropic) and OpenRouter (OpenAI-compatible) APIs.
 * Converts between Anthropic tool format and OpenAI function calling format.
 */

// ── Types ──────────────────────────────────────────────────────────
export type LLMProvider = "claude" | "openrouter";

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: { type: string; properties: Record<string, unknown>; required?: string[] };
}

interface AnthropicContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string;
}

interface LLMCallResult {
  ok: boolean;
  status: number;
  data?: AnthropicResponse;
  errorText?: string;
}

// ── Tool Format Conversion ─────────────────────────────────────────

/** Anthropic tools → OpenAI function-calling tools */
function convertToolsToOpenAI(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Convert Anthropic messages to OpenAI messages format */
function convertMessagesToOpenAI(
  systemPrompt: string,
  messages: Array<{ role: string; content: unknown }>
): unknown[] {
  const result: unknown[] = [{ role: "system", content: systemPrompt }];

  for (const msg of messages) {
    if (msg.role === "user") {
      // User messages can be string or array of content blocks
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        // Check if it contains tool_result blocks
        const toolResults = (msg.content as any[]).filter((b: any) => b.type === "tool_result");
        const textBlocks = (msg.content as any[]).filter((b: any) => b.type === "text" || typeof b === "string");

        // Add tool results as separate "tool" role messages
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
          });
        }

        // Add text blocks as user message
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b: any) => (typeof b === "string" ? b : b.text || "")).join("\n");
          if (text.trim()) result.push({ role: "user", content: text });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textBlocks = (msg.content as any[]).filter((b: any) => b.type === "text");
        const toolUseBlocks = (msg.content as any[]).filter((b: any) => b.type === "tool_use");

        const text = textBlocks.map((b: any) => b.text || "").join("");

        if (toolUseBlocks.length > 0) {
          result.push({
            role: "assistant",
            content: text || null,
            tool_calls: toolUseBlocks.map((tu: any) => ({
              id: tu.id,
              type: "function",
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input || {}),
              },
            })),
          });
        } else {
          result.push({ role: "assistant", content: text });
        }
      }
    }
  }

  return result;
}

/** Convert OpenAI response → Anthropic response format */
function convertResponseToAnthropic(openaiData: any): AnthropicResponse {
  const choice = openaiData.choices?.[0];
  if (!choice) {
    return { content: [{ type: "text", text: "Nessuna risposta dal modello." }], stop_reason: "end_turn" };
  }

  const message = choice.message;
  const content: AnthropicContentBlock[] = [];

  // Add text content
  if (message.content) {
    content.push({ type: "text", text: message.content });
  }

  // Add tool calls
  if (message.tool_calls && message.tool_calls.length > 0) {
    for (const tc of message.tool_calls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        input = {};
      }
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // Map finish_reason → stop_reason
  let stop_reason = "end_turn";
  if (choice.finish_reason === "tool_calls" || choice.finish_reason === "function_call") {
    stop_reason = "tool_use";
  } else if (choice.finish_reason === "stop") {
    stop_reason = "end_turn";
  } else if (choice.finish_reason === "length") {
    stop_reason = "max_tokens";
  }

  return { content, stop_reason };
}

// ── Main API Call ──────────────────────────────────────────────────

/**
 * Call an LLM provider with Anthropic-compatible interface.
 * Returns response in Anthropic format regardless of provider.
 */
export async function callLLM(opts: {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: unknown }>;
  tools: any[];
  maxTokens?: number;
}): Promise<LLMCallResult> {
  const { provider, apiKey, model, systemPrompt, messages, tools, maxTokens = 4096 } = opts;

  if (provider === "openrouter") {
    return callOpenRouter(apiKey, model, systemPrompt, messages, tools, maxTokens);
  }

  // Default: Claude (Anthropic)
  return callClaude(apiKey, model, systemPrompt, messages, tools, maxTokens);
}

async function callClaude(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: unknown }>,
  tools: any[],
  maxTokens: number
): Promise<LLMCallResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools,
    }),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, errorText: await res.text() };
  }

  const data = await res.json() as any;
  return {
    ok: true,
    status: res.status,
    data: {
      content: data.content || [],
      stop_reason: data.stop_reason,
    },
  };
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: unknown }>,
  tools: any[],
  maxTokens: number
): Promise<LLMCallResult> {
  const openaiMessages = convertMessagesToOpenAI(systemPrompt, messages);
  const openaiTools = tools.length > 0 ? convertToolsToOpenAI(tools) : undefined;

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    max_tokens: maxTokens,
  };
  if (openaiTools && openaiTools.length > 0) {
    body.tools = openaiTools;
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": "https://impresa.goitalia.eu",
      "X-Title": "GoItalia CEO AI",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return { ok: false, status: res.status, errorText: await res.text() };
  }

  const data = await res.json();
  const converted = convertResponseToAnthropic(data);
  return { ok: true, status: res.status, data: converted };
}
