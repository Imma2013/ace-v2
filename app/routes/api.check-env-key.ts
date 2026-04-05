import type { LoaderFunction } from '@remix-run/cloudflare';
import { getApiKeysFromCookie } from '~/lib/api/cookies';

const VERCEL_GOOGLE_FALLBACK_KEY = 'AIzaSyDRG2KBf76iPGYn4ESP8wm5D0JjQSovUPc';

export const loader: LoaderFunction = async ({ context, request }) => {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get('provider');
    const isHostedVercel =
      (typeof process !== 'undefined' && !!(process.env.VERCEL || process.env.VERCEL_URL)) ||
      request.headers.has('x-vercel-id') ||
      url.hostname.endsWith('.vercel.app') ||
      url.hostname === 'vercel.app';

    if (!provider) {
      return Response.json({ isSet: false });
    }

    if (isHostedVercel) {
      const cookieHeader = request.headers.get('Cookie');
      const apiKeys = getApiKeysFromCookie(cookieHeader);
      const envVarName =
        provider === 'Google'
          ? 'GOOGLE_GENERATIVE_AI_API_KEY'
          : provider === 'OpenAI'
            ? 'OPENAI_API_KEY'
            : provider === 'Anthropic'
              ? 'ANTHROPIC_API_KEY'
              : provider;

      return Response.json({
        isSet: !!(
          apiKeys?.[provider] ||
          process.env[envVarName]?.trim() ||
          (provider === 'Google' ? VERCEL_GOOGLE_FALLBACK_KEY : undefined)
        ),
      });
    }

    const runtimeEnv = (context?.cloudflare?.env as Record<string, any>) ?? {};
    const { LLMManager } = await import('~/lib/modules/llm/manager');
    const llmManager = LLMManager.getInstance(runtimeEnv as any);
    const providerInstance = llmManager.getProvider(provider);

    if (!providerInstance || !providerInstance.config.apiTokenKey) {
      return Response.json({ isSet: false });
    }

    const envVarName = providerInstance.config.apiTokenKey;
    const cookieHeader = request.headers.get('Cookie');
    const apiKeys = getApiKeysFromCookie(cookieHeader);

    const isSet = !!(apiKeys?.[provider] || runtimeEnv[envVarName] || process.env[envVarName] || llmManager.env[envVarName]);

    return Response.json({ isSet });
  } catch (error) {
    console.error('Failed to check env key:', error);
    return Response.json({ isSet: false, error: 'Unable to check environment key' }, { status: 200 });
  }
};


