# AI Worker Proxy for Freemodel

[![Deploy to Cloudflare Workers](https://img.shields.io/badge/Deploy-Cloudflare%20Workers-orange?logo=cloudflare)](https://workers.cloudflare.com/)
[![OpenAI Compatible](https://img.shields.io/badge/OpenAI-Compatible-green)](https://openai.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

把 [freemodel.dev](https://freemodel.dev/) 作为上游中转站，再用你自己的 Cloudflare Worker 和自定义域名包一层，得到一个只暴露单一 API 入口的代理服务。

这个版本做了两件关键事：

- 支持把 `freemodel` 当成上游 provider。
- 同时支持 `/v1/chat/completions` 和 `/v1/responses` 两种下游接口。

这样你可以：

- 给普通 OpenAI 客户端提供 `chat/completions`。
- 给 Codex 这类走 `responses` 的客户端提供 `/v1/responses`。
- 对外只暴露你自己的域名，例如 `https://api.yourdomain.com/v1`。

## 适合什么场景

- 你已经有 `freemodel.dev` 的 API Key，想自己再包一层域名。
- 你希望很多模型能力都走一个上游，但下游只给客户端一个固定地址。
- 你想把认证 token、路由名、故障切换策略都掌握在自己手里。

## 现在支持的用法

### 1. 下游 OpenAI Chat Completions

客户端请求：

- `POST /v1/chat/completions`
- `Authorization: Bearer <你的 PROXY_AUTH_TOKEN>`

Worker 会根据 `ROUTES_CONFIG` 里的模型别名，把请求转给 `freemodel.dev` 或其他兼容 provider。

### 2. 下游 OpenAI Responses

客户端请求：

- `POST /v1/responses`
- `Authorization: Bearer <你的 PROXY_AUTH_TOKEN>`

这条路径对 Codex / `wire_api = "responses"` 更友好。  
如果某个上游 provider 原生支持 responses，它会直接透传；如果不支持，会自动退回到内部的 chat 映射。

## 一种推荐结构

```text
你的客户端 / Codex / Chatbox
        |
        v
https://api.yourdomain.com/v1
        |
        v
Cloudflare Worker (本项目)
        |
        v
https://api.freemodel.dev
```

## 配置思路

你在 `ROUTES_CONFIG` 里定义的是“下游模型名”到“上游真实模型”的映射。  
如果你只打算提供一个模型，最简单的做法就是下游和上游都直接用 `gpt-5.5`。

例如：

```json
{
  "gpt-5.5": [
    {
      "provider": "freemodel",
      "baseUrl": "https://api.freemodel.dev",
      "model": "gpt-5.5",
      "apiKeys": ["FREEMODEL_KEY_1"]
    }
  ]
}
```

这里的意思是客户端传 `model: "gpt-5.5"`，Worker 也会把它转发到上游 `gpt-5.5`。

## 快速部署

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 `ROUTES_CONFIG`

参考 [examples/example-config.toml](/Users/zzy/fandai/examples/example-config.toml)。

最小可用示例：

```toml
ROUTES_CONFIG = '''
{
  "gpt-5.5": [
    {
      "provider": "freemodel",
      "baseUrl": "https://api.freemodel.dev",
      "model": "gpt-5.5",
      "apiKeys": ["FREEMODEL_KEY_1"]
    }
  ]
}
'''
```

### 3. 设置密钥

本地开发可用 `.dev.vars`：

```env
PROXY_AUTH_TOKEN=your-own-gateway-token
FREEMODEL_KEY_1=your-freemodel-api-key
ROUTES_CONFIG={"gpt-5.5":[{"provider":"freemodel","baseUrl":"https://api.freemodel.dev","model":"gpt-5.5","apiKeys":["FREEMODEL_KEY_1"]}]}
```

生产环境建议在 Cloudflare 里设置：

- `PROXY_AUTH_TOKEN`
- `FREEMODEL_KEY_1`
- `FREEMODEL_KEY_2`（可选，做轮询）

### 4. 本地运行

```bash
npm run dev
```

### 5. 部署

```bash
npm run deploy
```

## 自定义域名

部署到 Cloudflare Workers 后，可以在 Cloudflare 里给 Worker 绑定自定义域名，例如：

- `api.yourdomain.com`

然后你的客户端只需要配置：

- Base URL: `https://api.yourdomain.com/v1`
- API Key: `你的 PROXY_AUTH_TOKEN`

真正的 `freemodel` Key 只保留在 Worker 环境变量里，不暴露给客户端。

## 使用示例

### Python / OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://api.yourdomain.com/v1",
    api_key="your-own-gateway-token",
)

resp = client.chat.completions.create(
    model="gpt-5.5",
    messages=[{"role": "user", "content": "hello"}],
)

print(resp.choices[0].message.content)
```

### Codex 风格 / Responses API

```bash
curl -X POST "https://api.yourdomain.com/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-own-gateway-token" \
  -d '{
    "model": "gpt-5.5",
    "input": "Write a hello world in TypeScript"
  }'
```

### Codex CLI 配置思路

如果你想让 Codex 走你自己的域名，而不是直连 `api.freemodel.dev`，可以把它的 provider 配成：

```toml
model_provider = "mygateway"
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
disable_response_storage = true
preferred_auth_method = "apikey"

[model_providers.mygateway]
name = "mygateway"
base_url = "https://api.yourdomain.com"
wire_api = "responses"
```

注意：

- 这里的 `model` 要填你在 `ROUTES_CONFIG` 里定义的模型名，这里就是 `gpt-5.5`
- `base_url` 要写你自己的域名，不是 `https://api.freemodel.dev`

## 示例文件

- 配置示例：[examples/example-config.toml](/Users/zzy/fandai/examples/example-config.toml)
- cURL 示例：[examples/curl-examples.sh](/Users/zzy/fandai/examples/curl-examples.sh)
- 快速安装：[SETUP.md](/Users/zzy/fandai/SETUP.md)
- 私有配置说明：[PRIVATE_CONFIG.md](/Users/zzy/fandai/PRIVATE_CONFIG.md)

## 已实现的代码改动

- 新增 `freemodel` provider
- 新增 `/v1/responses` 和 `/responses`
- `responses` 请求可透传到 `freemodel`
- 非 responses provider 可自动桥接到 `chat/completions`
- 保留原来的多 provider fallback / token rotation 逻辑

## 注意

- 我这里是按你提供的 `freemodel` 文档信息接入的，核心依据是 `base_url = "https://api.freemodel.dev"` 和 `wire_api = "responses"`。
- 如果 `freemodel` 后续把 `responses` 请求体字段做了更细的扩展，这个项目现在已经有入口，后面只需要继续补 mapper 即可。

## 开发检查

```bash
npm run type-check
npm run lint
```

当前仓库能通过 `type-check`，`lint` 也没有 error，只剩原项目里已有的 `any` warning。
