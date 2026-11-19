/** Pages Function: same-origin `/api/*` → online-api on Render (ADR 0012). */
import { proxyApi, type ProxyEnv } from '@mrak/api-client/edge-proxy';

export const onRequest = ({ request, env }: { request: Request; env: ProxyEnv }) =>
  proxyApi(request, env);
