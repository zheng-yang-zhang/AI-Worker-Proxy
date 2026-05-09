# Private Configuration Guide

推荐把这个项目当成你自己的“统一 API 门面”：

- 对外：只有你自己的域名和 `PROXY_AUTH_TOKEN`
- 对内：Worker 再去调用 `freemodel.dev`

## 配置分工

- `ROUTES_CONFIG`
  - 放在 GitHub Actions Variable 或 `wrangler.toml`
  - 控制模型别名、上游模型、故障切换顺序

- `PROXY_AUTH_TOKEN`
  - 放在 Cloudflare Secret
  - 给你的客户端作为统一 API Key 使用

- `FREEMODEL_KEY_*`
  - 放在 Cloudflare Secret
  - 只给 Worker 调上游用，不给客户端

## 推荐的 Cloudflare Secrets

- `PROXY_AUTH_TOKEN`
- `FREEMODEL_KEY_1`
- `FREEMODEL_KEY_2`

## 推荐的 ROUTES_CONFIG

```json
{
  "gpt-5.5": [
    {
      "provider": "freemodel",
      "baseUrl": "https://api.freemodel.dev",
      "model": "gpt-5.5",
      "apiKeys": ["FREEMODEL_KEY_1", "FREEMODEL_KEY_2"]
    }
  ]
}
```

## GitHub Actions 方案

1. 在 GitHub 仓库添加 Variable：
   - `ROUTES_CONFIG`

2. 在 GitHub 仓库添加 Secrets：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

3. 在 Cloudflare Worker 里添加 Secrets：
   - `PROXY_AUTH_TOKEN`
   - `FREEMODEL_KEY_1`
   - `FREEMODEL_KEY_2`

这样做的好处是：

- 路由随时可改
- 上游 key 不进仓库
- 客户端永远只知道你的自定义域名和自己的代理 token

## 本地开发

`.dev.vars` 示例：

```env
PROXY_AUTH_TOKEN=local-proxy-token
FREEMODEL_KEY_1=your-freemodel-key
ROUTES_CONFIG={"gpt-5.5":[{"provider":"freemodel","baseUrl":"https://api.freemodel.dev","model":"gpt-5.5","apiKeys":["FREEMODEL_KEY_1"]}]}
```

## 典型客户端配置

### 普通 OpenAI SDK

- Base URL: `https://api.yourdomain.com/v1`
- API Key: `PROXY_AUTH_TOKEN`
- Model: `gpt-5.5`

### Codex CLI

- `base_url = "https://api.yourdomain.com"`
- `wire_api = "responses"`
- `model = "gpt-5.5"`

## 排错

### `vars.ROUTES_CONFIG not found`

确认它是 GitHub Variable，不是 GitHub Secret。

### Worker 能收到请求，但上游失败

优先检查：

- `FREEMODEL_KEY_1` 是否有效
- `ROUTES_CONFIG` 里的真实模型名是否正确
- `baseUrl` 是否写成 `https://api.freemodel.dev`

### Codex CLI 访问失败

优先检查：

- `wire_api = "responses"`
- `base_url` 写的是你的域名，不是 `/v1`
- `model` 是否是你在 `ROUTES_CONFIG` 里定义的模型名，这里就是 `gpt-5.5`
