import { inject, Injectable, signal, computed, effect } from '@angular/core';
import { Router } from '@angular/router';
import { SUPABASE_CLIENT } from '../core/supabase.client';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthError {
  message: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly #supabase = inject(SUPABASE_CLIENT);
  readonly #router = inject(Router);

  readonly #session = signal<Session | null>(null);
  readonly #loading = signal(true);

  readonly session = this.#session.asReadonly();
  readonly loading = this.#loading.asReadonly();
  readonly user = computed<User | null>(() => this.#session()?.user ?? null);
  readonly isAuthenticated = computed(() => this.#session() !== null);

  constructor() {
    // Carrega sessão existente ao arrancar
    void this.#supabase.auth.getSession().then(({ data }) => {
      this.#session.set(data.session);
      this.#loading.set(false);
    });

    // Subscreve a mudanças de sessão (login, logout, token refresh)
    this.#supabase.auth.onAuthStateChange((_event, session) => {
      this.#session.set(session);
    });
  }

  async signIn(email: string, password: string): Promise<AuthError | null> {
    const { error } = await this.#supabase.auth.signInWithPassword({ email, password });
    if (error) return { message: error.message };
    await this.#router.navigate(['/']);
    return null;
  }

  async signOut(): Promise<void> {
    await this.#supabase.auth.signOut();
    await this.#router.navigate(['/login']);
  }

  getAccessToken(): string | null {
    return this.#session()?.access_token ?? null;
  }
}
