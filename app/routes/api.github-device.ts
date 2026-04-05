import { json } from '@remix-run/cloudflare';
import { withSecurity } from '~/lib/security';

const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code';
const GITHUB_ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const GITHUB_DEVICE_SCOPE = 'repo read:user read:org workflow';

function getGitHubClientId(context: any) {
  return (
    context?.cloudflare?.env?.GITHUB_CLIENT_ID ||
    context?.cloudflare?.env?.VITE_GITHUB_CLIENT_ID ||
    process.env.GITHUB_CLIENT_ID ||
    process.env.VITE_GITHUB_CLIENT_ID
  );
}

async function githubDeviceAction({ request, context }: { request: Request; context: any }) {
  const clientId = getGitHubClientId(context);

  if (!clientId) {
    return json(
      {
        error: 'GitHub device login is not configured. Set GITHUB_CLIENT_ID or VITE_GITHUB_CLIENT_ID.',
      },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    deviceCode?: string;
  };

  if (body.action === 'start') {
    const response = await fetch(GITHUB_DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'bolt.diy-app',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: GITHUB_DEVICE_SCOPE,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, any>;

    if (!response.ok || data.error) {
      return json(
        {
          error: data.error_description || data.error || `GitHub device flow failed with status ${response.status}`,
        },
        { status: response.ok ? 400 : response.status },
      );
    }

    return json({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      interval: data.interval ?? 5,
      expiresIn: data.expires_in ?? 900,
    });
  }

  if (body.action === 'poll') {
    if (!body.deviceCode) {
      return json({ error: 'deviceCode is required.' }, { status: 400 });
    }

    const tokenResponse = await fetch(GITHUB_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'bolt.diy-app',
      },
      body: new URLSearchParams({
        client_id: clientId,
        device_code: body.deviceCode,
        grant_type: GITHUB_DEVICE_GRANT_TYPE,
      }),
    });

    const tokenData = (await tokenResponse.json().catch(() => ({}))) as Record<string, any>;

    if (tokenData.error === 'authorization_pending') {
      return json({
        status: 'pending',
        interval: 5,
        message: 'Waiting for GitHub authorization.',
      });
    }

    if (tokenData.error === 'slow_down') {
      return json({
        status: 'pending',
        interval: 10,
        message: 'GitHub asked to slow down. Retrying shortly.',
      });
    }

    if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
      return json(
        {
          status: 'error',
          error:
            tokenData.error_description ||
            tokenData.error ||
            `GitHub authorization failed with status ${tokenResponse.status}`,
        },
        { status: tokenResponse.ok ? 400 : tokenResponse.status },
      );
    }

    const userResponse = await fetch(`${GITHUB_API_URL}/user`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'bolt.diy-app',
      },
    });

    const userData = (await userResponse.json().catch(() => ({}))) as Record<string, any>;

    if (!userResponse.ok) {
      return json(
        {
          status: 'error',
          error: userData.message || `GitHub user lookup failed with status ${userResponse.status}`,
        },
        { status: userResponse.status },
      );
    }

    return json({
      status: 'complete',
      accessToken: tokenData.access_token,
      user: userData,
    });
  }

  return json({ error: 'Unsupported action.' }, { status: 400 });
}

export const action = withSecurity(githubDeviceAction, {
  rateLimit: true,
  allowedMethods: ['POST'],
});
