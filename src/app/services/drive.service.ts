import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface DriveFolder {
  id: string;
  name: string;
  hasChildren: boolean;
}

@Injectable({ providedIn: 'root' })
export class DriveService {
  readonly #http = inject(HttpClient);

  listFolders(parentId: string): Observable<DriveFolder[]> {
    const url = `${environment.edgeFunctionsUrl}/list-folders?parent_id=${encodeURIComponent(parentId)}`;
    return this.#http.get<{ folders: DriveFolder[] }>(url).pipe(map(r => r.folders));
  }
}
