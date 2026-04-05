import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('api.mcp-check');

export async function loader() {
  try {
    if (process.env.VERCEL) {
      return Response.json({});
    }

    const { MCPService } = await import('~/lib/services/mcpService');
    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.checkServersAvailabilities();

    return Response.json(serverTools);
  } catch (error) {
    logger.error('Error checking MCP servers:', error);
    return Response.json({ error: 'Failed to check MCP servers' }, { status: 500 });
  }
}
