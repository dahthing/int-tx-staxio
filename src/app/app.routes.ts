import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login').then(m => m.Login),
  },
  {
    path: '',
    loadComponent: () => import('./components/shell/shell').then(m => m.Shell),
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./components/dashboard/dashboard').then(m => m.Dashboard),
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./components/manual-review/manual-review').then(m => m.ManualReview),
      },
      {
        path: 'done',
        loadComponent: () =>
          import('./components/done-list/done-list').then(m => m.DoneList),
      },
      {
        path: 'training',
        loadComponent: () =>
          import('./components/training/training').then(m => m.Training),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./components/settings/settings').then(m => m.Settings),
      },
      {
        path: 'budget',
        loadComponent: () =>
          import('./components/budget/budget').then(m => m.Budget),
      },
      {
        path: 'insights',
        loadComponent: () =>
          import('./components/insights/insights').then(m => m.Insights),
      },
    ],
  },
];
