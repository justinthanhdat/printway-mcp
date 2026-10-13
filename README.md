# Printway MCP

Printway v3 fulfillment integration for ChatGPT and other MCP clients. Covers all **23 published operations**: products/SKUs, shipping, order quotes/create/read/update/pay/cancel/delete, webhooks, transactions, and token administration. See [API research](docs/API-RESEARCH.md) and the sanitized [Postman snapshot](docs/postman-source.json).

## Run

Node.js 22 or newer.

```sh
npm ci
cp .env.example .env
# Set MCP_LOGIN_PASSWORD to a random secret with at least 24 characters.
# Optionally set PRINTWAY_ACCESS_TOKEN; otherwise enter it in the OAuth form.
npm run check
npm test
npm run build
npm start
```

Health: `/healthz`. Remote MCP endpoint: `/mcp` (Streamable HTTP). Set `PUBLIC_URL` to the external HTTPS origin when deployed outside Render; Render automatically supplies `RENDER_EXTERNAL_URL`. `PRINTWAY_ENV=uat` selects the documented UAT API. No OpenAI API key is needed.

## Connect ChatGPT

Create a custom remote MCP connection in your ChatGPT account using `https://YOUR-SERVICE.onrender.com/mcp` and **OAuth**. Use dynamic client registration (DCR); no manually assigned OAuth client ID/secret is needed. OAuth metadata: `/.well-known/oauth-authorization-server`, protected resource metadata: `/.well-known/oauth-protected-resource/mcp`.

In the browser consent screen, enter `MCP_LOGIN_PASSWORD` and, if the server has no configured upstream token, your Printway API v3 token. Obtain the Printway token from **Store → Connect APIs → Generate Token**. Do not paste credentials into chat. OAuth tokens issued to ChatGPT are distinct from Printway tokens. Your ChatGPT plan/workspace must allow custom MCP connections; the server alone does not install the connection in your account.

Default scopes: `printway:read` and `printway:write`. A client may request read access only. The server enforces scopes for each tool and provides read/write/destructive annotations. Payment requires explicit user intent in the client workflow; the API operation itself is a real financial action.

## Token administration

19 business tools are enabled by default. To expose the additional 4 auth tools, set `ENABLE_AUTH_ADMIN=true`, configure `PRINTWAY_EMAIL`, `PRINTWAY_PASSWORD`, and optional `PRINTWAY_REFRESH_TOKEN`, then reconnect with `printway:admin` scope. Auth tool inputs never ask for passwords. Returned token fields are redacted. Generated tokens update the active process client; token changes are not persisted back to Render settings. Revoking/regenerating may invalidate other integrations, so use only on explicit request. This mode is intended for a single trusted operator.

## Deployment

`render.yaml` defines a free Node web service in Singapore. Direct creation must use the same build/start commands. Configure `MCP_LOGIN_PASSWORD` as a Render secret. `PRINTWAY_ACCESS_TOKEN` is optional when entered at consent. Health checks must use `/healthz`; source must be pushed to GitHub before deployment. Build runs type checking, integration tests, and compilation before startup.

## Verification

- `npm run check`: strict TypeScript checking.
- `npm test`: coverage vs published collection, wire-level routing for all endpoints, GET body preservation, local input validation, upstream failure/timeout behavior, OAuth discovery/PKCE/resource binding/replay rejection/refresh rotation, MCP protocol/tool discovery, scope enforcement, redaction.
- `npm run test:live`: four read-only upstream smoke calls using `.env`. No creation, payment, cancellation, deletion, token rotation, or webhook write is performed. Exit 2 means missing credentials, not successful verification.

## Operational limits

OAuth client registrations, pending grants, access tokens and refresh tokens live in bounded process memory. Restart/redeploy invalidates connections: reconnect after restart. This initial deployment supports a single instance; add a durable encrypted OAuth store and shared rate limiter before horizontal scaling or production availability commitments. The free Render instance may cold start. This implementation supports DCR, not CIMD.

HTTP requests have a 30-second timeout and 8 MiB response cap. Write operations are never automatically retried. After a timeout, inspect order state before retrying. Read-only POST endpoints (price, product detail, shipping methods) are correctly annotated. Inputs are validated against published fields, but unknown Printway account rules and undocumented response shapes still require real-account testing. No claim of successful live testing is made without credentials and recorded results.

Webhook API manages remote registrations only. Hosting a receiver, event history, or webhook-to-chat notifications requires a separate durable workflow.

References: [Printway v3](https://documenter.getpostman.com/view/25190860/2s9Y5WyPUk), [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk), [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth).
