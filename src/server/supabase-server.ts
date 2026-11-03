/**
 * Server-Side Supabase Client & Token Verification Helper.
 *
 * Implements:
 * - Server-side Supabase client factory.
 * - Supabase JWT bearer token extraction and verification.
 * - HTTP request body parsing (JSON and buffer) and standard response helpers.
 * - Never trusts user-supplied IDs from client payloads without cryptographic token verification.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

export interface SupabaseServerConfig {
  supabaseUrl: string | null
  supabaseAnonKey: string | null
  supabaseServiceKey: string | null
}

let cachedConfig: SupabaseServerConfig | null = null

/**
 * Loads Supabase credentials from process.env or fallback to .env.local / .env.
 */
export function getSupabaseServerConfig(envOverride?: Record<string, string | undefined>): SupabaseServerConfig {
  const env = envOverride || process.env

  let supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || null
  let supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || null
  let supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || null

  if (!envOverride && (!supabaseUrl || !supabaseAnonKey)) {
    const cwd = process.cwd()
    const envFiles = ['.env.local', '.env']

    for (const file of envFiles) {
      const fullPath = path.resolve(cwd, file)
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8')
          for (const line of content.split('\n')) {
            const trimmed = line.trim()
            if (!trimmed || trimmed.startsWith('#')) continue
            const eqIdx = trimmed.indexOf('=')
            if (eqIdx === -1) continue
            const key = trimmed.substring(0, eqIdx).trim()
            let val = trimmed.substring(eqIdx + 1).trim()
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1)
            }

            if (!supabaseUrl && (key === 'VITE_SUPABASE_URL' || key === 'SUPABASE_URL')) {
              supabaseUrl = val
            }
            if (!supabaseAnonKey && (key === 'VITE_SUPABASE_ANON_KEY' || key === 'SUPABASE_ANON_KEY')) {
              supabaseAnonKey = val
            }
            if (!supabaseServiceKey && (key === 'SUPABASE_SERVICE_ROLE_KEY' || key === 'SUPABASE_SERVICE_KEY')) {
              supabaseServiceKey = val
            }
          }
        } catch {
          // ignore
        }
      }
      if (supabaseUrl && supabaseAnonKey) break
    }
  }

  cachedConfig = { supabaseUrl, supabaseAnonKey, supabaseServiceKey }
  return cachedConfig
}

/**
 * Creates a server-side Supabase client.
 * If a bearerToken is supplied, requests made with this client include the user's JWT,
 * causing PostgreSQL to enforce Row Level Security for that user (auth.uid()).
 */
export function createServerSupabaseClient(
  bearerToken?: string | null,
  envOverride?: Record<string, string | undefined>,
): SupabaseClient | null {
  const config = getSupabaseServerConfig(envOverride)
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return null
  }

  const keyToUse = config.supabaseServiceKey || config.supabaseAnonKey
  const headers: Record<string, string> = {}
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`
  }

  return createClient(config.supabaseUrl, keyToUse, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers,
    },
  })
}

/**
 * Extracts the Bearer token from the HTTP Authorization header.
 */
export function extractBearerToken(req: IncomingMessage): string | null {
  const authHeader = req.headers.authorization || req.headers.Authorization
  if (!authHeader) return null
  const str = Array.isArray(authHeader) ? authHeader[0] : authHeader
  const match = str.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/**
 * Cryptographically verifies a Supabase access token server-side.
 * Returns the verified Supabase User if valid, or null if invalid or expired.
 */
export async function verifySupabaseToken(
  token: string | null | undefined,
  envOverride?: Record<string, string | undefined>,
): Promise<User | null> {
  if (!token) return null
  const client = createServerSupabaseClient(undefined, envOverride)
  if (!client) return null

  try {
    const { data, error } = await client.auth.getUser(token)
    if (error || !data?.user) {
      return null
    }
    return data.user
  } catch {
    return null
  }
}

/**
 * Helper to parse JSON body from incoming HTTP request.
 */
export async function parseJsonBody<T = unknown>(req: IncomingMessage): Promise<T> {
  const bodyBuffer = await readRawBody(req)
  const bodyStr = bodyBuffer.toString('utf8').trim()
  if (!bodyStr) return {} as T
  return JSON.parse(bodyStr) as T
}

/**
 * Helper to read raw body buffer from incoming HTTP request.
 */
export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // If body was already parsed by framework / middleware
    const anyReq = req as unknown as { body?: unknown }
    if (anyReq.body !== undefined && anyReq.body !== null) {
      if (Buffer.isBuffer(anyReq.body)) {
        return resolve(anyReq.body)
      }
      if (typeof anyReq.body === 'string') {
        return resolve(Buffer.from(anyReq.body, 'utf8'))
      }
      if (typeof anyReq.body === 'object') {
        return resolve(Buffer.from(JSON.stringify(anyReq.body), 'utf8'))
      }
    }

    // If method has no body and no body headers are present, resolve immediately
    const hasBodyHeaders =
      Boolean(req.headers?.['content-length']) ||
      Boolean(req.headers?.['transfer-encoding']) ||
      Boolean(req.headers?.['content-type'])

    if (!hasBodyHeaders && (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD')) {
      return resolve(Buffer.from([]))
    }

    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (err) => {
      reject(err)
    })
  })
}

/**
 * Helper to send a standard JSON response.
 */
export function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
  headers?: Record<string, string>,
): void {
  const jsonStr = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(jsonStr),
    'Cache-Control': headers?.['Cache-Control'] || 'no-cache, no-store, must-revalidate',
    ...headers,
  })
  res.end(jsonStr)
}

/**
 * Helper to send a standard JSON error response.
 */
export function sendError(
  res: ServerResponse,
  statusCode: number,
  error: string,
  extra?: Record<string, unknown>,
): void {
  sendJson(res, statusCode, {
    error,
    ...extra,
  })
}
