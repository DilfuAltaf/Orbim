import type { IncomingMessage, ServerResponse } from 'node:http'
import registryHandler from '../audio/registry.ts'

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return registryHandler(req, res)
}
