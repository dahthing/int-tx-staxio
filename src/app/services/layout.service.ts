import { Injectable, signal, TemplateRef } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly headerTemplate = signal<TemplateRef<unknown> | null>(null);
}
