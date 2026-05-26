import { describe, it, expect } from 'vitest'
import {
  getGoogleOAuthConfig,
  getAppleOAuthConfig,
  getGitHubOAuthConfig,
  getConfiguredOAuthProviders,
  validateOAuthEnv,
  getVapidConfig,
} from '~/lib/env.server'

/**
 * Tests for OAuth environment configuration validation.
 *
 * These tests validate that required environment variables for OAuth
 * providers (Apple, GitHub, and Google) are properly checked before use.
 *
 * Required environment variables:
 * - Apple OAuth: APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
 * - GitHub OAuth: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
 * - Google OAuth: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

describe('Environment Config Validation', () => {
  describe('getGoogleOAuthConfig', () => {
    it('returns config when all Google OAuth env vars are present', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      }

      const config = getGoogleOAuthConfig(env)

      expect(config).toEqual({
        clientId: 'test-google-client-id',
        clientSecret: 'test-google-client-secret',
      })
    })

    it('throws error when GOOGLE_CLIENT_ID is missing', () => {
      const env = {
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      }

      expect(() => getGoogleOAuthConfig(env)).toThrow(
        'Missing required environment variable: GOOGLE_CLIENT_ID'
      )
    })

    it('throws error when GOOGLE_CLIENT_SECRET is missing', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
      }

      expect(() => getGoogleOAuthConfig(env)).toThrow(
        'Missing required environment variable: GOOGLE_CLIENT_SECRET'
      )
    })

    it('throws error when both Google OAuth env vars are missing', () => {
      const env = {}

      expect(() => getGoogleOAuthConfig(env)).toThrow(
        'Missing required environment variable: GOOGLE_CLIENT_ID'
      )
    })

    it('throws error when GOOGLE_CLIENT_ID is empty string', () => {
      const env = {
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      }

      expect(() => getGoogleOAuthConfig(env)).toThrow(
        'Missing required environment variable: GOOGLE_CLIENT_ID'
      )
    })

    it('throws error when GOOGLE_CLIENT_SECRET is empty string', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: '',
      }

      expect(() => getGoogleOAuthConfig(env)).toThrow(
        'Missing required environment variable: GOOGLE_CLIENT_SECRET'
      )
    })

    it('throws error when Google OAuth env vars are placeholders', () => {
      expect(() => getGoogleOAuthConfig({
        GOOGLE_CLIENT_ID: '""',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      })).toThrow('Missing required environment variable: GOOGLE_CLIENT_ID')

      expect(() => getGoogleOAuthConfig({
        GOOGLE_CLIENT_ID: 'not yet enabled',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      })).toThrow('Missing required environment variable: GOOGLE_CLIENT_ID')
    })
  })

  describe('getGitHubOAuthConfig', () => {
    it('returns config when all GitHub OAuth env vars are present', () => {
      const env = {
        GITHUB_CLIENT_ID: 'test-github-client-id',
        GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      }

      const config = getGitHubOAuthConfig(env)

      expect(config).toEqual({
        clientId: 'test-github-client-id',
        clientSecret: 'test-github-client-secret',
      })
    })

    it('throws error when GITHUB_CLIENT_ID is missing', () => {
      const env = {
        GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      }

      expect(() => getGitHubOAuthConfig(env)).toThrow(
        'Missing required environment variable: GITHUB_CLIENT_ID'
      )
    })

    it('throws error when GITHUB_CLIENT_SECRET is missing', () => {
      const env = {
        GITHUB_CLIENT_ID: 'test-github-client-id',
      }

      expect(() => getGitHubOAuthConfig(env)).toThrow(
        'Missing required environment variable: GITHUB_CLIENT_SECRET'
      )
    })

    it('throws error when GitHub OAuth env vars are empty', () => {
      expect(() => getGitHubOAuthConfig({
        GITHUB_CLIENT_ID: '',
        GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      })).toThrow('Missing required environment variable: GITHUB_CLIENT_ID')

      expect(() => getGitHubOAuthConfig({
        GITHUB_CLIENT_ID: 'test-github-client-id',
        GITHUB_CLIENT_SECRET: '',
      })).toThrow('Missing required environment variable: GITHUB_CLIENT_SECRET')
    })
  })

  describe('getAppleOAuthConfig', () => {
    it('returns config when all Apple OAuth env vars are present', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      const config = getAppleOAuthConfig(env)

      expect(config).toEqual({
        clientId: 'test-apple-client-id',
        teamId: 'test-apple-team-id',
        keyId: 'test-apple-key-id',
        privateKey: 'test-apple-private-key',
      })
    })

    it('throws error when APPLE_CLIENT_ID is missing', () => {
      const env = {
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_CLIENT_ID'
      )
    })

    it('throws error when APPLE_TEAM_ID is missing', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_TEAM_ID'
      )
    })

    it('throws error when APPLE_KEY_ID is missing', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_KEY_ID'
      )
    })

    it('throws error when APPLE_PRIVATE_KEY is missing', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'test-apple-key-id',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_PRIVATE_KEY'
      )
    })

    it('throws error when all Apple OAuth env vars are missing', () => {
      const env = {}

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_CLIENT_ID'
      )
    })

    it('throws error when APPLE_CLIENT_ID is empty string', () => {
      const env = {
        APPLE_CLIENT_ID: '',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_CLIENT_ID'
      )
    })

    it('throws error when APPLE_TEAM_ID is empty string', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: '',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_TEAM_ID'
      )
    })

    it('throws error when APPLE_KEY_ID is empty string', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: '',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_KEY_ID'
      )
    })

    it('throws error when APPLE_PRIVATE_KEY is empty string', () => {
      const env = {
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: '',
      }

      expect(() => getAppleOAuthConfig(env)).toThrow(
        'Missing required environment variable: APPLE_PRIVATE_KEY'
      )
    })
  })

  describe('validateOAuthEnv', () => {
    it('returns true when all OAuth env vars are present', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        GITHUB_CLIENT_ID: 'test-github-client-id',
        GITHUB_CLIENT_SECRET: 'test-github-client-secret',
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'test-apple-key-id',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(validateOAuthEnv(env)).toBe(true)
    })

    it('throws error listing all missing env vars when multiple are missing', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GITHUB_CLIENT_ID: 'test-github-client-id',
        APPLE_CLIENT_ID: 'test-apple-client-id',
      }

      expect(() => validateOAuthEnv(env)).toThrow(
        /Missing required environment variables:.*GOOGLE_CLIENT_SECRET.*GITHUB_CLIENT_SECRET.*APPLE_TEAM_ID.*APPLE_KEY_ID.*APPLE_PRIVATE_KEY/
      )
    })

    it('throws error when all OAuth env vars are missing', () => {
      const env = {}

      expect(() => validateOAuthEnv(env)).toThrow(
        /Missing required environment variables:/
      )
    })

    it('treats empty strings as missing', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'test-google-client-id',
        GOOGLE_CLIENT_SECRET: '',
        GITHUB_CLIENT_ID: '',
        GITHUB_CLIENT_SECRET: 'test-github-client-secret',
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: '',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => validateOAuthEnv(env)).toThrow(
        /Missing required environment variables:.*GOOGLE_CLIENT_SECRET.*GITHUB_CLIENT_ID.*APPLE_KEY_ID/
      )
    })

    it('treats placeholder values as missing', () => {
      const env = {
        GOOGLE_CLIENT_ID: 'not yet enabled',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
        GITHUB_CLIENT_ID: '""',
        GITHUB_CLIENT_SECRET: 'test-github-client-secret',
        APPLE_CLIENT_ID: 'test-apple-client-id',
        APPLE_TEAM_ID: 'test-apple-team-id',
        APPLE_KEY_ID: 'not configured',
        APPLE_PRIVATE_KEY: 'test-apple-private-key',
      }

      expect(() => validateOAuthEnv(env)).toThrow(
        /Missing required environment variables:.*GOOGLE_CLIENT_ID.*GITHUB_CLIENT_ID.*APPLE_KEY_ID/
      )
    })
  })

  describe('getConfiguredOAuthProviders', () => {
    it('returns configured providers in product order', () => {
      expect(getConfiguredOAuthProviders({
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GITHUB_CLIENT_ID: 'github-client',
        GITHUB_CLIENT_SECRET: 'github-secret',
        APPLE_CLIENT_ID: 'apple-client',
        APPLE_TEAM_ID: 'team',
        APPLE_KEY_ID: 'key',
        APPLE_PRIVATE_KEY: 'private',
      })).toEqual(['google', 'github', 'apple'])
    })

    it('omits partially configured providers', () => {
      expect(getConfiguredOAuthProviders({
        GOOGLE_CLIENT_ID: 'google-client',
        GITHUB_CLIENT_SECRET: 'github-secret',
        APPLE_CLIENT_ID: 'apple-client',
        APPLE_TEAM_ID: 'team',
        APPLE_KEY_ID: 'key',
      })).toEqual([])
    })

    it('omits providers configured only with placeholders', () => {
      expect(getConfiguredOAuthProviders({
        GOOGLE_CLIENT_ID: 'not yet enabled',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GITHUB_CLIENT_ID: 'github-client',
        GITHUB_CLIENT_SECRET: '""',
        APPLE_CLIENT_ID: 'apple-client',
        APPLE_TEAM_ID: 'team',
        APPLE_KEY_ID: 'key',
        APPLE_PRIVATE_KEY: 'not configured',
      })).toEqual([])
    })
  })

  describe('getVapidConfig', () => {
    it('returns the VAPID config when all three env vars are present', () => {
      const env = {
        VAPID_PUBLIC_KEY: 'pub-key',
        VAPID_PRIVATE_KEY: 'priv-key',
        VAPID_SUBJECT: 'mailto:test@example.com',
      }

      expect(getVapidConfig(env)).toEqual({
        publicKey: 'pub-key',
        privateKey: 'priv-key',
        subject: 'mailto:test@example.com',
      })
    })

    it('throws when VAPID_PUBLIC_KEY is missing', () => {
      const env = {
        VAPID_PRIVATE_KEY: 'priv-key',
        VAPID_SUBJECT: 'mailto:test@example.com',
      }
      expect(() => getVapidConfig(env)).toThrow(
        'Missing required environment variable: VAPID_PUBLIC_KEY',
      )
    })

    it('throws when VAPID_PRIVATE_KEY is missing', () => {
      const env = {
        VAPID_PUBLIC_KEY: 'pub-key',
        VAPID_SUBJECT: 'mailto:test@example.com',
      }
      expect(() => getVapidConfig(env)).toThrow(
        'Missing required environment variable: VAPID_PRIVATE_KEY',
      )
    })

    it('throws when VAPID_SUBJECT is missing', () => {
      const env = {
        VAPID_PUBLIC_KEY: 'pub-key',
        VAPID_PRIVATE_KEY: 'priv-key',
      }
      expect(() => getVapidConfig(env)).toThrow(
        'Missing required environment variable: VAPID_SUBJECT',
      )
    })

    it('throws when VAPID_PUBLIC_KEY is empty string', () => {
      expect(() =>
        getVapidConfig({
          VAPID_PUBLIC_KEY: '',
          VAPID_PRIVATE_KEY: 'p',
          VAPID_SUBJECT: 's',
        }),
      ).toThrow('Missing required environment variable: VAPID_PUBLIC_KEY')
    })

    it('throws when VAPID_PRIVATE_KEY is empty string', () => {
      expect(() =>
        getVapidConfig({
          VAPID_PUBLIC_KEY: 'p',
          VAPID_PRIVATE_KEY: '',
          VAPID_SUBJECT: 's',
        }),
      ).toThrow('Missing required environment variable: VAPID_PRIVATE_KEY')
    })

    it('throws when VAPID_SUBJECT is empty string', () => {
      expect(() =>
        getVapidConfig({
          VAPID_PUBLIC_KEY: 'p',
          VAPID_PRIVATE_KEY: 'k',
          VAPID_SUBJECT: '',
        }),
      ).toThrow('Missing required environment variable: VAPID_SUBJECT')
    })

    it('throws when env is fully empty', () => {
      expect(() => getVapidConfig({})).toThrow(
        'Missing required environment variable: VAPID_PUBLIC_KEY',
      )
    })
  })
})
