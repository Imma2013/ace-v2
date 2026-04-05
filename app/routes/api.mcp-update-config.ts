import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.mcp-update-config');

export async function action({ request }: ActionFunctionArgs) {
  try {
    const mcpConfig = (await request.json()) as { mcpServers?: Record<string, unknown> };

    if (!mcpConfig || typeof mcpConfig !== 'object') {
      return Response.json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
    }

    if (process.env.VERCEL) {
      return Response.json({});
    }

    const { MCPService } = await import('~/lib/services/mcpService');
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.updateConfig(mcpConfig as any);

    return Response.json(serverTools);
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({ error: 'Failed to update MCP config' }, { status: 500 });
  }
}


