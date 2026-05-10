import { Env, OpenAIChatRequest, OpenAIResponsesRequest } from './types';
import { Router } from './router';
import { ProxyError, createErrorResponse } from './utils/error-handler';
import { TokenManager } from './token-manager';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Health check — no auth required
      if ((path === '/health' || path === '/') && request.method === 'GET') {
        return json({
          status: 'ok',
          service: 'ai-worker-proxy',
          timestamp: new Date().toISOString(),
        });
      }

      // Models list — no auth required (matches OpenAI behavior)
      if ((path === '/models' || path === '/v1/models') && request.method === 'GET') {
        const router = new Router(env);
        return json({
          object: 'list',
          data: router.getAvailableModels(),
        });
      }

      // Everything below requires auth
      if (!verifyAuth(request, env)) {
        throw new ProxyError('Unauthorized', 401, 'invalid_auth');
      }

      // Chat completions — POST only
      if (
        request.method === 'POST' &&
        (path === '/' || path === '/v1/chat/completions' || path === '/chat/completions')
      ) {
        return await handleChatCompletion(request, env);
      }

      // Responses API — POST only
      if (request.method === 'POST' && (path === '/v1/responses' || path === '/responses')) {
        return await handleResponses(request, env);
      }

      throw new ProxyError('Not found', 404);
    } catch (error) {
      console.error('[Worker] Error:', error);
      const errorResponse = createErrorResponse(error);
      const headers = new Headers(errorResponse.headers);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        headers.set(key, value);
      }
      return new Response(errorResponse.body, { status: errorResponse.status, headers });
    }
  },
};

async function handleChatCompletion(request: Request, env: Env): Promise<Response> {
  const body = await request.json();
  const chatRequest = body as OpenAIChatRequest;
  const debugKeyIndex = parseDebugKeyIndex(request);

  if (!chatRequest.messages || !Array.isArray(chatRequest.messages)) {
    throw new ProxyError('Invalid request: messages array is required', 400);
  }
  if (!chatRequest.model) {
    throw new ProxyError('Invalid request: model is required', 400);
  }

  console.log(`[Worker] model=${chatRequest.model} stream=${chatRequest.stream || false}`);

  const router = new Router(env);
  const response = await router.executeWithFallbackOptions(chatRequest, {
    keyIndex: debugKeyIndex,
  });

  if (!response.success) {
    throw new ProxyError(response.error || 'All providers failed', response.statusCode || 500);
  }

  if (response.stream) {
    return new Response(response.stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS_HEADERS,
      },
    });
  }

  return json(response.response);
}

async function handleResponses(request: Request, env: Env): Promise<Response> {
  const body = await request.json();
  const responsesRequest = body as OpenAIResponsesRequest;
  const debugKeyIndex = parseDebugKeyIndex(request);

  if (!responsesRequest.model) {
    throw new ProxyError('Invalid request: model is required', 400);
  }

  console.log(
    `[Worker] responses model=${responsesRequest.model} stream=${responsesRequest.stream || false}`
  );

  const router = new Router(env);
  const response = await router.executeResponsesWithFallbackOptions(responsesRequest, {
    keyIndex: debugKeyIndex,
  });

  if (!response.success) {
    throw new ProxyError(response.error || 'All providers failed', response.statusCode || 500);
  }

  if (response.stream) {
    return new Response(response.stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        ...CORS_HEADERS,
      },
    });
  }

  return json(response.response);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function verifyAuth(request: Request, env: Env): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return false;

  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  return token === env.PROXY_AUTH_TOKEN;
}

function parseDebugKeyIndex(request: Request): number | undefined {
  const rawValue = request.headers.get(TokenManager.DEBUG_KEY_INDEX_HEADER);
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ProxyError(
      `${TokenManager.DEBUG_KEY_INDEX_HEADER} must be a positive integer`,
      400
    );
  }

  return parsed - 1;
}
