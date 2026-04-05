import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { convertToCoreMessages, createDataStreamResponse, formatDataStreamPart, generateId, generateText } from 'ai';
import type { Message } from 'ai';
import type { FileMap } from '~/lib/.server/llm/constants';
import type { StreamingOptions } from '~/lib/.server/llm/stream-text';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import type { DesignScheme } from '~/types/design-scheme';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { discussPrompt } from '~/lib/common/prompts/discuss-prompt';

const VERCEL_GOOGLE_FALLBACK_KEY = 'AIzaSyDRG2KBf76iPGYn4ESP8wm5D0JjQSovUPc';

// Dynamic access prevents Vite/nodePolyfills from statically replacing process.env at build time
const _env = (globalThis as any).process?.env ?? {};
const MODEL_REGEX = /^\[Model: (.*?)\]\n\n/;
const PROVIDER_REGEX = /\[Provider: (.*?)\]\n\n/;
const VERCEL_GOOGLE_MODEL_ALIASES: Record<string, string> = {
  'gemini-3.1-pro-preview': 'gemini-2.5-pro',
  'gemini-3-flash-preview': 'gemini-2.5-flash',
  'gemini-flash-latest': 'gemini-2.5-flash',
};
type Messages = Message[];

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

function stripModelProviderTags(message: Omit<Messages[number], 'id'>) {
  if (message.role !== 'user') {
    return message;
  }

  const { content } = extractMessageProperties(message);

  return {
    ...message,
    content,
  };
}

