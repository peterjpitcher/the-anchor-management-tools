import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';

export function withApiLogging(
  handler: (req: NextRequest) => Promise<NextResponse>
) {
  return async (req: NextRequest) => {
    const start = Date.now();
    const method = req.method;
    const url = req.url;
    
    try {
      const response = await handler(req);
      const duration = Date.now() - start;
      
      logger.info(`API: ${method} ${url} - ${response.status} (${duration}ms)`, {
        metadata: { method, url, status: response.status, duration }
      });
      
      return response;
    } catch (error) {
      const duration = Date.now() - start;
      
      logger.error(`API error: ${method} ${url}`, {
        error: error as Error,
        metadata: { method, url, duration }
      });
      
      throw error;
    }
  };
}