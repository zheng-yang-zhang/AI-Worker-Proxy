import {
  RouteConfig,
  ProviderConfig,
  Env,
  OpenAIChatRequest,
  OpenAIResponsesRequest,
  ProviderResponse,
} from './types';
import { TokenManager } from './token-manager';
import { ProxyError, normalizeFailure } from './utils/error-handler';

export class Router {
  private routes: RouteConfig;

  constructor(private env: Env) {
    this.routes = this.parseRoutesConfig();
  }

  /**
   * Get list of available models
   */
  getAvailableModels(): Array<{
    id: string;
    object: string;
    owned_by: string;
    permission: string[];
  }> {
    const models = Object.keys(this.routes);
    return models.map((model) => ({
      id: model,
      object: 'model',
      owned_by: 'ai-worker-proxy',
      permission: [],
    }));
  }

  /**
   * Get provider configurations for a given model name
   */
  getProvidersForModel(model: string): ProviderConfig[] {
    // Check exact match first
    if (this.routes[model]) {
      return this.routes[model];
    }

    // Default fallback - use first available route or throw error
    const defaultRoute = Object.values(this.routes)[0];
    if (defaultRoute) {
      console.log(`[Router] No configuration found for model "${model}", using default route`);
      return defaultRoute;
    }

    throw new ProxyError(`No providers configured for model: ${model}`, 404);
  }

  /**
   * Execute request with provider fallback
   * Will try providers in order until one succeeds
   */
  async executeWithFallback(request: OpenAIChatRequest): Promise<ProviderResponse> {
    return this.executeWithFallbackOptions(request, {});
  }

  async executeWithFallbackOptions(
    request: OpenAIChatRequest,
    options: { keyIndex?: number }
  ): Promise<ProviderResponse> {
    const model = request.model;
    if (!model) {
      throw new ProxyError('Model name is required', 400);
    }

    const providers = this.getProvidersForModel(model);

    console.log(`[Router] Model "${model}" has ${providers.length} provider(s) configured`);

    let lastError: { message: string; statusCode: number } | null = null;

    // Try each provider in order
    for (let i = 0; i < providers.length; i++) {
      const config = providers[i];
      console.log(
        `[Router] Trying provider ${i + 1}/${providers.length}: ${config.provider}/${config.model}`
      );

      try {
        const manager = new TokenManager(config, this.env);
        const response = await manager.executeWithRotation(request, options);

        if (response.success) {
          console.log(`[Router] Success with provider: ${config.provider}/${config.model}`);
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
          `[Router] Provider ${config.provider}/${config.model} failed: ${failure.message}`
        );
      } catch (error) {
        const failure = normalizeFailure(error, 'Provider request failed');
        lastError = failure;
        console.error(`[Router] Provider ${config.provider}/${config.model} exception:`, failure);
      }
    }

    const failure = normalizeFailure(lastError, 'Unknown error');
    // All providers failed
    return {
      success: false,
      error: `All providers failed. Last error: ${failure.message}`,
      statusCode: failure.statusCode,
    };
  }

  async executeResponsesWithFallback(request: OpenAIResponsesRequest): Promise<ProviderResponse> {
    return this.executeResponsesWithFallbackOptions(request, {});
  }

  async executeResponsesWithFallbackOptions(
    request: OpenAIResponsesRequest,
    options: { keyIndex?: number }
  ): Promise<ProviderResponse> {
    const model = request.model;
    if (!model) {
      throw new ProxyError('Model name is required', 400);
    }

    const providers = this.getProvidersForModel(model);

    console.log(
      `[Router] Responses model "${model}" has ${providers.length} provider(s) configured`
    );

    let lastError: { message: string; statusCode: number } | null = null;

    for (let i = 0; i < providers.length; i++) {
      const config = providers[i];
      console.log(
        `[Router] Trying responses provider ${i + 1}/${providers.length}: ${config.provider}/${config.model}`
      );

      try {
        const manager = new TokenManager(config, this.env);
        const response = await manager.executeResponsesWithRotation(request, options);

        if (response.success) {
          console.log(
            `[Router] Responses success with provider: ${config.provider}/${config.model}`
          );
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
          `[Router] Responses provider ${config.provider}/${config.model} failed: ${failure.message}`
        );
      } catch (error) {
        const failure = normalizeFailure(error, 'Provider request failed');
        lastError = failure;
        console.error(
          `[Router] Responses provider ${config.provider}/${config.model} exception:`,
          failure
        );
      }
    }

    const failure = normalizeFailure(lastError, 'Unknown error');
    return {
      success: false,
      error: `All providers failed. Last error: ${failure.message}`,
      statusCode: failure.statusCode,
    };
  }

  private parseRoutesConfig(): RouteConfig {
    try {
      const configStr = this.env.ROUTES_CONFIG;
      if (!configStr) {
        throw new Error('ROUTES_CONFIG not found in environment');
      }

      const config = JSON.parse(configStr);
      console.log('[Router] Loaded routes:', Object.keys(config));
      return config;
    } catch (error) {
      console.error('[Router] Failed to parse ROUTES_CONFIG:', error);
      throw new ProxyError('Invalid ROUTES_CONFIG', 500);
    }
  }
}
