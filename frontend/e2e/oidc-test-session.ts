import { createHmac } from 'node:crypto';

interface InitScriptTarget {
  addInitScript(script: (accessToken: string) => void, token: string): Promise<unknown>;
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function createOidcAppToken(userId: string, username: string): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret) {
    throw new Error('JWT_SECRET is required for browser E2E authentication.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: userId,
    username,
    isAppAdmin: false,
    type: 'oidc',
    authType: 'oidc',
    iat: now,
    exp: now + 60 * 60,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsignedToken).digest('base64url');
  return `${unsignedToken}.${signature}`;
}

export async function installOidcSession(
  target: InitScriptTarget,
  userId: string,
  username: string,
): Promise<void> {
  const token = createOidcAppToken(userId, username);
  await target.addInitScript((accessToken) => {
    localStorage.setItem('cp_token', accessToken);
    localStorage.setItem('cp_auth_type', 'oidc');
  }, token);
}
