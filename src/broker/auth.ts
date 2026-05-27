export interface Authenticator {
  /** Returns true if the request is authorized. */
  check(authorizationHeader: string | undefined): boolean;
}

export class StaticBearerAuthenticator implements Authenticator {
  private readonly expected: string;

  constructor(token: string) {
    if (!token) throw new Error('auth token must be non-empty');
    this.expected = token;
  }

  check(header: string | undefined): boolean {
    if (!header) return false;
    if (!header.startsWith('Bearer ')) return false;
    const token = header.slice('Bearer '.length).trim();
    return token === this.expected;
  }
}
