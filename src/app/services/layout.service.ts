import { Injectable, TemplateRef, inject, signal } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly #bp = inject(BreakpointObserver);

  readonly headerTemplate = signal<TemplateRef<unknown> | null>(null);

  readonly isMobile = toSignal(
    this.#bp.observe('(max-width: 768px)').pipe(map(r => r.matches)),
    { initialValue: false },
  );
}
