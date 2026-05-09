import { BaseProvider } from './base';
import { OpenAIChatRequest, OpenAIResponsesRequest, ProviderResponse } from '../types';
import { chatToResponsesRequest } from '../utils/request-mapper';

const DEFAULT_BASE_URL = 'https://api.freemodel.dev';
const UPSTREAM_TIMEOUT_MS = 20000;

export class FreemodelProvider extends BaseProvider {
  async chat(request: OpenAIChatRequest, apiKey: string): Promise<ProviderResponse> {
    const responsesRequest = chatToResponsesRequest({
      ...request,
      model: this.model,
    });
    return this.responses(responsesRequest, apiKey);
  }

  async responses(request: OpenAIResponsesRequest, apiKey: string): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('freemodel_timeout'), UPSTREAM_TIMEOUT_MS);

    try {
      const baseUrl = (this.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          ...request,
          model: this.model,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return {
          success: false,
          error: errorBody || `Freemodel upstream error: ${response.status}`,
          statusCode: response.status,
        };
      }

      if (request.stream) {
        if (!response.body) {
          return {
            success: false,
            error: 'Freemodel stream response body is empty',
            statusCode: 502,
          };
        }
        return { success: true, stream: response.body };
      }

      return {
        success: true,
        response: await response.json(),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: `Freemodel upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`,
          statusCode: 504,
        };
      }
      return this.handleError(error, 'FreemodelProvider');
    } finally {
      clearTimeout(timeout);
    }
  }
}
