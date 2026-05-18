import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
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
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
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
export class Shell implements OnInit, OnDestroy {
  readonly #queue = inject(QueueService);
  readonly #layout = inject(LayoutService);
  readonly #snackBar = inject(MatSnackBar);
  readonly #auth = inject(AuthService);
  readonly #swUpdate = inject(SwUpdate, { optional: true });

  readonly collapsed = signal(false);
  readonly pendingCount = this.#queue.pendingCount;
  readonly errorCount = this.#queue.errorCount;
  readonly userEmail = computed(() => this.#auth.user()?.email ?? '');
  readonly isMobile = this.#layout.isMobile;

  readonly headerTemplate = this.#layout.headerTemplate;
  readonly hasPending = computed(() => this.pendingCount() > 0);
  readonly hasErrors = computed(() => this.errorCount() > 0);

  readonly navItems: NavItem[] = [
    // Operações
    { label: 'Dashboard',     icon: 'dashboard',        route: '/' },
    { label: 'Revisão',       icon: 'rate_review',      route: '/review' },
    { label: 'Tratados',      icon: 'task_alt',         route: '/done' },
    { label: 'Arquivo',       icon: 'inventory_2',      route: '/archive' },
    // Financeiro
    { label: 'Reconciliação', icon: 'account_balance',  route: '/reconciliation' },
    { label: 'Previsão',      icon: 'trending_up',      route: '/budget' },
    { label: 'Insights',      icon: 'psychology',       route: '/insights' },
    // Configuração
    { label: 'Fornecedores',  icon: 'store',            route: '/suppliers' },
    { label: 'Treino',        icon: 'model_training',   route: '/training' },
    { label: 'Definições',    icon: 'settings',         route: '/settings' },
  ];

  readonly #titleEffect = effect(() => {
    const count = this.pendingCount();
    document.title = count > 0 ? `(${count}) Staxio` : 'Staxio';
  });

  readonly #visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      this.#queue.subscribeRealtime();
    }
  };

  async ngOnInit(): Promise<void> {
    await this.#queue.loadAll();
    this.#queue.subscribeRealtime();
    document.addEventListener('visibilitychange', this.#visibilityHandler);
    this.#setupSwUpdate();
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.#visibilityHandler);
  }

  #setupSwUpdate(): void {
    if (!this.#swUpdate?.isEnabled) return;

    this.#swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => {
        const ref = this.#snackBar.open('Nova versão disponível', 'Atualizar', {
          duration: 0,
          panelClass: ['toast--info'],
          horizontalPosition: 'end',
          verticalPosition: 'bottom',
        });
        ref.onAction().subscribe(() => document.location.reload());
      });

    setInterval(() => void this.#swUpdate!.checkForUpdate(), 6 * 60 * 60 * 1000);
  }

  toggleSidebar(): void {
    this.collapsed.update(v => !v);
  }

  signOut(): void {
    void this.#auth.signOut();
  }
}
