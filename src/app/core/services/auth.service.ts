import { HttpEvent, HttpHandlerFn, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject, Injectable, signal, computed } from '@angular/core';
import { Observable, from, switchMap } from 'rxjs';
import Keycloak from 'keycloak-js';

import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly keycloak = new Keycloak({
    url: environment.keycloak.url,
    realm: environment.keycloak.realm,
    clientId: environment.keycloak.clientId,
  });

  public readonly authenticated = signal(false);
  public readonly userName = signal('');
  public readonly roles = signal<readonly string[]>([]);
  public readonly canWrite = computed(() => this.roles().includes('admin'));
  public readonly accountUrl = signal<string | null>(null);

  public async init(): Promise<void> {
    const authenticated = await this.keycloak.init({
      onLoad: 'login-required',
      checkLoginIframe: false,
      pkceMethod: 'S256',
    });

    this.authenticated.set(authenticated);

    if (authenticated) {
      this.userName.set(this.keycloak.tokenParsed?.['preferred_username'] ?? '');
      this.roles.set(this.keycloak.tokenParsed?.['realm_access']?.['roles'] ?? []);

      try {
        this.accountUrl.set(
          this.keycloak.createAccountUrl({ redirectUri: window.location.origin }),
        );
      } catch {
        this.accountUrl.set(null);
      }
    }
  }

  public async getToken(): Promise<string> {
    await this.keycloak.updateToken(30);
    return this.keycloak.token ?? '';
  }

  public hasRole(role: string): boolean {
    return this.roles().includes(role);
  }

  public logout(): void {
    void this.keycloak.logout({ redirectUri: window.location.origin });
  }
}

export const authInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const auth = inject(AuthService);

  if (!req.url.includes('/api/')) {
    return next(req);
  }

  return from(auth.getToken()).pipe(
    switchMap((token) => {
      if (token) {
        const cloned = req.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
        return next(cloned);
      }
      return next(req);
    }),
  );
};
