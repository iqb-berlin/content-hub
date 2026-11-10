import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Ap, ApRoleAssignment } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { getApRoleLabel } from '../../core/utils/ap-role-label.util';

@Component({
  selector: 'app-ap-manager-context',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="ap-context">
      <a [routerLink]="backLink" class="btn btn-outline btn-sm">{{ backLabel }}</a>

      <div class="context-meta">
        @if (ap) {
          <span class="context-name">{{ ap.name }}</span>
          <span class="badge badge-info">{{ ap.packageId }}</span>
        } @else {
          <span class="context-name">AP wird geladen...</span>
        }
        <span class="badge badge-success">{{ roleLabel }}</span>
      </div>
    </div>
  `,
  styles: [
    `
      .ap-context {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }

      .context-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .context-name {
        font-weight: 600;
        font-size: 0.95rem;
      }
    `,
  ],
})
export class ApManagerContextComponent implements OnInit {
  apId = '';
  ap: Ap | null = null;
  roleLabel = 'Zugriff gewährt';
  backLink: string[] = ['/aps'];
  backLabel = '← Zur AP-Liste';

  private roleAssignments: ApRoleAssignment[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private auth: AuthService,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit() {
    this.apId =
      this.route.parent?.snapshot.paramMap.get('apId') ||
      this.route.snapshot.paramMap.get('apId') ||
      '';
    if (!this.apId) return;

    this.setBackNavigation();
    this.updateRoleLabel();

    this.api
      .getAp(this.apId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ap) => {
        this.ap = ap;
      });

    this.api
      .getApRoles(this.apId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((roles: ApRoleAssignment[]) => {
        this.roleAssignments = roles;
        this.updateRoleLabel();
      });

    this.auth.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.updateRoleLabel());
  }

  private updateRoleLabel() {
    const currentUser = this.auth.currentUser;
    const isAppAdmin = currentUser?.isAppAdmin ?? false;

    if (!currentUser) {
      this.roleLabel = getApRoleLabel(null, false);
      return;
    }

    const myRole = this.roleAssignments.find(
      (assignment) => assignment.userId === currentUser.id,
    )?.role;
    this.roleLabel = getApRoleLabel(myRole, isAppAdmin);
  }

  private setBackNavigation() {
    const currentPath = this.route.snapshot.routeConfig?.path ?? '';
    if (!currentPath) {
      this.backLink = ['/aps'];
      this.backLabel = '← Zur AP-Liste';
      return;
    }

    this.backLink = ['/manage', this.apId];
    this.backLabel = '← Zur AP-Übersicht';
  }
}
