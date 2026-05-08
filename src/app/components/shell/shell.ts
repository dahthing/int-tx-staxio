import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
  computed,
  effect,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LayoutService } from '../../services/layout.service';
import { QueueService } from '../../services/queue.service';
import { AuthService } from '../../services/auth.service';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgTemplateOutlet,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-collapsed]': 'collapsed()' },
})
export class Shell implements OnInit {
  readonly #queue = inject(QueueService);
  readonly #layout = inject(LayoutService);
  readonly #snackBar = inject(MatSnackBar);
  readonly #auth = inject(AuthService);

  readonly collapsed = signal(false);
  readonly pendingCount = this.#queue.pendingCount;
  readonly errorCount = this.#queue.errorCount;
  readonly userEmail = computed(() => this.#auth.user()?.email ?? '');

  readonly headerTemplate = this.#layout.headerTemplate;
  readonly hasPending = computed(() => this.pendingCount() > 0);
  readonly hasErrors = computed(() => this.errorCount() > 0);

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'dashboard',      route: '/' },
    { label: 'Revisão',   icon: 'rate_review',    route: '/review' },
    { label: 'Tratados',  icon: 'task_alt',       route: '/done' },
    { label: 'Treino',    icon: 'model_training', route: '/training' },
    { label: 'Definições',icon: 'settings',       route: '/settings' },
  ];

  // Actualiza o título do browser com badge de pendentes
  readonly #titleEffect = effect(() => {
    const count = this.pendingCount();
    document.title = count > 0 ? `(${count}) Staxio` : 'Staxio';
  });

  async ngOnInit(): Promise<void> {
    await this.#queue.loadAll();
    this.#queue.subscribeRealtime();
  }

  toggleSidebar(): void {
    this.collapsed.update(v => !v);
  }

  showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    this.#snackBar.open(message, '✕', {
      duration: 4000,
      panelClass: [`toast--${type}`],
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
    });
  }

  signOut(): void {
    void this.#auth.signOut();
  }
}
