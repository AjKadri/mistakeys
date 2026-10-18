import { timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';

export const DEFAULT_GITLAB_JWKS_URL = 'https://gitlab.com/oauth/discovery/keys';
export const DEFAULT_GITLAB_ISSUER = 'https://gitlab.com';
export const DEFAULT_GITLAB_AUDIENCE = 'https://mistakeys.ajkadri.dev';
export const DEFAULT_GITLAB_PROJECT_PATH = 'gitlab-ai-hackathon/transcend-october-2026/43339651/showcase';

export interface GitLabIdTokenVerifierOptions {
  jwksUrl?: string;
  issuer?: string;
  audience?: string;
  projectPath?: string;
  fetch?: typeof fetch;
  onJwksFetchFailure?: () => void;
}

export interface GitLabIdTokenVerifier {
  verify(token: string): Promise<boolean>;
}

export function createGitLabIdTokenVerifier(options: GitLabIdTokenVerifierOptions = {}): GitLabIdTokenVerifier {
  let jwksFetchFailureReported = false;
  const reportJwksFetchFailure = (): void => {
    if (jwksFetchFailureReported) return;
    jwksFetchFailureReported = true;
    options.onJwksFetchFailure?.();
  };
  const fetchFn = options.fetch ?? fetch;
  const remoteJwksOptions = {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
    [customFetch]: async (url: string, init: RequestInit): Promise<Response> => {
      try {
        const response = await fetchFn(url, init);
        if (!response.ok) reportJwksFetchFailure();
        return response;
      } catch {
        reportJwksFetchFailure();
        throw new Error('gitlab_jwks_fetch_failed');
      }
    },
  };
  const jwks = createRemoteJWKSet(new URL(options.jwksUrl ?? DEFAULT_GITLAB_JWKS_URL), remoteJwksOptions);
  const issuer = options.issuer ?? DEFAULT_GITLAB_ISSUER;
  const audience = options.audience ?? DEFAULT_GITLAB_AUDIENCE;
  const projectPath = options.projectPath ?? DEFAULT_GITLAB_PROJECT_PATH;

  return {
    async verify(token: string): Promise<boolean> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ['RS256'],
          issuer,
          audience,
          requiredClaims: ['iss', 'aud', 'exp'],
          clockTolerance: 0,
        });
        return payload.project_path === projectPath;
      } catch {
        return false;
      }
    },
  };
}

function constantTimeTokenEquals(suppliedToken: string, expectedToken: string): boolean {
  const supplied = Buffer.from(suppliedToken);
  const expected = Buffer.from(expectedToken);
  const length = Math.max(supplied.length, expected.length);
  const suppliedPadded = Buffer.alloc(length);
  const expectedPadded = Buffer.alloc(length);
  supplied.copy(suppliedPadded);
  expected.copy(expectedPadded);
  return timingSafeEqual(suppliedPadded, expectedPadded) && supplied.length === expected.length;
}

export async function isAuthorizedBearer(
  authorization: string,
  staticToken: string | undefined,
  idTokenVerifier: GitLabIdTokenVerifier,
): Promise<boolean> {
  const prefix = 'Bearer ';
  if (!authorization.startsWith(prefix)) return false;

  const suppliedToken = authorization.slice(prefix.length);
  if (!suppliedToken) return false;
  if (staticToken && constantTimeTokenEquals(suppliedToken, staticToken)) return true;
  return idTokenVerifier.verify(suppliedToken);
}
