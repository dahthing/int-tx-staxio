import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DriveFolder, DriveService } from '../../services/drive.service';

@Component({
  selector: 'app-drive-folder-picker',
  imports: [MatIconModule, MatButtonModule],
  templateUrl: './drive-folder-picker.html',
  styleUrl: './drive-folder-picker.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Escolher pasta do Drive',
  },
})
export class DriveFolderPicker implements OnInit {
  readonly rootFolderId = input.required<string>();

  readonly selected = output<{ id: string; path: string }>();
  readonly cancelled = output<void>();

  readonly #drive = inject(DriveService);

  readonly #stack = signal<Array<{ id: string; name: string }>>([]);
  readonly #children = signal<DriveFolder[]>([]);
  readonly #loading = signal(false);

  readonly stack = this.#stack.asReadonly();
  readonly children = this.#children.asReadonly();
  readonly loading = this.#loading.asReadonly();

  readonly currentId = computed(() => {
    const s = this.#stack();
    return s.length > 0 ? s[s.length - 1].id : this.rootFolderId();
  });

  readonly breadcrumbPath = computed(() =>
    this.#stack().map(s => s.name).join(' / ')
  );

  async ngOnInit(): Promise<void> {
    await this.#load(this.rootFolderId());
  }

  async navigateInto(folder: DriveFolder): Promise<void> {
    this.#stack.update(s => [...s, { id: folder.id, name: folder.name }]);
    await this.#load(folder.id);
  }

  async navigateTo(index: number): Promise<void> {
    this.#stack.update(s => s.slice(0, index + 1));
    const id = this.#stack()[index]?.id ?? this.rootFolderId();
    await this.#load(id);
  }

  async navigateToRoot(): Promise<void> {
    this.#stack.set([]);
    await this.#load(this.rootFolderId());
  }

  confirm(): void {
    const path = this.breadcrumbPath();
    this.selected.emit({ id: this.currentId(), path });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  async #load(folderId: string): Promise<void> {
    this.#loading.set(true);
    this.#drive.listFolders(folderId).subscribe({
      next: folders => {
        this.#children.set(folders);
        this.#loading.set(false);
      },
      error: () => {
        this.#children.set([]);
        this.#loading.set(false);
      },
    });
  }
}
