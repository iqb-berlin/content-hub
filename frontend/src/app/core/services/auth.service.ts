import { Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom, map, switchMap, tap, throwError } from 'rxjs';
import {
  LoginResponse,
  CredentialLoginResponse,
  UserProfile,
  OidcConfig,
} from '../models/api.models';
import { BYPASS_APP_AUTH } from '../interceptors/auth-context.tokens';
import { PendingPersonalSessionStorageService } from './pending-personal-session-storage.service';

// A callback opened in another tab cannot use the original tab's PKCE transaction.
export class OidcLoginStateError extends Error {}

interface OidcTokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
}

type AuthChannelMessage =
  | { type: 'logout' }
  | { type: 'oidc_session_updated' }
  | { type: 'app_session_updated' };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = '/api/auth';
  private readonly tokenKey = 'cp_token';
  private readonly OIDC_REDIRECT_KEY = 'oidc_redirect_url';
  private readonly OIDC_STATE_KEY = 'oidc_state';
  private readonly OIDC_CODE_VERIFIER_KEY = 'oidc_code_verifier';
  private readonly ID_TOKEN_KEY = 'cp_oidc_id_token';
  private readonly ACCESS_TOKEN_KEY = 'cp_oidc_access_token';
  private readonly REFRESH_TOKEN_KEY = 'cp_oidc_refresh_token';
  private readonly AUTH_TYPE_KEY = 'cp_auth_type';
  private readonly OIDC_REFRESH_LEEWAY_MS = 60_000;
  private readonly OIDC_REFRESH_FALLBACK_MS = 5 * 60 * 1000;
  private authChannel: BroadcastChannel | null = null;
  private oidcRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private oidcRefreshPromise: Promise<void> | null = null;
  private currentUserSubject = new BehaviorSubject<UserProfile | null>(null);
  private readonly tokenStorageListener = (event: StorageEvent) => {
    if (event.key === this.tokenKey && event.newValue) {
      this.pendingPersonalSessionStorage.activateIdentityFromToken(event.newValue);
    }
  };

  currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private pendingPersonalSessionStorage: PendingPersonalSessionStorageService,
  ) {
    this.initBroadcastChannel();
    window.addEventListener('storage', this.tokenStorageListener);
  }

  initFromStorage(): void {
    const token = this.getToken();
    this.pendingPersonalSessionStorage.activateIdentityFromToken(token);

    if (localStorage.getItem(this.AUTH_TYPE_KEY) === 'local') {
      this.performLogout();
      return;
    }

    if (this.isCredentialToken(token)) {
      this.switchToCredentialSession();
      return;
    }

    if (this.isOidcUser && this.hasStoredOidcSession()) {
      void this.restoreOidcSession();
      return;
    }

    if (token) {
      this.loadProfile();
    }
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel !== 'undefined') {
      this.authChannel = new BroadcastChannel('cp_auth');
      this.authChannel.onmessage = (event: MessageEvent<AuthChannelMessage | 'logout'>) => {
        if (event.data === 'logout' || event.data?.type === 'logout') {
          this.performLogout(false);
          return;
        }

        if (event.data?.type === 'oidc_session_updated') {
          this.scheduleOidcTokenRefresh();
          return;
        }

        if (event.data?.type === 'app_session_updated') {
          this.pendingPersonalSessionStorage.activateIdentityFromToken(this.getToken());
        }
      };
    }
  }

  get isLoggedIn(): boolean {
    return !!this.getToken();
  }

  get isAdmin(): boolean {
    return this.currentUserSubject.value?.isAppAdmin ?? false;
  }

  get hasManagedAcps(): boolean {
    const user = this.currentUserSubject.value;
    if (!user) return false;
    if (user.isAppAdmin) return true;
    return (user.acpRoles || []).some((role) => role.role === 'ACP_MANAGER');
  }

  get isOidcUser(): boolean {
    return localStorage.getItem(this.AUTH_TYPE_KEY) === 'oidc';
  }

  get currentUser(): UserProfile | null {
    return this.currentUserSubject.value;
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  async refreshOidcSession(): Promise<boolean> {
    try {
      return await this.refreshOidcTokensIfNeeded(true);
    } catch {
      return false;
    }
  }

  async restoreOidcSessionOnResume(): Promise<boolean> {
    if (!this.isOidcUser || !this.hasStoredOidcSession()) {
      return false;
    }

    try {
      return await this.refreshOidcTokensIfNeeded(!this.getToken());
    } catch {
      return false;
    }
  }

  getOidcConfig(): Observable<OidcConfig> {
    return this.http.get<OidcConfig>(`${this.API}/oidc-config`);
  }

  async initiateOidcLogin(redirectUrl?: string): Promise<void> {
    if (redirectUrl) {
      sessionStorage.setItem(this.OIDC_REDIRECT_KEY, redirectUrl);
    } else {
      sessionStorage.removeItem(this.OIDC_REDIRECT_KEY);
    }

    let config: OidcConfig;
    try {
      config = await firstValueFrom(this.getOidcConfig());
    } catch {
      throw new Error('Die Keycloak-Konfiguration konnte nicht geladen werden.');
    }
    if (!config.enabled || !config.issuerUrl || !config.clientId) {
      throw new Error('Die Keycloak-Anmeldung ist nicht konfiguriert.');
    }

    await this.redirectToOidcAuthorization(config);
  }

  handleOidcAuthorizationCode(code: string, state: string | null): Observable<LoginResponse> {
    const expectedState = sessionStorage.getItem(this.OIDC_STATE_KEY);
    const codeVerifier = sessionStorage.getItem(this.OIDC_CODE_VERIFIER_KEY);

    if (!state || !expectedState || state !== expectedState) {
      return throwError(() => new OidcLoginStateError('Ungültiger OIDC-State'));
    }

    if (!codeVerifier) {
      return throwError(() => new OidcLoginStateError('PKCE-Verifier fehlt'));
    }

    sessionStorage.removeItem(this.OIDC_STATE_KEY);
    sessionStorage.removeItem(this.OIDC_CODE_VERIFIER_KEY);

    return this.getOidcConfig().pipe(
      switchMap((config) => {
        if (!config.enabled || !config.issuerUrl || !config.clientId) {
          return throwError(() => new Error('OIDC ist nicht konfiguriert'));
        }

        const tokenUrl = `${config.issuerUrl}/protocol/openid-connect/token`;
        const body = new URLSearchParams();
        body.set('grant_type', 'authorization_code');
        body.set('code', code);
        body.set('redirect_uri', config.redirectUri);
        body.set('client_id', config.clientId);
        body.set('code_verifier', codeVerifier);

        const headers = new HttpHeaders({
          'Content-Type': 'application/x-www-form-urlencoded',
        });
        const context = new HttpContext().set(BYPASS_APP_AUTH, true);

        return this.http.post<OidcTokenResponse>(tokenUrl, body.toString(), { headers, context });
      }),
      switchMap((tokenResponse) => {
        const idToken = tokenResponse.id_token;
        const accessToken = tokenResponse.access_token;
        const tokenForBackend = idToken || accessToken;

        if (!tokenForBackend) {
          return throwError(() => new Error('Kein Token aus OIDC-Antwort erhalten'));
        }

        return this.handleOidcCallback(
          tokenForBackend,
          accessToken,
          idToken,
          tokenResponse.refresh_token,
        );
      }),
    );
  }

  handleOidcCallback(
    tokenForBackend: string,
    accessToken?: string,
    idToken?: string,
    refreshToken?: string,
  ): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.API}/oidc-callback`, { idToken: tokenForBackend })
      .pipe(
        tap((res) => {
          this.storeApplicationToken(res.accessToken);
          if (accessToken) {
            localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
          } else {
            localStorage.removeItem(this.ACCESS_TOKEN_KEY);
          }
          const resolvedIdToken = idToken || (!accessToken ? tokenForBackend : undefined);
          if (resolvedIdToken) {
            localStorage.setItem(this.ID_TOKEN_KEY, resolvedIdToken);
          } else {
            localStorage.removeItem(this.ID_TOKEN_KEY);
          }
          if (refreshToken) {
            localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
          }
          localStorage.setItem(this.AUTH_TYPE_KEY, 'oidc');
          this.currentUserSubject.next(this.normalizeUserProfile(res.user));
          this.scheduleOidcTokenRefresh();
          this.broadcastAuthEvent({ type: 'oidc_session_updated' });
        }),
      );
  }

  changePassword(): void {
    const authType = localStorage.getItem(this.AUTH_TYPE_KEY);
    if (authType !== 'oidc') {
      return;
    }

    this.getOidcConfig().subscribe({
      next: async (config) => {
        if (!config.enabled || !config.issuerUrl || !config.clientId) {
          return;
        }

        sessionStorage.setItem(
          this.OIDC_REDIRECT_KEY,
          window.location.pathname + window.location.search,
        );

        try {
          await this.redirectToOidcAuthorization(config, {
            kc_action: 'UPDATE_PASSWORD',
          });
        } catch {
          // noop
        }
      },
      error: () => {},
    });
  }

  credentialLogin(
    acpId: string,
    username: string,
    password: string,
  ): Observable<CredentialLoginResponse> {
    return this.http
      .post<CredentialLoginResponse>(`${this.API}/credential-login`, { acpId, username, password })
      .pipe(
        tap((res) => {
          this.switchToCredentialSession();
          this.storeApplicationToken(res.accessToken);
        }),
      );
  }

  logout(broadcast = true): void {
    const idToken = localStorage.getItem(this.ID_TOKEN_KEY);
    const authType = localStorage.getItem(this.AUTH_TYPE_KEY);
    const wasOidc = authType === 'oidc';

    this.http.post(`${this.API}/logout`, {}).subscribe({
      error: () => {},
    });

    if (wasOidc) {
      this.redirectToKeycloakLogout(idToken);
    }

    this.performLogout(broadcast);
  }

  clearSession(broadcast = true): void {
    this.performLogout(broadcast);
  }

  private redirectToKeycloakLogout(idToken: string | null): void {
    this.getOidcConfig().subscribe({
      next: (config) => {
        if (!config.enabled || !config.issuerUrl || !config.clientId) {
          this.redirectToPublicStart();
          return;
        }

        try {
          const logoutUrl = new URL(`${config.issuerUrl}/protocol/openid-connect/logout`);
          logoutUrl.searchParams.set('post_logout_redirect_uri', `${window.location.origin}/login`);
          logoutUrl.searchParams.set('client_id', config.clientId);
          if (idToken) {
            logoutUrl.searchParams.set('id_token_hint', idToken);
          }

          this.navigateBrowserTo(logoutUrl.toString());
        } catch {
          this.redirectToPublicStart();
        }
      },
      error: () => this.redirectToPublicStart(),
    });
  }

  private redirectToPublicStart(): void {
    this.navigateBrowserTo(`${window.location.origin}/`);
  }

  private navigateBrowserTo(url: string): void {
    window.location.href = url;
  }

  private performLogout(broadcast = true): void {
    this.clearOidcRefreshTimer();
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.ID_TOKEN_KEY);
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.AUTH_TYPE_KEY);
    sessionStorage.removeItem(this.OIDC_REDIRECT_KEY);
    sessionStorage.removeItem(this.OIDC_STATE_KEY);
    sessionStorage.removeItem(this.OIDC_CODE_VERIFIER_KEY);
    this.currentUserSubject.next(null);

    if (broadcast) {
      this.broadcastAuthEvent({ type: 'logout' });
    }
  }

  loadProfile(): void {
    const authType = localStorage.getItem(this.AUTH_TYPE_KEY);
    const idToken = localStorage.getItem(this.ID_TOKEN_KEY);

    if (authType === 'oidc' && idToken) {
      this.syncOidcRoles(idToken).subscribe({
        next: (profile) => this.currentUserSubject.next(profile),
        error: () => this.logout(),
      });
    } else {
      this.http.get<UserProfile>(`${this.API}/profile`).subscribe({
        next: (profile) => this.currentUserSubject.next(profile),
        error: () => this.logout(),
      });
    }
  }

  syncOidcRoles(idToken: string): Observable<UserProfile> {
    return this.http.post<LoginResponse>(`${this.API}/sync-oidc-roles`, { idToken }).pipe(
      tap((res) => {
        this.storeApplicationToken(res.accessToken);
      }),
      map((res) => this.normalizeUserProfile(res.user)),
    );
  }

  hasAcpRole(acpId: string, role: string): boolean {
    const user = this.currentUserSubject.value;
    if (!user) return false;
    if (user.isAppAdmin) return true;
    return (user.acpRoles || []).some((r) => r.acpId === acpId && r.role === role);
  }

  private async redirectToOidcAuthorization(
    config: OidcConfig,
    extraParams: Record<string, string> = {},
  ): Promise<void> {
    const state = this.generateRandomValue(32);
    const nonce = this.generateRandomValue(32);
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    sessionStorage.setItem(this.OIDC_STATE_KEY, state);
    sessionStorage.setItem(this.OIDC_CODE_VERIFIER_KEY, codeVerifier);

    const authUrl = new URL(`${config.issuerUrl}/protocol/openid-connect/auth`);
    authUrl.searchParams.set('client_id', config.clientId || '');
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', config.scope);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('nonce', nonce);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    Object.entries(extraParams).forEach(([key, value]) => {
      authUrl.searchParams.set(key, value);
    });

    this.navigateBrowserTo(authUrl.toString());
  }

  private generateCodeVerifier(): string {
    return this.generateRandomValue(48);
  }

  private hasStoredOidcSession(): boolean {
    return !!(
      localStorage.getItem(this.REFRESH_TOKEN_KEY) ||
      localStorage.getItem(this.ACCESS_TOKEN_KEY) ||
      localStorage.getItem(this.ID_TOKEN_KEY)
    );
  }

  private async restoreOidcSession(): Promise<void> {
    try {
      const didRefresh = await this.refreshOidcTokensIfNeeded(!this.getToken());
      if (!didRefresh && this.getToken()) {
        this.scheduleOidcTokenRefresh();
        this.loadProfile();
        return;
      }

      if (!this.getToken()) {
        this.clearSession();
      }
    } catch {
      this.clearSession();
    }
  }

  private async refreshOidcTokensIfNeeded(force = false): Promise<boolean> {
    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
    if (!this.isOidcUser || !refreshToken) {
      this.scheduleOidcTokenRefresh();
      return false;
    }

    if (
      !force &&
      !this.isTokenExpiringSoon(this.getToken()) &&
      !this.isTokenExpiringSoon(this.getPrimaryOidcToken())
    ) {
      this.scheduleOidcTokenRefresh();
      return false;
    }

    await this.refreshOidcTokens();
    return true;
  }

  private async refreshOidcTokens(): Promise<void> {
    if (this.oidcRefreshPromise) {
      return this.oidcRefreshPromise;
    }

    this.oidcRefreshPromise = this.performOidcRefresh().finally(() => {
      this.oidcRefreshPromise = null;
    });

    return this.oidcRefreshPromise;
  }

  private async performOidcRefresh(): Promise<void> {
    const initialRefreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
    if (!initialRefreshToken) {
      throw new Error('OIDC-Refresh-Token fehlt');
    }

    let tokenResponse: OidcTokenResponse;

    try {
      tokenResponse = await this.requestOidcTokenRefresh(initialRefreshToken);
    } catch (error) {
      const latestRefreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
      if (!latestRefreshToken || latestRefreshToken === initialRefreshToken) {
        throw error;
      }

      tokenResponse = await this.requestOidcTokenRefresh(latestRefreshToken);
    }

    const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY) || initialRefreshToken;
    const accessToken = tokenResponse.access_token;
    const idToken = tokenResponse.id_token;
    const tokenForBackend = idToken || accessToken;

    if (!tokenForBackend) {
      throw new Error('Kein Token aus OIDC-Refresh erhalten');
    }

    await firstValueFrom(
      this.handleOidcCallback(
        tokenForBackend,
        accessToken,
        idToken,
        tokenResponse.refresh_token || refreshToken,
      ),
    );
  }

  private async requestOidcTokenRefresh(refreshToken: string): Promise<OidcTokenResponse> {
    const config = await firstValueFrom(this.getOidcConfig());
    if (!config.enabled || !config.issuerUrl || !config.clientId) {
      throw new Error('OIDC ist nicht konfiguriert');
    }

    const tokenUrl = `${config.issuerUrl}/protocol/openid-connect/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    body.set('client_id', config.clientId);

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const context = new HttpContext().set(BYPASS_APP_AUTH, true);

    return firstValueFrom(
      this.http.post<OidcTokenResponse>(tokenUrl, body.toString(), { headers, context }),
    );
  }

  private scheduleOidcTokenRefresh(): void {
    this.clearOidcRefreshTimer();

    if (!this.isOidcUser || !localStorage.getItem(this.REFRESH_TOKEN_KEY)) {
      return;
    }

    const token = this.getPrimaryOidcToken() || this.getToken();
    const expiresAt = this.getTokenExpiry(token);
    const delay = expiresAt
      ? Math.max(expiresAt - Date.now() - this.OIDC_REFRESH_LEEWAY_MS, 0)
      : this.OIDC_REFRESH_FALLBACK_MS;

    this.oidcRefreshTimeout = setTimeout(() => {
      void this.refreshOidcTokens().catch(() => this.clearSession());
    }, delay);
  }

  private clearOidcRefreshTimer(): void {
    if (this.oidcRefreshTimeout) {
      clearTimeout(this.oidcRefreshTimeout);
      this.oidcRefreshTimeout = null;
    }
  }

  private storeApplicationToken(token: string): void {
    localStorage.setItem(this.tokenKey, token);
    this.pendingPersonalSessionStorage.activateIdentityFromToken(token);
    this.broadcastAuthEvent({ type: 'app_session_updated' });
  }

  private switchToCredentialSession(): void {
    this.clearOidcRefreshTimer();
    this.clearStoredOidcSession();
    localStorage.setItem(this.AUTH_TYPE_KEY, 'credential');
    this.currentUserSubject.next(null);
  }

  private clearStoredOidcSession(): void {
    localStorage.removeItem(this.ID_TOKEN_KEY);
    localStorage.removeItem(this.ACCESS_TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(this.OIDC_REDIRECT_KEY);
    sessionStorage.removeItem(this.OIDC_STATE_KEY);
    sessionStorage.removeItem(this.OIDC_CODE_VERIFIER_KEY);
  }

  private isCredentialToken(token: string | null): boolean {
    return this.getTokenPayload(token)?.['type'] === 'credential';
  }

  private getPrimaryOidcToken(): string | null {
    return localStorage.getItem(this.ACCESS_TOKEN_KEY) || localStorage.getItem(this.ID_TOKEN_KEY);
  }

  private broadcastAuthEvent(message: AuthChannelMessage): void {
    this.authChannel?.postMessage(message);
  }

  private isTokenExpiringSoon(token: string | null): boolean {
    if (!token) {
      return true;
    }

    const expiresAt = this.getTokenExpiry(token);
    if (!expiresAt) {
      return false;
    }

    return expiresAt - Date.now() <= this.OIDC_REFRESH_LEEWAY_MS;
  }

  private getTokenExpiry(token: string | null): number | null {
    const payload = this.getTokenPayload(token);
    if (typeof payload?.['exp'] !== 'number') {
      return null;
    }

    return payload['exp'] * 1000;
  }

  private getTokenPayload(token: string | null): Record<string, unknown> | null {
    if (!token) {
      return null;
    }

    const parts = token.split('.');
    if (parts.length < 2) {
      return null;
    }

    try {
      return JSON.parse(this.base64UrlDecode(parts[1])) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private base64UrlDecode(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return atob(padded);
  }

  private normalizeUserProfile(user: LoginResponse['user']): UserProfile {
    return {
      ...(user as UserProfile),
      acpRoles: (user as UserProfile).acpRoles || [],
    };
  }

  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const data = new TextEncoder().encode(codeVerifier);
    if (crypto?.subtle?.digest) {
      const digest = await crypto.subtle.digest('SHA-256', data);
      return this.base64UrlEncode(new Uint8Array(digest));
    }

    // Fallback for non-secure contexts (e.g. plain HTTP on IP-based VPS setups)
    // where `crypto.subtle` may be unavailable.
    return this.base64UrlEncode(this.sha256(data));
  }

  private generateRandomValue(size: number): string {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return this.base64UrlEncode(bytes);
  }

  private base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  private sha256(input: Uint8Array): Uint8Array {
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
      0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
      0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
      0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
      0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
      0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
      0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
      0xc67178f2,
    ];

    const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
    const ch = (x: number, y: number, z: number) => (x & y) ^ (~x & z);
    const maj = (x: number, y: number, z: number) => (x & y) ^ (x & z) ^ (y & z);
    const bsig0 = (x: number) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
    const bsig1 = (x: number) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
    const ssig0 = (x: number) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
    const ssig1 = (x: number) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);

    const bitLen = input.length * 8;
    const withOne = input.length + 1;
    const mod64 = withOne % 64;
    const padLen = mod64 <= 56 ? 56 - mod64 : 56 + (64 - mod64);
    const totalLen = withOne + padLen + 8;

    const msg = new Uint8Array(totalLen);
    msg.set(input, 0);
    msg[input.length] = 0x80;

    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    msg[totalLen - 8] = (hi >>> 24) & 0xff;
    msg[totalLen - 7] = (hi >>> 16) & 0xff;
    msg[totalLen - 6] = (hi >>> 8) & 0xff;
    msg[totalLen - 5] = hi & 0xff;
    msg[totalLen - 4] = (lo >>> 24) & 0xff;
    msg[totalLen - 3] = (lo >>> 16) & 0xff;
    msg[totalLen - 2] = (lo >>> 8) & 0xff;
    msg[totalLen - 1] = lo & 0xff;

    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;

    const w = new Uint32Array(64);

    for (let offset = 0; offset < msg.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const j = offset + i * 4;
        w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
      }

      for (let i = 16; i < 64; i++) {
        w[i] = (ssig1(w[i - 2]) + w[i - 7] + ssig0(w[i - 15]) + w[i - 16]) >>> 0;
      }

      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;

      for (let i = 0; i < 64; i++) {
        const t1 = (h + bsig1(e) + ch(e, f, g) + K[i] + w[i]) >>> 0;
        const t2 = (bsig0(a) + maj(a, b, c)) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + t1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const out = new Uint8Array(32);
    const hs = [h0, h1, h2, h3, h4, h5, h6, h7];

    for (let i = 0; i < hs.length; i++) {
      const v = hs[i];
      const o = i * 4;
      out[o] = (v >>> 24) & 0xff;
      out[o + 1] = (v >>> 16) & 0xff;
      out[o + 2] = (v >>> 8) & 0xff;
      out[o + 3] = v & 0xff;
    }

    return out;
  }
}
