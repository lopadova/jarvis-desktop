# ADR 0004 — Sign in with ChatGPT as a first-class brain

- Status: Accepted · Date: 2026-10-03

## Context
On 2026-09-29 OpenAI expanded **Sign in with ChatGPT**. Plus and Pro users can now let third-party apps spend their plan allowance instead of paying per API call; the user sets a weekly cap per app. Open-source, locally hosted apps can register themselves.

## Decision
The sidecar implements the open-source token-sharing flow:
- **Sign-in:** Authorization Code + PKCE (S256) + OIDC nonce, opened in the system browser, with loopback redirect `http://127.0.0.1:<port>/auth/callback`.
- **Registration:** the first sign-in uses `client_id=dynamic_agent_client`, `agent_name_hint="Jarvis Desktop"` and a persisted `ext_agent_host_id`. We store the issued `oaiapp_…` client id and reuse it.
- **Scopes:** `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, with `resource=https://api.openai.com/v1`.
- **ID token:** validated against the JWKS (`iss`, `aud`, `exp`, `nonce`).
- **Inference:** only `POST /v1/responses` with `store:false` and `stream:true`. Models come from `GET /v1/models`.
- **Tokens:** kept in the OS keyring and refreshed proactively. The access token lasts about 1 h; the refresh token lasts about 30 days and rotates on use.
- **Cap reached:** on `429 subscription_sharing_usage_limit_exceeded`, Jarvis shows the cap in the UI. It never falls back to a paid API automatically (security-model R10).
- **UI:** the button and disclosures follow OpenAI's Sign in with ChatGPT UI/UX guidelines.

Plan tokens do not cover audio (TTS, STT, Realtime), so voice always uses separate providers.

## Open questions (verify during implementation)
- Are tool/function calling and structured outputs supported with plan tokens? If not, the router falls back to strict JSON-in-text, validated with `zod`, with one repair retry.
