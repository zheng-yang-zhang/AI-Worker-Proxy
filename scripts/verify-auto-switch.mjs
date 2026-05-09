import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const MOCK_PORT = 19080;
const WORKER_PORT = 18787;
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const PROXY_AUTH_TOKEN = 'proxy-test-token';

const requestCounts = new Map();

function incrementCount(pathname, authHeader) {
  const key = `${pathname}::${authHeader || 'no-auth'}`;
  requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
}

function getCount(pathname, authHeader) {
  return requestCounts.get(`${pathname}::${authHeader}`) || 0;
}

function createChatResponse(content, model = 'mock-model') {
  return {
    id: 'chatcmpl_mock',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
  };
}

function createErrorResponse(message, code = 'mock_error') {
  return {
    error: {
      message,
      type: 'mock_error',
      code,
    },
  };
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function startMockServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${MOCK_PORT}`);
    const authHeader = req.headers.authorization || '';
    incrementCount(url.pathname, authHeader);

    // Drain the body so fetch/OpenAI SDK does not keep the socket in a bad state.
    await new Promise((resolve, reject) => {
      req.on('data', () => {});
      req.on('end', resolve);
      req.on('error', reject);
    });

    if (url.pathname === '/auth-rotation/v1/chat/completions') {
      if (authHeader === 'Bearer bad-auth-key') {
        return sendJson(res, 401, createErrorResponse('invalid api key', 'invalid_api_key'));
      }
      if (authHeader === 'Bearer good-key') {
        return sendJson(res, 200, createChatResponse('auth-rotation-success'));
      }
    }

    if (url.pathname === '/timeout-rotation/v1/chat/completions') {
      if (authHeader === 'Bearer timeout-key') {
        return sendJson(res, 504, createErrorResponse('gateway timeout', 'gateway_timeout'));
      }
      if (authHeader === 'Bearer good-key') {
        return sendJson(res, 200, createChatResponse('timeout-rotation-success'));
      }
    }

    if (url.pathname === '/provider-a/v1/chat/completions') {
      return sendJson(res, 503, createErrorResponse('provider a overloaded', 'provider_a_busy'));
    }

    if (url.pathname === '/provider-b/v1/chat/completions') {
      return sendJson(res, 200, createChatResponse('provider-fallback-success'));
    }

    return sendJson(res, 404, createErrorResponse(`unexpected path: ${url.pathname}`, 'not_found'));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

async function waitForHealthy(url, timeoutMs = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Not ready yet.
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function startWorker() {
  const routesConfig = JSON.stringify({
    'auth-rotate': [
      {
        provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/auth-rotation/v1`,
        model: 'auth-model',
        apiKeys: ['BAD_AUTH_KEY', 'GOOD_KEY'],
      },
    ],
    'timeout-rotate': [
      {
        provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/timeout-rotation/v1`,
        model: 'timeout-model',
        apiKeys: ['TIMEOUT_KEY', 'GOOD_KEY'],
      },
    ],
    'provider-fallback': [
      {
        provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/provider-a/v1`,
        model: 'provider-a-model',
        apiKeys: ['GOOD_KEY'],
      },
      {
        provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/provider-b/v1`,
        model: 'provider-b-model',
        apiKeys: ['GOOD_KEY'],
      },
    ],
    'responses-auth-rotate': [
      {
        provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/auth-rotation/v1`,
        model: 'auth-model',
        apiKeys: ['BAD_AUTH_KEY', 'GOOD_KEY'],
      },
    ],
    'always-fail': [
      {
        provider: 'openai-compatible',
        baseUrl: `http://127.0.0.1:${MOCK_PORT}/provider-a/v1`,
        model: 'always-fail-model',
        apiKeys: ['GOOD_KEY'],
      },
    ],
  });

  const child = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      String(WORKER_PORT),
      '--log-level',
      'error',
      '--show-interactive-dev-session=false',
      '--var',
      `PROXY_AUTH_TOKEN:${PROXY_AUTH_TOKEN}`,
      '--var',
      `BAD_AUTH_KEY:bad-auth-key`,
      '--var',
      `TIMEOUT_KEY:timeout-key`,
      '--var',
      `GOOD_KEY:good-key`,
      '--var',
      `ROUTES_CONFIG:${routesConfig}`,
    ],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[wrangler] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[wrangler] ${chunk}`);
  });

  return child;
}

async function stopProcess(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

async function callChat(model) {
  const response = await fetch(`${WORKER_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROXY_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: `verify ${model}` }],
    }),
  });

  const json = await response.json();
  assert.equal(response.status, 200, `chat request for ${model} should succeed`);
  return json;
}

