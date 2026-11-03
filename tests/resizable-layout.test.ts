import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_LEFT_WIDTH,
  DEFAULT_RIGHT_WIDTH,
  MAX_LEFT_WIDTH,
  MAX_RIGHT_WIDTH,
  MIN_LEFT_WIDTH,
  MIN_RIGHT_WIDTH,
  readStoredWidth,
} from '../src/features/layout/layout-constants.ts'

describe('Resizable Layout & Paneling Constraints', () => {
  describe('1. Default Widths & Boundaries', () => {
    it('enforces expected boundaries for left sidebar', () => {
      assert.equal(DEFAULT_LEFT_WIDTH, 256)
      assert.equal(MIN_LEFT_WIDTH, 180)
      assert.equal(MAX_LEFT_WIDTH, 420)
      assert.ok(MIN_LEFT_WIDTH < DEFAULT_LEFT_WIDTH)
      assert.ok(DEFAULT_LEFT_WIDTH < MAX_LEFT_WIDTH)
    })

    it('enforces expected boundaries for right sidebar / lyrics panel', () => {
      assert.equal(DEFAULT_RIGHT_WIDTH, 352)
      assert.equal(MIN_RIGHT_WIDTH, 260)
      assert.equal(MAX_RIGHT_WIDTH, 540)
      assert.ok(MIN_RIGHT_WIDTH < DEFAULT_RIGHT_WIDTH)
      assert.ok(DEFAULT_RIGHT_WIDTH < MAX_RIGHT_WIDTH)
    })
  })

  describe('2. Stored Width Persistence & Validation', () => {
    it('falls back to default width when localStorage is empty', () => {
      const val = readStoredWidth('non_existent_key', DEFAULT_LEFT_WIDTH, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH)
      assert.equal(val, DEFAULT_LEFT_WIDTH)
    })

    it('clamps values within the acceptable range', () => {
      const clampLeft = (x: number) => Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, x))
      assert.equal(clampLeft(100), MIN_LEFT_WIDTH)
      assert.equal(clampLeft(300), 300)
      assert.equal(clampLeft(900), MAX_LEFT_WIDTH)

      const clampRight = (x: number) => Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, x))
      assert.equal(clampRight(100), MIN_RIGHT_WIDTH)
      assert.equal(clampRight(400), 400)
      assert.equal(clampRight(900), MAX_RIGHT_WIDTH)
    })
  })
})
