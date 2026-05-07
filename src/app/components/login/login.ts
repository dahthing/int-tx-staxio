import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-page" role="main">
      <div class="login-card">
        <div class="login-card__brand" aria-hidden="true">
          <span class="login-card__logo">staxio</span>
        </div>

        <h1 class="login-card__title">Entrar</h1>

        @if (errorMsg()) {
          <div class="login-card__error" role="alert" aria-live="assertive">
            {{ errorMsg() }}
          </div>
        }

        <form
          class="login-card__form"
          [formGroup]="form"
          (ngSubmit)="onSubmit()"
          novalidate
          aria-label="Formulário de autenticação"
        >
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input
              matInput
              type="email"
              formControlName="email"
              autocomplete="email"
              aria-required="true"
            />
            @if (form.controls.email.invalid && form.controls.email.touched) {
              <mat-error>Email inválido</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input
              matInput
              [type]="showPassword() ? 'text' : 'password'"
              formControlName="password"
              autocomplete="current-password"
              aria-required="true"
            />
            <button
              mat-icon-button
              matSuffix
              type="button"
              (click)="showPassword.set(!showPassword())"
              [attr.aria-label]="showPassword() ? 'Esconder password' : 'Mostrar password'"
            >
              <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            @if (form.controls.password.invalid && form.controls.password.touched) {
              <mat-error>Password obrigatória</mat-error>
            }
          </mat-form-field>

          <button
            mat-flat-button
            color="primary"
            type="submit"
            class="login-card__submit"
            [disabled]="loading() || form.invalid"
            aria-label="Entrar na aplicação"
          >
            @if (loading()) {
              <mat-spinner diameter="20" aria-label="A autenticar…" />
            } @else {
              Entrar
            }
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--stx-background);
      padding: 1rem;
    }

    .login-card {
      background: var(--stx-surface);
      border: 1px solid var(--stx-border);
      border-radius: var(--stx-radius);
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 400px;

      &__brand {
        text-align: center;
        margin-bottom: 1.5rem;
      }

      &__logo {
        font-size: 1.75rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: var(--stx-primary);
      }

      &__title {
        font-size: 1.25rem;
        font-weight: 600;
        margin: 0 0 1.5rem;
        text-align: center;
        color: var(--stx-text);
      }

      &__error {
        background: color-mix(in srgb, var(--stx-error) 15%, transparent);
        border: 1px solid var(--stx-error);
        border-radius: 6px;
        color: var(--stx-error);
        font-size: 0.875rem;
        padding: 0.625rem 0.875rem;
        margin-bottom: 1rem;
      }

      &__form {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;

        mat-form-field { width: 100%; }
      }

      &__submit {
        margin-top: 0.75rem;
        height: 44px;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }
    }
  `],
})
export class Login {
  readonly #auth = inject(AuthService);
  readonly #fb = inject(FormBuilder);

  readonly form = this.#fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly showPassword = signal(false);

  async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMsg.set(null);

    const { email, password } = this.form.getRawValue();
    const error = await this.#auth.signIn(email, password);

    this.loading.set(false);

    if (error) {
      this.errorMsg.set(error.message);
    }
  }
}
