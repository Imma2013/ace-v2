import { redirect } from '@remix-run/cloudflare';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

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

function getGitHubClientSecret(context: any) {
  return (
    context?.cloudflare?.env?.GITHUB_CLIENT_SECRET ||
    _env['GITHUB_CLIENT_SECRET']
  );
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')];
    }),
  );
}

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle GitHub error responses (e.g. user denied access)
  if (error) {
    const description = url.searchParams.get('error_description') || error;
    return redirect(`/?github_error=${encodeURIComponent(description)}`);
  }

  if (!code || !state) {
    return redirect('/?github_error=Missing+code+or+state+from+GitHub');
  }

  // Verify CSRF state
  const cookies = parseCookies(request.headers.get('Cookie'));
  const savedState = cookies['github_oauth_state'];

  if (!savedState || savedState !== state) {
    return redirect('/?github_error=Invalid+OAuth+state.+Please+try+again.');
  }

  const clientId = getGitHubClientId(context);
  const clientSecret = getGitHubClientSecret(context);

  if (!clientId || !clientSecret) {
    return redirect('/?github_error=GitHub+OAuth+not+configured.+Set+GITHUB_CLIENT_ID+and+GITHUB_CLIENT_SECRET.');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'bolt.diy-app',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
      const errorMsg = tokenData.error_description || tokenData.error || 'Token exchange failed';
      return redirect(`/?github_error=${encodeURIComponent(errorMsg)}`);
    }

    // Set the token in a temporary cookie for the frontend to pick up.
    // The frontend will read it, call connect(), and the cookie expires.
    const headers = new Headers();

    // Temp cookie with the OAuth token — frontend reads and removes it
    headers.append('Set-Cookie', `github_oauth_token=${tokenData.access_token}; Path=/; SameSite=Lax; Max-Age=60`);

    // Clear the CSRF state cookie
    headers.append('Set-Cookie', `github_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);

    headers.set('Location', '/');

    return new Response(null, { status: 302, headers });
  } catch (fetchError) {
    console.error('GitHub OAuth callback error:', fetchError);
    return redirect('/?github_error=Failed+to+complete+GitHub+authorization');
  }
};
