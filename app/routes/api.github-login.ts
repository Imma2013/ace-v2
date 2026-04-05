import { redirect } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_OAUTH_SCOPE = 'repo read:user read:org';

// Dynamic access prevents Vite/nodePolyfills from statically replacing process.env at build time
const _env = (globalThis as any).process?.env ?? {};

function getGitHubClientId(context: any) {
  return (
    context?.cloudflare?.env?.GITHUB_CLIENT_ID ||
    context?.cloudflare?.env?.VITE_GITHUB_CLIENT_ID ||
    _env['GITHUB_CLIENT_ID'] ||
    _env['VITE_GITHUB_CLIENT_ID']
  );
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const clientId = getGitHubClientId(context);

  if (!clientId) {
    return new Response('GitHub OAuth is not configured. Set GITHUB_CLIENT_ID.', { status: 500 });
  }

  // Generate a random state parameter for CSRF protection
  const state = crypto.randomUUID();

  // Determine the callback URL from the current request origin
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/github-callback`;

  // Build GitHub authorize URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GITHUB_OAUTH_SCOPE,
    state,
  });

  const authorizeUrl = `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;

  // Set the state in a short-lived cookie so the callback can verify it
  return redirect(authorizeUrl, {
    headers: {
      'Set-Cookie': `github_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  });
};
