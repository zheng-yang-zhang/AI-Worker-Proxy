# Quick Setup Guide

这个版本的目标是：

- 上游用 `freemodel.dev`
- 下游对外只暴露你自己的 Worker / 自定义域名
- 同时兼容 `/v1/chat/completions` 和 `/v1/responses`

## 1. 安装依赖

```bash
npm install
```

## 2. 配置模型别名

编辑 `wrangler.toml` 或 GitHub Actions 里的 `ROUTES_CONFIG`。

最小示例：

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

注意：

- 这里对外暴露给客户端的模型名就是 `gpt-5.5`
- 它实际转发给上游的模型名也是 `gpt-5.5`

## 3. 设置密钥

本地开发：

```bash
cp .dev.vars.example .dev.vars
```

把 `.dev.vars` 改成类似这样：

```env
PROXY_AUTH_TOKEN=my-secret-token
FREEMODEL_KEY_1=your-freemodel-key
ROUTES_CONFIG={"gpt-5.5":[{"provider":"freemodel","baseUrl":"https://api.freemodel.dev","model":"gpt-5.5","apiKeys":["FREEMODEL_KEY_1"]}]}
```

生产环境：

```bash
wrangler secret put PROXY_AUTH_TOKEN
wrangler secret put FREEMODEL_KEY_1
```

## 4. 本地测试

```bash
npm run dev
```

### 测试 chat/completions

```bash
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret-token" \
  -d '{
    "model": "gpt-5.5",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### 测试 responses

```bash
curl -X POST http://localhost:8787/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-secret-token" \
  -d '{
    "model": "gpt-5.5",
    "input": "Write a hello world in Python"
  }'
```

## 5. 部署

```bash
npm run deploy
```

## 6. 绑定自定义域名

Worker 部署完成后，在 Cloudflare 给它绑定自己的域名，例如：

- `api.yourdomain.com`

之后下游客户端只需要记住：

- Base URL: `https://api.yourdomain.com/v1`
- API Key: `PROXY_AUTH_TOKEN`

## 7. 给 Codex CLI 用

如果你想让 Codex CLI 走你的域名，配置可以写成：

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

## 常见问题

### 401 Unauthorized

- 检查 `Authorization` 头是否等于 `PROXY_AUTH_TOKEN`

### All providers failed

- 检查 `FREEMODEL_KEY_1` 是否正确
- 检查 `ROUTES_CONFIG` 中的上游模型名是否是 `freemodel` 实际支持的名字

### 我只想暴露一个 API

直接把所有客户端都指向你的自定义域名即可：

- 老式 OpenAI 客户端走 `/v1/chat/completions`
- Codex 这类客户端走 `/v1/responses`

两者都还是同一个域名、同一套鉴权、同一套路由配置。
