import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SUPABASE_CLIENT } from '../core/supabase.client';
import type { Session, User } from '@supabase/supabase-js';

function makeSession(email = 'test@staxio.io'): Session {
  return {
    access_token: 'token-abc',
    refresh_token: 'refresh-abc',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', email, aud: 'authenticated' } as User,
  } as Session;
}

const subscriptionStub = { data: { subscription: { unsubscribe: vi.fn() } } };

function buildMockSupabase(sessionOverride: Session | null = null) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: sessionOverride } }),
      onAuthStateChange: vi.fn().mockReturnValue(subscriptionStub),
      signInWithPassword: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };
}

describe('AuthService', () => {
  const navigateSpy = vi.fn().mockResolvedValue(true);

  function createService(mockSupabase: ReturnType<typeof buildMockSupabase>) {
    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
        { provide: Router, useValue: { navigate: navigateSpy, createUrlTree: vi.fn() } },
      ],
    });
    return TestBed.inject(AuthService);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('should be created', () => {
    const service = createService(buildMockSupabase());
    expect(service).toBeTruthy();
  });

  it('loading becomes false after getSession resolves', async () => {
    const service = createService(buildMockSupabase());
    await Promise.resolve(); // flush microtask
    expect(service.loading()).toBe(false);
  });

  it('isAuthenticated() is false when no session', async () => {
    const service = createService(buildMockSupabase(null));
    await Promise.resolve();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated() is true when session is present at init', async () => {
    const service = createService(buildMockSupabase(makeSession()));
    await Promise.resolve();
    expect(service.isAuthenticated()).toBe(true);
  });

  it('getAccessToken returns token when session exists', async () => {
    const service = createService(buildMockSupabase(makeSession()));
    await Promise.resolve();
    expect(service.getAccessToken()).toBe('token-abc');
  });

  it('getAccessToken returns null when no session', async () => {
    const service = createService(buildMockSupabase(null));
    await Promise.resolve();
    expect(service.getAccessToken()).toBeNull();
  });

  it('user() returns null when no session', async () => {
    const service = createService(buildMockSupabase(null));
    await Promise.resolve();
    expect(service.user()).toBeNull();
  });

  it('user() returns user when session exists', async () => {
    const session = makeSession('user@staxio.io');
    const service = createService(buildMockSupabase(session));
    await Promise.resolve();
    expect(service.user()?.email).toBe('user@staxio.io');
  });

  it('signIn calls supabase with credentials and navigates to / on success', async () => {
    const mock = buildMockSupabase();
    mock.auth.signInWithPassword.mockResolvedValue({ data: { session: makeSession() }, error: null });
    const service = createService(mock);

    const err = await service.signIn('test@staxio.io', 'password123');
    expect(err).toBeNull();
    expect(navigateSpy).toHaveBeenCalledWith(['/']);
  });

  it('signIn returns error message on failure', async () => {
    const mock = buildMockSupabase();
    mock.auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });
    const service = createService(mock);

    const err = await service.signIn('bad@email.com', 'wrongpass');
    expect(err).not.toBeNull();
    expect(err!.message).toBe('Invalid login credentials');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('signOut calls supabase signOut and navigates to /login', async () => {
    const mock = buildMockSupabase();
    const service = createService(mock);

    await service.signOut();
    expect(mock.auth.signOut).toHaveBeenCalledOnce();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });
});