function extractMessageProperties(message: Omit<Message, 'id'>): {
  model: string | undefined;
  provider: string | undefined;
  content: string | Message['content'];
} {
  const textContent = Array.isArray(message.content)
    ? message.content.find((item) => item.type === 'text')?.text || ''
    : message.content;
  const model = textContent.match(MODEL_REGEX)?.[1];
  const provider = textContent.match(PROVIDER_REGEX)?.[1];
  const content = Array.isArray(message.content)
    ? message.content.map((item) =>
        item.type === 'text'
          ? {
              ...item,
              text: item.text?.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, ''),
            }
          : item,
      )
    : textContent.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '');

  return { model, provider, content };
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const requestUrl = new URL(request.url);
  const isHostedVercel =
    !!(_env.VERCEL || _env.VERCEL_URL) ||
    request.headers.has('x-vercel-id') ||
    requestUrl.hostname.endsWith('.vercel.app') ||
    requestUrl.hostname === 'vercel.app';
  const runtimeEnv = {
    GOOGLE_GENERATIVE_AI_API_KEY: _env.GOOGLE_GENERATIVE_AI_API_KEY?.trim(),
    OPENAI_API_KEY: _env.OPENAI_API_KEY?.trim(),
    ANTHROPIC_API_KEY: _env.ANTHROPIC_API_KEY?.trim(),
  } as Record<string, string | undefined>;

  const { messages, files, apiKeys: requestApiKeys, promptId, contextOptimization, supabase, chatMode, designScheme, maxLLMSteps } =
    await request.json<{
      messages: Messages;
      files: any;
      apiKeys?: Record<string, string>;
      promptId?: string;
      contextOptimization: boolean;
      chatMode: 'discuss' | 'build';
      designScheme?: DesignScheme;
      supabase?: {
        isConnected: boolean;
        hasSelectedProject: boolean;
        credentials?: {
          anonKey?: string;
          supabaseUrl?: string;
        };
      };
      maxLLMSteps: number;
    }>();

  const cookieHeader = request.headers.get('Cookie');
  const parsedCookies = parseCookies(cookieHeader || '');
  const cookieApiKeys = JSON.parse(parsedCookies.apiKeys || '{}');
  const apiKeys = Object.keys(cookieApiKeys).length > 0 ? cookieApiKeys : requestApiKeys || {};
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(parsedCookies.providers || '{}');

  if (isHostedVercel) {
    const vercelApiKeys = {
      ...apiKeys,
      ...(runtimeEnv.GOOGLE_GENERATIVE_AI_API_KEY ? { Google: runtimeEnv.GOOGLE_GENERATIVE_AI_API_KEY } : {}),
      ...(!runtimeEnv.GOOGLE_GENERATIVE_AI_API_KEY ? { Google: VERCEL_GOOGLE_FALLBACK_KEY } : {}),
      ...(runtimeEnv.OPENAI_API_KEY ? { OpenAI: runtimeEnv.OPENAI_API_KEY } : {}),
      ...(runtimeEnv.ANTHROPIC_API_KEY ? { Anthropic: runtimeEnv.ANTHROPIC_API_KEY } : {}),
    };

    try {
      const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
      const requestedProvider = lastUserMessage ? extractMessageProperties(lastUserMessage).provider : undefined;
      const requestedModel = lastUserMessage ? extractMessageProperties(lastUserMessage).model : undefined;

      if (requestedProvider === 'Google' && vercelApiKeys.Google) {
        const google = createGoogleGenerativeAI({
          apiKey: vercelApiKeys.Google.trim(),
        });
        const googleModel = VERCEL_GOOGLE_MODEL_ALIASES[requestedModel || ''] || requestedModel || 'gemini-2.5-pro';
        const processedMessages = messages.map((message) => stripModelProviderTags(message));

        const result = await generateText({
          model: google(googleModel),
          system: chatMode === 'build' ? 'You are Bolt, an expert software engineering assistant.' : discussPrompt(),
          messages: convertToCoreMessages(processedMessages as any),
          maxTokens: 8192,
        });

        return createDataStreamResponse({
          headers: {
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          },
          execute(dataStream) {
            if (result.text) {
              dataStream.write(formatDataStreamPart('text', result.text));
            }

            dataStream.write(
              formatDataStreamPart('finish_message', {
                finishReason: result.finishReason,
                usage: result.usage
                  ? {
                      promptTokens: result.usage.promptTokens,
                      completionTokens: result.usage.completionTokens,
                    }
                  : undefined,
              }),
            );
          },
        });
      }

      const { streamText } = await import('~/lib/.server/llm/stream-text');

      const result = await streamText({
        messages: [...messages],
        env: runtimeEnv as any,
        options: {
          supabaseConnection: supabase,
          maxSteps: 1,
        },
        apiKeys: vercelApiKeys,
        files,
        providerSettings,
        promptId,
        contextOptimization: false,
        chatMode,
        designScheme,
      });

      return result.toDataStreamResponse({
        headers: {
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
        getErrorMessage: (error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (
            errorMessage.includes('API key') ||
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('authentication')
          ) {
            return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
          }

          return `Custom error: ${errorMessage}`;
        },
      });
    } catch (error: any) {
      logger.error(error);

      return new Response(
        JSON.stringify({
          error: true,
          message: error.message || 'An unexpected error occurred',
          statusCode: error.statusCode || 500,
          isRetryable: error.isRetryable !== false,
          provider: error.provider || 'unknown',
        }),
        {
          status: error.statusCode || 500,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Error',
        },
      );
    }
  }

  const [
    { MAX_RESPONSE_SEGMENTS, MAX_TOKENS },
    promptsModule,
    streamTextModule,
    switchableStreamModule,
    selectContextModule,
    constantsModule,
    createSummaryModule,
    mcpServiceModule,
    streamRecoveryModule,
  ] = await Promise.all([
    import('~/lib/.server/llm/constants'),
    import('~/lib/common/prompts/prompts'),
    import('~/lib/.server/llm/stream-text'),
    import('~/lib/.server/llm/switchable-stream'),
    import('~/lib/.server/llm/select-context'),
    import('~/utils/constants'),
    import('~/lib/.server/llm/create-summary'),
    import('~/lib/services/mcpService'),
    import('~/lib/.server/llm/stream-recovery'),
  ]);
  const { CONTINUE_PROMPT } = promptsModule;
  const { streamText } = streamTextModule;
  const SwitchableStream = switchableStreamModule.default;
  const { getFilePaths, selectContext } = selectContextModule;
  const { WORK_DIR } = constantsModule;
  const { createSummary } = createSummaryModule;
  const { MCPService } = mcpServiceModule;
  const { StreamRecoveryManager } = streamRecoveryModule;
  const streamRecovery = new StreamRecoveryManager({
    timeout: 45000,
    maxRetries: 2,
    onTimeout: () => {
      logger.warn('Stream timeout - attempting recovery');
    },
  });
  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  let progressCounter: number = 1;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    return createDataStreamResponse({
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
      async execute(dataStream) {
        streamRecovery.startMonitoring();

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        const processedMessages = await mcpService.processToolInvocations(messages, dataStream);

        if (processedMessages.length > 3) {
          messageSliceId = processedMessages.length - 3;
        }

        if (filePaths.length > 0 && contextOptimization) {
          logger.debug('Generating Chat Summary');
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Analysing Request',
          } satisfies ProgressAnnotation);

          // Create a summary of the chat
          console.log(`Messages count: ${processedMessages.length}`);

          summary = await createSummary({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Analysis Complete',
          } satisfies ProgressAnnotation);

          dataStream.writeMessageAnnotation({
            type: 'chatSummary',
            summary,
            chatId: processedMessages.slice(-1)?.[0]?.id,
          } as ContextAnnotation);

          // Update context buffer
          logger.debug('Updating Context Buffer');
          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Determining Files to Read',
          } satisfies ProgressAnnotation);

          // Select context files
          console.log(`Messages count: ${processedMessages.length}`);
          filteredFiles = await selectContext({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            summary,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
          }

          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: Object.keys(filteredFiles).map((key) => {
              let path = key;

              if (path.startsWith(WORK_DIR)) {
                path = path.replace(WORK_DIR, '');
              }

              return path;
            }),
          } as ContextAnnotation);

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          } satisfies ProgressAnnotation);

          // logger.debug('Code Files Selected');
        }

        const options: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: mcpService.toolsWithoutExecute,
          maxSteps: maxLLMSteps,
          onStepFinish: ({ toolCalls }) => {
            // add tool call annotations for frontend processing
            toolCalls.forEach((toolCall) => {
              mcpService.processToolCall(toolCall, dataStream);
            });
          },
          onFinish: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            const lastUserMessage = processedMessages.filter((x) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractMessageProperties(lastUserMessage);
            processedMessages.push({ id: generateId(), role: 'assistant', content });
            processedMessages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              contextFiles: filteredFiles,
              chatMode,
              designScheme,
              summary,
              messageSliceId,
            });

            result.mergeIntoDataStream(dataStream);

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error: any = part.error;
                  logger.error(`${error}`);

                  return;
                }
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        const result = await streamText({
          messages: [...processedMessages],
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          chatMode,
          designScheme,
          summary,
          messageSliceId,
        });

        (async () => {
          for await (const part of result.fullStream) {
            streamRecovery.updateActivity();

            if (part.type === 'error') {
              const error: any = part.error;
              logger.error('Streaming error:', error);
              streamRecovery.stop();

              // Enhanced error handling for common streaming issues
              if (error.message?.includes('Invalid JSON response')) {
                logger.error('Invalid JSON response detected - likely malformed API response');
              } else if (error.message?.includes('token')) {
                logger.error('Token-related error detected - possible token limit exceeded');
              }

              return;
            }
          }
          streamRecovery.stop();
        })();
        result.mergeIntoDataStream(dataStream);
      },
      onError: (error: any) => {
        // Provide more specific error messages for common issues
        const errorMessage = error.message || 'Unknown error';

        if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
        }

        if (
          errorMessage.includes('API key') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('authentication')
        ) {
          return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
        }

        if (errorMessage.includes('token') && errorMessage.includes('limit')) {
          return 'Custom error: Token limit exceeded. The conversation is too long for the selected model. Try using a model with larger context window or start a new conversation.';
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          return 'Custom error: API rate limit exceeded. Please wait a moment before trying again.';
        }

        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          return 'Custom error: Network error. Please check your internet connection and try again.';
        }

        return `Custom error: ${errorMessage}`;
      },
    });
  } catch (error: any) {
    logger.error(error);

    const errorResponse = {
      error: true,
      message: error.message || 'An unexpected error occurred',
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false, // Default to retryable unless explicitly false
      provider: error.provider || 'unknown',
    };

    if (error.message?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}


