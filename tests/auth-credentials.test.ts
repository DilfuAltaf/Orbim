import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'

const store = new Map<string, string>()
const mockStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value))
  },
  removeItem: (key: string) => {
    store.delete(key)
  },
  clear: () => {
    store.clear()
  },
  get length() {
    return store.size
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
}
;(globalThis as any).window = { localStorage: mockStorage }
;(globalThis as any).localStorage = mockStorage

import {
  DUPLICATE_ACCOUNT_MESSAGE,
  IDENTIFIER_MISSING_AT_MESSAGE,
  IDENTIFIER_REQUIRED_MESSAGE,
  PASSWORD_TOO_SHORT_MESSAGE,
  normalizeIdentifier,
  validateIdentifier,
  validateNewPassword,
} from '../src/lib/auth-credentials.ts'
import {
  authenticateLocalUser,
  registerLocalUser,
} from '../src/services/auth/local-auth-store.ts'

describe('Registration identifier rules (minimal @-only rule)', () => {
  it('accepts a regular email address', () => {
    assert.equal(validateIdentifier('abc@gmail.com'), null)
  })

  it('accepts an identifier whose domain does not exist', () => {
    assert.equal(validateIdentifier('random@anything'), null)
  })

  it('accepts a trailing @ because no domain is required', () => {
    assert.equal(validateIdentifier('test@'), null)
  })

  it('rejects empty and whitespace-only input', () => {
    assert.equal(validateIdentifier(''), IDENTIFIER_REQUIRED_MESSAGE)
    assert.equal(validateIdentifier('   '), IDENTIFIER_REQUIRED_MESSAGE)
  })

  it('rejects input without an @ character', () => {
    assert.equal(validateIdentifier('abcgmail.com'), IDENTIFIER_MISSING_AT_MESSAGE)
    assert.equal(validateIdentifier('random'), IDENTIFIER_MISSING_AT_MESSAGE)
  })

  it('uses the same normalization for registration and sign-in', () => {
    assert.equal(normalizeIdentifier('  ABC@Gmail.COM '), 'abc@gmail.com')
    assert.equal(normalizeIdentifier('Random@Anything'), 'random@anything')
  })
})

describe('Password rules', () => {
  it('requires a password', () => {
    assert.equal(validateNewPassword(''), 'Enter a password.')
  })

  it('rejects a password shorter than the minimum length', () => {
    assert.equal(validateNewPassword('12345'), PASSWORD_TOO_SHORT_MESSAGE)
  })

  it('accepts a password that meets the minimum length', () => {
    assert.equal(validateNewPassword('123456'), null)
  })
})

describe('Demo-mode registration and sign-in', () => {
  beforeEach(() => {
    store.clear()
  })

  it('registers an arbitrary email-like identifier', () => {
    const result = registerLocalUser('abc@gmail.com', 'secret1', 'Alice')
    assert.equal(result.error, null)
    assert.equal(result.user?.email, 'abc@gmail.com')
  })

  it('rejects a duplicate identifier instead of overwriting the account', () => {
    const first = registerLocalUser('random@anything', 'secret1', 'Alice')
    assert.ok(first.user)

    const duplicate = registerLocalUser('RANDOM@anything', 'another1', 'Mallory')
    assert.equal(duplicate.user, null)
    assert.equal(duplicate.error, DUPLICATE_ACCOUNT_MESSAGE)

    // The original password still works, so the account was not taken over.
    const signIn = authenticateLocalUser('random@anything', 'secret1')
    assert.equal(signIn.error, null)
    assert.equal(signIn.user?.id, first.user.id)
  })

  it('signs in with the same identifier and password that were registered', () => {
    const registered = registerLocalUser('test@', 'secret1', 'Bob')
    const signIn = authenticateLocalUser('Test@', 'secret1')
    assert.equal(signIn.error, null)
    assert.equal(signIn.user?.id, registered.user?.id)
  })

  it('rejects an incorrect password', () => {
    registerLocalUser('abc@gmail.com', 'secret1', 'Alice')
    const signIn = authenticateLocalUser('abc@gmail.com', 'wrong-password')
    assert.equal(signIn.user, null)
    assert.equal(signIn.error, 'Incorrect password. Try again.')
  })

  it('rejects sign-in for an unknown identifier without creating an account', () => {
    const signIn = authenticateLocalUser('nobody@nowhere', 'secret1')
    assert.equal(signIn.user, null)
    assert.match(signIn.error ?? '', /No account found/i)

    const registration = registerLocalUser('nobody@nowhere', 'secret1', 'Nobody')
    assert.equal(registration.error, null)
  })
})
