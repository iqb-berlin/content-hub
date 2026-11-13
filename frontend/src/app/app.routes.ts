import { explorerCapabilityGuard, reviewManageGuard } from './core/guards/capability.guard';
import { Routes } from '@angular/router';
import { authGuard, adminGuard, apManagerGuard } from './core/guards/auth.guard';
import { apViewGuard } from './core/guards/ap-view.guard';
import { itemExplorerPendingChangesGuard } from './core/guards/item-explorer-pending-changes.guard';

export const routes: Routes = [
  { path: 'acps', redirectTo: 'aps', pathMatch: 'full' },
  {
    path: 'public/task/:publicationId',
    loadComponent: () =>
      import('./views/public-task/public-task.component').then((m) => m.PublicTaskComponent),
  },
  {
    path: '',
    loadComponent: () =>
      import('./views/landing/landing.component').then((m) => m.LandingComponent),
  },
  {
    path: 'access',
    loadComponent: () => import('./auth/access.component').then((m) => m.AccessComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./auth/oidc-callback.component').then((m) => m.OidcCallbackComponent),
  },
  {
    path: 'credential-login/:apId',
    loadComponent: () =>
      import('./auth/credential-login.component').then((m) => m.CredentialLoginComponent),
  },
  {
    path: 'aps',
    canActivate: [authGuard],
    loadComponent: () => import('./admin/ap-list/ap-list.component').then((m) => m.ApListComponent),
  },

  // Admin routes
  {
    path: 'admin',
    canActivate: [adminGuard],
    children: [
      { path: 'acp', redirectTo: 'ap', pathMatch: 'full' },
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      {
        path: 'users',
        loadComponent: () => import('./admin/users/users.component').then((m) => m.UsersComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./admin/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'application-tokens',
        loadComponent: () =>
          import('./admin/application-tokens/application-tokens.component').then(
            (m) => m.ApplicationTokensComponent,
          ),
      },
      {
        path: 'ap',
        loadComponent: () =>
          import('./admin/ap-list/ap-list.component').then((m) => m.ApListComponent),
      },
    ],
  },

  // AP Manager routes
  {
    path: 'manage/:apId',
    canActivate: [apManagerGuard],
    children: [
      {
        path: 'publications',
        loadComponent: () =>
          import('./ap-manager/publications/publications.component').then(
            (m) => m.PublicationsComponent,
          ),
      },
      {
        path: '',
        loadComponent: () =>
          import('./ap-manager/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'files',
        loadComponent: () =>
          import('./ap-manager/files/files.component').then((m) => m.FilesComponent),
      },
      {
        path: 'snapshots',
        loadComponent: () =>
          import('./ap-manager/snapshots/snapshots.component').then((m) => m.SnapshotsComponent),
      },
      {
        path: 'access',
        loadComponent: () =>
          import('./ap-manager/access-config/access-config.component').then(
            (m) => m.AccessConfigComponent,
          ),
      },
      {
        path: 'application-tokens',
        loadComponent: () =>
          import('./ap-manager/application-tokens/application-tokens.component').then(
            (m) => m.ApApplicationTokensComponent,
          ),
      },
    ],
  },

  // Public view routes (protected by apViewGuard to handle access models)
  {
    path: 'view/:apId',
    canActivate: [apViewGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./views/ap-start/ap-start.component').then((m) => m.ApStartComponent),
      },
      {
        path: 'units',
        loadComponent: () =>
          import('./views/unit-view/unit-list.component').then((m) => m.UnitListComponent),
      },
      {
        path: 'unit/:unitId',
        loadComponent: () =>
          import('./views/unit-view/unit-view.component').then((m) => m.UnitViewComponent),
      },
      {
        path: 'sequence/:sequenceId',
        loadComponent: () =>
          import('./views/task-sequence/task-sequence.component').then(
            (m) => m.TaskSequenceComponent,
          ),
      },
      {
        path: 'review/manage',
        canActivate: [reviewManageGuard],
        loadComponent: () =>
          import('./views/review/review.component').then((m) => m.ReviewComponent),
      },
      {
        path: 'review',
        loadComponent: () =>
          import('./views/review/review-redirect.component').then((m) => m.ReviewRedirectComponent),
      },
      {
        path: 'item-explorer',
        canActivate: [explorerCapabilityGuard],
        canDeactivate: [itemExplorerPendingChangesGuard],
        loadComponent: () =>
          import('./views/item-explorer/item-explorer.component').then(
            (m) => m.ItemExplorerComponent,
          ),
      },
      {
        path: 'item/:itemId',
        canActivate: [explorerCapabilityGuard],
        loadComponent: () =>
          import('./views/item-view/item-view.component').then((m) => m.ItemViewComponent),
      },
      {
        path: 'index',
        loadComponent: () =>
          import('./views/ap-index-view/ap-index-view.component').then(
            (m) => m.ApIndexViewComponent,
          ),
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
