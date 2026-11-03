#!/usr/bin/env node
/**
 * scripts/create-synthetic-fixture.mjs
 *
 * Generates a short, non-copyrighted synthetic PCM WAV audio fixture for local testing.
 * Zero external dependencies. Uses standard Node.js Buffer and fs.
 */

import fs from 'node:fs'
import path from 'node:path'

export function generateSyntheticWav(durationSeconds = 0.5, frequency = 440, sampleRate = 44100) {
  const numSamples = Math.floor(sampleRate * durationSeconds)
  const dataSize = numSamples * 2 // 16-bit mono
  const fileSize = 44 + dataSize
  const buffer = Buffer.alloc(fileSize)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(fileSize - 8, 4)
  buffer.write('WAVE', 8)

  // fmt subchunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // Subchunk1Size for PCM
  buffer.writeUInt16LE(1, 20) // AudioFormat: 1 = PCM
  buffer.writeUInt16LE(1, 22) // NumChannels: 1 = Mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // ByteRate
  buffer.writeUInt16LE(2, 32) // BlockAlign
  buffer.writeUInt16LE(16, 34) // BitsPerSample: 16

  // data subchunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // PCM samples: 440 Hz sinusoidal wave with envelope
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const envelope = Math.sin((Math.PI * i) / numSamples)
    const sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.5
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)))
    buffer.writeInt16LE(intSample, 44 + i * 2)
  }

  return buffer
}

function main() {
  const targetDir = path.resolve(process.cwd(), 'assets/audio')
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true })
  }

  const targetFile = path.resolve(targetDir, 'synthetic-test-fixture.wav')
  const wavBuffer = generateSyntheticWav(0.5, 440, 44100)
  fs.writeFileSync(targetFile, wavBuffer)

  console.log(`Synthetic audio fixture generated successfully:`)
  console.log(`  Path : ${targetFile}`)
  console.log(`  Size : ${wavBuffer.length} bytes (~${(wavBuffer.length / 1024).toFixed(1)} KB)`)
  console.log(`  Type : 16-bit PCM Mono, 44.1 kHz, 440 Hz Sine`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(process.cwd(), 'scripts/create-synthetic-fixture.mjs')) {
  main()
}
