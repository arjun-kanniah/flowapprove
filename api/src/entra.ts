import { ConfidentialClientApplication } from '@azure/msal-node'
import { ManagedIdentityCredential } from '@azure/identity'
import type { Config } from './config.js'

/** Who signed in, from the ID token. */
export interface EntraProfile {
  /** Tenant and object ID: stable for a person, unlike their email. */
  objectId: string
  name: string
  email: string
}

/** Microsoft sign-in, behind an interface so tests can stand in for Microsoft. */
export interface EntraSignIn {
  authUrl(params: { redirectUri: string; state: string; nonce: string; codeChallenge: string }): Promise<string>
  redeem(params: {
    redirectUri: string
    code: string
    nonce: string
    codeVerifier: string
  }): Promise<EntraProfile>
}

const SCOPES = ['openid', 'profile', 'email']
const TOKEN_EXCHANGE_SCOPE = 'api://AzureADTokenExchange/.default'

/**
 * Sign-in with Microsoft accounts (work, school or personal), as an OpenID Connect
 * authorization code flow with PKCE. The app has no client secret: it proves who it is with a
 * token from its managed identity, which the app registration trusts through a federated
 * credential. Off unless ENTRA_CLIENT_ID is set and the app runs with a managed identity.
 */
export function createEntraSignIn(config: Config): EntraSignIn | null {
  if (!config.ENTRA_CLIENT_ID || !config.AZURE_CLIENT_ID) return null
  const identity = new ManagedIdentityCredential({ clientId: config.AZURE_CLIENT_ID })
  const msal = new ConfidentialClientApplication({
    auth: {
      clientId: config.ENTRA_CLIENT_ID,
      authority: `https://login.microsoftonline.com/${config.ENTRA_TENANT}`,
      clientAssertion: async () => {
        const token = await identity.getToken(TOKEN_EXCHANGE_SCOPE)
        if (!token) throw new Error('No managed identity token for the sign-in assertion')
        return token.token
      },
    },
  })

  return {
    authUrl: ({ redirectUri, state, nonce, codeChallenge }) =>
      msal.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri,
        state,
        nonce,
        codeChallenge,
        codeChallengeMethod: 'S256',
        prompt: 'select_account',
      }),

    async redeem({ redirectUri, code, nonce, codeVerifier }) {
      // Passing the nonce makes MSAL reject an ID token that wasn't issued for this sign-in.
      // The state isn't passed: the app has already matched it to the browser's cookie, and
      // MSAL would try to decode it as a state of its own making.
      const result = await msal.acquireTokenByCode(
        { scopes: SCOPES, redirectUri, code, codeVerifier },
        { code, nonce },
      )
      // Only the ID token's claims are needed; don't keep tokens for every visitor in memory
      if (result.account) await msal.getTokenCache().removeAccount(result.account)
      const claims = result.idTokenClaims as Record<string, string | undefined>
      const email = claims.email ?? claims.preferred_username
      if (!claims.oid || !claims.tid || !email) throw new Error('ID token is missing oid, tid or email')
      return { objectId: `${claims.tid}:${claims.oid}`, name: claims.name ?? email, email: email.toLowerCase() }
    },
  }
}
