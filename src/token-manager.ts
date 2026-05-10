import {
  ProviderConfig,
  Env,
  OpenAIChatRequest,
  OpenAIResponsesRequest,
  ProviderResponse,
} from './types';
import { createProvider } from './providers';
import { normalizeFailure, shouldRotateApiKey } from './utils/error-handler';
import { responsesToChatRequest } from './utils/request-mapper';

export class TokenManager {
  constructor(
    private config: ProviderConfig,
    private env: Env
  ) {}

  static readonly DEBUG_KEY_INDEX_HEADER = 'X-Proxy-Debug-Key-Index';

  /**
   * Try to execute request with token rotation
   * Will try all tokens in order until one succeeds
   */
  async executeWithRotation(
    request: OpenAIChatRequest,
    options?: { keyIndex?: number }
  ): Promise<ProviderResponse> {
    const provider = createProvider(this.config, this.env);
    const apiKeys = this.getApiKeys(options?.keyIndex);

    if (options?.keyIndex !== undefined && this.config.apiKeys.length > 0 && apiKeys.length === 0) {
      return {
        success: false,
        error: `Debug key index ${options.keyIndex + 1} is out of range`,
        statusCode: 400,
      };
    }

    if (apiKeys.length === 0) {
      // For providers that don't need API keys (like Cloudflare AI)
      return await provider.chat(request, '');
    }

    let lastError: { message: string; statusCode: number } | null = null;

    // Try each API key in order
    for (const apiKey of apiKeys) {
      try {
        console.log(
          `[TokenManager] Trying ${this.config.provider}/${this.config.model} with key ending in ...${apiKey.slice(-4)}`
        );

        const response = await provider.chat(request, apiKey);

        if (response.success) {
          console.log(`[TokenManager] Success with key ending in ...${apiKey.slice(-4)}`);
          return response;
        }

        const failure = normalizeFailure(
          {
            message: response.error || 'Provider request failed',
            statusCode: response.statusCode,
          },
          'Provider request failed',
          response.statusCode || 500
        );
        lastError = failure;
        console.log(
          `[TokenManager] Failed with key ending in ...${apiKey.slice(-4)}: ${failure.message}`
        );

        if (!shouldRotateApiKey(failure)) {
          break;
        }
      } catch (error) {
        const failure = normalizeFailure(error, 'Provider request failed');
        lastError = failure;
        console.error(
          `[TokenManager] Exception with key ending in ...${apiKey.slice(-4)}:`,
          failure
        );

        if (!shouldRotateApiKey(failure)) {
          break;
        }
      }
    }

    const failure = normalizeFailure(lastError, 'All API keys failed');
    return {
      success: false,
      error: failure.message,
      statusCode: failure.statusCode,
    };
  }

  async executeResponsesWithRotation(
    request: OpenAIResponsesRequest,
    options?: { keyIndex?: number }
  ): Promise<ProviderResponse> {
    const provider = createProvider(this.config, this.env);
    const apiKeys = this.getApiKeys(options?.keyIndex);

    if (options?.keyIndex !== undefined && this.config.apiKeys.length > 0 && apiKeys.length === 0) {
      return {
        success: false,
        error: `Debug key index ${options.keyIndex + 1} is out of range`,
        statusCode: 400,
      };
    }

    if (!provider.responses) {
      return this.executeWithRotation(responsesToChatRequest(request), options);
    }

    if (apiKeys.length === 0) {
      return await provider.responses(request, '');
    }

    let lastError: { message: string; statusCode: number } | null = null;

    for (const apiKey of apiKeys) {
      try {
        console.log(
          `[TokenManager] Trying responses ${this.config.provider}/${this.config.model} with key ending in ...${apiKey.slice(-4)}`
        );

        const response = await provider.responses(request, apiKey);

        if (response.success) {
          console.log(`[TokenManager] Responses success with key ending in ...${apiKey.slice(-4)}`);
          return response;
        }

        const failure = normalizeFailure(
          {
            message: response.error || 'Provider request failed',
            statusCode: response.statusCode,
          },
          'Provider request failed',
          response.statusCode || 500
        );
        lastError = failure;
        console.log(
          `[TokenManager] Responses failed with key ending in ...${apiKey.slice(-4)}: ${failure.message}`
        );

        if (!shouldRotateApiKey(failure)) {
          break;
        }
      } catch (error) {
        const failure = normalizeFailure(error, 'Provider request failed');
        lastError = failure;
        console.error(
          `[TokenManager] Responses exception with key ending in ...${apiKey.slice(-4)}:`,
          failure
        );

        if (!shouldRotateApiKey(failure)) {
          break;
        }
      }
    }

    const failure = normalizeFailure(lastError, 'All API keys failed');
    return {
      success: false,
      error: failure.message,
      statusCode: failure.statusCode,
    };
  }

  private getApiKeys(selectedKeyIndex?: number): string[] {
    const keys: string[] = [];

    for (const keyName of this.config.apiKeys) {
      const keyValue = this.env[keyName];
      if (keyValue) {
        keys.push(keyValue);
      } else {
        console.warn(`[TokenManager] API key not found in env: ${keyName}`);
      }
    }

    if (selectedKeyIndex !== undefined) {
      const selected = keys[selectedKeyIndex];
      if (!selected) {
        console.warn(
          `[TokenManager] Debug key index ${selectedKeyIndex + 1} is out of range for ${this.config.provider}/${this.config.model}`
        );
        return [];
      }

      return [selected];
    }

    return keys;
  }
}
