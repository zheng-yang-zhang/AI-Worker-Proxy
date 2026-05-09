#!/bin/bash

# Example cURL commands for AI Worker Proxy

CHAT_URL="https://api.yourdomain.com/v1/chat/completions"
RESPONSES_URL="https://api.yourdomain.com/v1/responses"
AUTH_TOKEN="your-secret-proxy-token-here"

echo "=== AI Worker Proxy - cURL Examples ==="
echo

# Example 1: Health check
echo "1. Health check (no auth required)"
curl -X GET "https://api.yourdomain.com/health"
echo -e "\n"

# Example 2: Simple non-streaming request
echo "2. Simple chat completion with 'gpt-5.5'"
curl -X POST "${CHAT_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ],
    "stream": false
  }'
echo -e "\n"

# Example 3: Streaming request
echo "3. Streaming response with 'gpt-5.5'"
curl -X POST "${CHAT_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "Count from 1 to 5"}
    ],
    "stream": true
  }' \
  --no-buffer
echo -e "\n"

# Example 4: With system message and parameters
echo "4. With system message and parameters"
curl -X POST "${CHAT_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Tell me a joke"}
    ],
    "temperature": 0.7,
    "max_tokens": 100,
    "stream": false
  }'
echo -e "\n"

# Example 5: Function calling / Tools
echo "5. Function calling / Tools"
curl -X POST "${CHAT_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "What is the weather in Paris?"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current weather in a location",
          "parameters": {
            "type": "object",
            "properties": {
              "location": {
                "type": "string",
                "description": "City name"
              },
              "unit": {
                "type": "string",
                "enum": ["celsius", "fahrenheit"]
              }
            },
            "required": ["location"]
          }
        }
      }
    ],
    "stream": false
  }'
echo -e "\n"

# Example 6: Multi-turn conversation
echo "6. Multi-turn conversation"
curl -X POST "${CHAT_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "model": "gpt-5.5",
    "messages": [
      {"role": "user", "content": "My name is Alice"},
      {"role": "assistant", "content": "Nice to meet you, Alice! How can I help you today?"},
      {"role": "user", "content": "What is my name?"}
    ],
    "stream": false
  }'
echo -e "\n"

# Example 7: Responses API for Codex / freemodel-style clients
echo "7. Responses API"
curl -X POST "${RESPONSES_URL}" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -d '{
    "model": "gpt-5.5",
    "input": "Explain quantum computing in simple terms",
    "stream": false
  }'
echo -e "\n"

echo "=== Examples complete ==="
