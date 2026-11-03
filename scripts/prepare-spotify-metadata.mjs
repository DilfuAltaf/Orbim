import fs from 'node:fs'
import path from 'node:path'
import { searchSpotifyTracksServer } from '../src/server/spotify-service.ts'

const AUDIO_DIR = path.resolve('assets/audio')

function cleanSearchQuery(filename) {
  let name = path.basename(filename, path.extname(filename))
  name = name.replace(/\([^)]*\)/g, ' ')
  name = name.replace(/\[[^\]]*\]/g, ' ')
  name = name.replace(/\b(official|music|video|audio|lyrics?|visualizer|ft\..*)\b/gi, ' ')
  name = name.replace(/[?？!_-]+/g, ' ')
  name = name.replace(/\s+/g, ' ').trim()

  // Handle specific short titles
  if (name.toLowerCase() === 'cinnamon girl') {
    return 'Lana Del Rey Cinnamon Girl'
  }
  if (name.toLowerCase() === 'starboy') {
    return 'The Weeknd Starboy'
  }
  return name
}

async function main() {
  const files = fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3'))
  console.log(`Found ${files.length} audio files in ${AUDIO_DIR}`)

  const tracks = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const relativeAudioPath = `assets/audio/${file}`
    const query = cleanSearchQuery(file)
    console.log(`[${i + 1}/${files.length}] Searching Spotify for: "${query}"...`)

    try {
      const results = await searchSpotifyTracksServer(query, { limit: 3 })
      if (results && results.length > 0) {
        const top = results[0]
        console.log(`   -> Matched: "${top.title}" by ${top.artistName} (${top.albumName})`)
        tracks.push({
          title: top.title,
          artist: top.artistName,
          album: top.albumName,
          artworkUrl: top.artworkUrl,
          durationSeconds: top.durationSeconds,
          provider: 'spotify',
          providerTrackId: top.id,
          externalUrl: top.spotifyUrl,
          audioFile: relativeAudioPath,
        })
      } else {
        console.warn(`   -> No Spotify match found for "${query}". Using filename.`)
        tracks.push({
          title: query,
          artist: 'Unknown Artist',
          audioFile: relativeAudioPath,
        })
      }
    } catch (err) {
      console.error(`   -> Error searching for "${query}":`, err.message)
      tracks.push({
        title: query,
        artist: 'Unknown Artist',
        audioFile: relativeAudioPath,
      })
    }

    // Small delay to be polite to Spotify API rate limiter
    await new Promise(r => setTimeout(r, 200))
  }

  const outputPath = path.resolve('track-input.json')
  fs.writeFileSync(outputPath, JSON.stringify(tracks, null, 2), 'utf8')
  console.log(`\nSuccessfully generated ${tracks.length} tracks with Spotify metadata in ${outputPath}!`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
