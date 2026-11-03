#!/usr/bin/env node
/**
 * scripts/sync-local-audio-to-supabase.mjs
 *
 * Migrates local audio files from assets/audio/global/ directly to Supabase Storage ('track-audio' bucket).
 * Run this after creating the 'track-audio' bucket in Supabase Dashboard (or via SQL).
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  const envFiles = ['.env.local', '.env']
  const envMap = { ...process.env }

  for (const file of envFiles) {
    const fullPath = path.resolve(process.cwd(), file)
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const eqIdx = trimmed.indexOf('=')
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim()
            let val = trimmed.substring(eqIdx + 1).trim()
            if (val.startsWith('"') && val.endsWith('"')) {
              val = val.slice(1, -1)
            } else if (val.startsWith("'") && val.endsWith("'")) {
              val = val.slice(1, -1)
            }
            if (!envMap[key]) {
              envMap[key] = val
            }
          }
        }
      } catch {
        // Silently continue
      }
    }
  }

  return envMap
}

async function main() {
  const env = loadEnv()
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_ANON_KEY
  const operatorEmail = env.OPERATOR_EMAIL
  const operatorPassword = env.OPERATOR_PASSWORD

  if (!supabaseUrl || !supabaseKey) {
    console.error('Error: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing in .env.local.')
    process.exit(1)
  }

  const client = createClient(supabaseUrl, supabaseKey)

  if (operatorEmail && operatorPassword) {
    console.log(`Signing in as operator (${operatorEmail})...`)
    const { error: authErr } = await client.auth.signInWithPassword({
      email: operatorEmail,
      password: operatorPassword,
    })
    if (authErr) {
      console.warn('Operator sign-in warning:', authErr.message)
    } else {
      console.log('Operator signed in successfully.')
    }
  }

  const bucketName = 'track-audio'
  const registryPath = path.resolve(process.cwd(), 'assets/audio/global-audio-registry.json')

  if (!fs.existsSync(registryPath)) {
    console.log('No local global-audio-registry.json found. Nothing to sync.')
    return
  }

  const rawJson = fs.readFileSync(registryPath, 'utf8')
  const registry = JSON.parse(rawJson)

  console.log(`Found ${Object.keys(registry).length} tracks in local registry. Checking Supabase Storage...`)

  let updatedCount = 0

  for (const [trackId, record] of Object.entries(registry)) {
    if (!record.audioUrl || !record.audioUrl.startsWith('/assets/audio/global/')) {
      continue
    }

    const localFileName = path.basename(record.audioUrl)
    const localFilePath = path.resolve(process.cwd(), 'assets/audio/global', localFileName)

    if (!fs.existsSync(localFilePath)) {
      console.warn(`File not found locally: ${localFilePath}`)
      continue
    }

    const fileBuffer = fs.readFileSync(localFilePath)
    const storagePath = `global/${localFileName}`

    console.log(`Uploading ${record.title || trackId} to Supabase Storage (${storagePath})...`)

    const { error: uploadErr } = await client.storage
      .from(bucketName)
      .upload(storagePath, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: true,
      })

    if (uploadErr) {
      console.error(`Failed to upload ${trackId}:`, uploadErr.message)
      continue
    }

    const { data: urlData } = client.storage.from(bucketName).getPublicUrl(storagePath)
    if (!urlData?.publicUrl) {
      console.error(`Failed to get public URL for ${trackId}`)
      continue
    }

    record.audioUrl = urlData.publicUrl
    record.storagePath = storagePath
    record.audioSourceType = 'storage'
    record.updatedAt = new Date().toISOString()
    updatedCount++

    // Update database playlist_tracks as well
    await client
      .from('playlist_tracks')
      .update({
        audio_url: urlData.publicUrl,
        storage_path: storagePath,
        audio_source_type: 'storage',
      })
      .eq('provider_track_id', record.providerTrackId || trackId)

    console.log(`✓ Uploaded & updated: ${urlData.publicUrl}`)
  }

  if (updatedCount > 0) {
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8')
    console.log(`Successfully migrated ${updatedCount} tracks to Supabase Storage!`)

    // Upload the registry manifest itself to Supabase Storage
    const manifestBuffer = Buffer.from(JSON.stringify(registry, null, 2), 'utf8')
    await client.storage.from(bucketName).upload('global-audio-registry.json', manifestBuffer, {
      contentType: 'application/json',
      upsert: true,
    })
    console.log('✓ Uploaded global-audio-registry.json manifest to Supabase Storage.')
  } else {
    console.log('All tracks are already stored in Supabase Storage or no files needed migration.')
  }
}

main().catch((err) => {
  console.error('Migration error:', err)
  process.exit(1)
})
