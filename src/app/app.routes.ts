import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'review',
    loadComponent: () => import('./features/review/review.page').then((module) => module.ReviewPage),
  },
  {
    path: 'deletions',
    loadComponent: () => import('./features/deletions/deletions.page').then((module) => module.DeletionsPage),
  },
  {
    path: 'deletions/:id',
    loadComponent: () =>
      import('./features/deletions/deletion-detail.page').then((module) => module.DeletionDetailPage),
  },
  {
    path: 'queue',
    redirectTo: 'uploads',
    pathMatch: 'full',
  },
  {
    path: '',
    loadComponent: () => import('./features/tabs/tabs.page').then((module) => module.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () => import('./features/home/home.page').then((module) => module.HomePage),
      },
      {
        path: 'gallery',
        loadComponent: () => import('./features/gallery/gallery.page').then((module) => module.GalleryPage),
      },
      {
        path: 'uploads',
        loadComponent: () => import('./features/uploads/uploads.page').then((module) => module.UploadsPage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.page').then((module) => module.SettingsPage),
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
    ],
  },
];
