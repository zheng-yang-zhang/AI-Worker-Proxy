import {
  OpenAIChatRequest,
  OpenAIMessage,
  OpenAIResponsesRequest,
  ResponsesTool,
  Tool,
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const chunks: string[] = [];
  for (const item of content) {
    if (isRecord(item)) {
      if (
        (item.type === 'input_text' || item.type === 'output_text' || item.type === 'text') &&
        typeof item.text === 'string'
      ) {
        chunks.push(item.text);
      } else if (typeof item.text === 'string') {
        chunks.push(item.text);
      }
    }
  }

  return chunks.join('\n');
}

function normalizeMessagesFromInput(input: unknown): OpenAIMessage[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  const messages: OpenAIMessage[] = [];

  for (const item of input) {
    if (!isRecord(item)) continue;

    if (item.type === 'message') {
      const role =
        item.role === 'assistant' || item.role === 'system' || item.role === 'tool'
          ? (item.role as OpenAIMessage['role'])
          : 'user';
      messages.push({
        role,
        content: extractTextFromContent(item.content),
      });
      continue;
    }

    if (
      item.type === 'input_text' ||
      item.type === 'output_text' ||
      item.type === 'text' ||
      typeof item.text === 'string'
    ) {
      messages.push({
        role: 'user',
        content: typeof item.text === 'string' ? item.text : extractTextFromContent(item),
      });
    }
  }

  return messages;
}

function mapMessagesToResponsesInput(messages: OpenAIMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    type: 'message',
    role: message.role === 'function' ? 'tool' : message.role,
    content: [
      {
        type: 'input_text',
        text: message.content || '',
      },
    ],
  }));
}

function mapToolsToResponsesTools(tools?: Tool[]): ResponsesTool[] | undefined {
  if (!tools?.length) return undefined;

  return tools.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

function mapResponsesToolsToChatTools(tools?: ResponsesTool[]): Tool[] | undefined {
  if (!tools?.length) return undefined;

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export function responsesToChatRequest(request: OpenAIResponsesRequest): OpenAIChatRequest {
  const messages = normalizeMessagesFromInput(request.input);

  if (request.instructions) {
    messages.unshift({
      role: 'system',
      content: request.instructions,
    });
  }

  return {
    model: request.model,
    messages,
    temperature: request.temperature as number | undefined,
    top_p: request.top_p as number | undefined,
    max_tokens: request.max_output_tokens as number | undefined,
    stream: request.stream || false,
    tools: mapResponsesToolsToChatTools(request.tools),
    tool_choice: request.tool_choice as OpenAIChatRequest['tool_choice'],
  };
}

export function chatToResponsesRequest(request: OpenAIChatRequest): OpenAIResponsesRequest {
  const systemMessages = request.messages.filter((message) => message.role === 'system');
  const nonSystemMessages = request.messages.filter((message) => message.role !== 'system');

  return {
    model: request.model,
    instructions: systemMessages.map((message) => message.content || '').join('\n\n') || undefined,
    input: mapMessagesToResponsesInput(nonSystemMessages),
    stream: request.stream || false,
    tools: mapToolsToResponsesTools(request.tools),
    tool_choice: request.tool_choice,
    temperature: request.temperature,
    top_p: request.top_p,
    max_output_tokens: request.max_tokens,
  };
}
