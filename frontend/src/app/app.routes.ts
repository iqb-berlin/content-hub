import { explorerCapabilityGuard, reviewManageGuard } from './core/guards/capability.guard';
import { Routes } from '@angular/router';
import { authGuard, adminGuard, acpManagerGuard } from './core/guards/auth.guard';
import { acpViewGuard } from './core/guards/acp-view.guard';
import { itemExplorerPendingChangesGuard } from './core/guards/item-explorer-pending-changes.guard';

export const routes: Routes = [
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
    path: 'credential-login/:acpId',
    loadComponent: () =>
      import('./auth/credential-login.component').then((m) => m.CredentialLoginComponent),
  },
  {
    path: 'acps',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./admin/acp-list/acp-list.component').then((m) => m.AcpListComponent),
  },

  // Admin routes
  {
    path: 'admin',
    canActivate: [adminGuard],
    children: [
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
        path: 'acp',
        loadComponent: () =>
          import('./admin/acp-list/acp-list.component').then((m) => m.AcpListComponent),
      },
    ],
  },

  // ACP Manager routes
  {
    path: 'manage/:acpId',
    canActivate: [acpManagerGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./acp-manager/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'files',
        loadComponent: () =>
          import('./acp-manager/files/files.component').then((m) => m.FilesComponent),
      },
      {
        path: 'index',
        loadComponent: () =>
          import('./acp-manager/index/acp-index-manager.component').then(
            (m) => m.AcpIndexManagerComponent,
          ),
      },
      {
        path: 'snapshots',
        loadComponent: () =>
          import('./acp-manager/snapshots/snapshots.component').then((m) => m.SnapshotsComponent),
      },
      {
        path: 'access',
        loadComponent: () =>
          import('./acp-manager/access-config/access-config.component').then(
            (m) => m.AccessConfigComponent,
          ),
      },
      {
        path: 'application-tokens',
        loadComponent: () =>
          import('./acp-manager/application-tokens/application-tokens.component').then(
            (m) => m.AcpApplicationTokensComponent,
          ),
      },
    ],
  },

  // Public view routes (protected by acpViewGuard to handle access models)
  {
    path: 'view/:acpId',
    canActivate: [acpViewGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./views/acp-start/acp-start.component').then((m) => m.AcpStartComponent),
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
        path: 'part/:partId/unit/:unitId',
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
          import('./views/acp-index-view/acp-index-view.component').then(
            (m) => m.AcpIndexViewComponent,
          ),
      },
    ],
  },

  { path: '**', redirectTo: '' },
];