async function callResponses(model) {
  const response = await fetch(`${WORKER_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROXY_AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      model,
      input: 'verify responses path',
    }),
  });

  const json = await response.json();
  assert.equal(response.status, 200, `responses request for ${model} should succeed`);
  return json;
}

async function callRaw(pathname, body) {
  const response = await fetch(`${WORKER_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PROXY_AUTH_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    status: response.status,
    text,
    json,
  };
}

async function main() {
  const mockServer = await startMockServer();
  const worker = startWorker();

  try {
    await waitForHealthy(`${WORKER_URL}/health`);

    const authRotation = await callChat('auth-rotate');
    assert.equal(
      authRotation.choices?.[0]?.message?.content,
      'auth-rotation-success',
      'chat path should rotate from 401 key failure to the next key'
    );

    const timeoutRotation = await callChat('timeout-rotate');
    assert.equal(
      timeoutRotation.choices?.[0]?.message?.content,
      'timeout-rotation-success',
      'chat path should rotate from 504 timeout failure to the next key'
    );

    const providerFallback = await callChat('provider-fallback');
    assert.equal(
      providerFallback.choices?.[0]?.message?.content,
      'provider-fallback-success',
      'router should fall back to the second provider'
    );

    const responsesRotation = await callResponses('responses-auth-rotate');
    assert.equal(
      responsesRotation.choices?.[0]?.message?.content,
      'auth-rotation-success',
      'responses path should reuse the same key rotation logic'
    );

    const invalidChatRequest = await callRaw('/v1/chat/completions', {
      model: 'gpt-5.5',
    });
    assert.equal(invalidChatRequest.status, 400, 'invalid chat request should return 400');
    assert.equal(
      invalidChatRequest.json?.error?.message,
      'Invalid request: messages array is required',
      'invalid chat request should return proxy JSON instead of crashing the worker'
    );

    const allProvidersFailed = await callRaw('/v1/chat/completions', {
      model: 'always-fail',
      messages: [{ role: 'user', content: 'trigger provider failure' }],
    });
    assert.equal(
      allProvidersFailed.status,
      503,
      'all-provider failure should surface the upstream status instead of worker exception'
    );
    assert.match(
      allProvidersFailed.json?.error?.message || '',
      /All providers failed/i,
      'all-provider failure should return structured proxy error'
    );

    assert.ok(
      getCount('/auth-rotation/v1/chat/completions', 'Bearer good-key') >= 2,
      'good key should be used after auth failure on both chat and responses paths'
    );
    assert.ok(
      getCount('/auth-rotation/v1/chat/completions', 'Bearer bad-auth-key') >= 2,
      'bad auth key should have been attempted before rotation'
    );
    assert.ok(
      getCount('/timeout-rotation/v1/chat/completions', 'Bearer good-key') >= 1,
      'good key should be used after timeout rotation'
    );
    assert.ok(
      getCount('/timeout-rotation/v1/chat/completions', 'Bearer timeout-key') >= 1,
      'timeout key should have been attempted before rotation'
    );
    assert.ok(
      getCount('/provider-a/v1/chat/completions', 'Bearer good-key') >= 1,
      'first provider should be attempted before fallback'
    );
    assert.ok(
      getCount('/provider-b/v1/chat/completions', 'Bearer good-key') >= 1,
      'second provider should be attempted after fallback'
    );

    console.log('\nObserved upstream hits:');
    console.log(
      `- auth rotation: bad=${getCount('/auth-rotation/v1/chat/completions', 'Bearer bad-auth-key')} good=${getCount('/auth-rotation/v1/chat/completions', 'Bearer good-key')}`
    );
    console.log(
      `- timeout rotation: timeout=${getCount('/timeout-rotation/v1/chat/completions', 'Bearer timeout-key')} good=${getCount('/timeout-rotation/v1/chat/completions', 'Bearer good-key')}`
    );
    console.log(
      `- provider fallback: providerA=${getCount('/provider-a/v1/chat/completions', 'Bearer good-key')} providerB=${getCount('/provider-b/v1/chat/completions', 'Bearer good-key')}`
    );

    console.log('\nVerification passed: auth rotation, timeout rotation, provider fallback, responses-path rotation, and structured error paths all succeeded.');
  } finally {
    await stopProcess(worker);

    await new Promise((resolve, reject) => {
      mockServer.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

main().catch((error) => {
  console.error('\nVerification failed.');
  console.error(error);
  process.exitCode = 1;
});
