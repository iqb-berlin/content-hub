import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Acp, AcpRoleAssignment } from '../../core/models/api.models';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { getAcpRoleLabel } from '../../core/utils/acp-role-label.util';

@Component({
  selector: 'app-acp-manager-context',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="acp-context">
      <a [routerLink]="backLink" class="btn btn-outline btn-sm">{{ backLabel }}</a>

      <div class="context-meta">
        @if (acp) {
          <span class="context-name">{{ acp.name }}</span>
          <span class="badge badge-info">{{ acp.packageId }}</span>
        } @else {
          <span class="context-name">ACP wird geladen...</span>
        }
        <span class="badge badge-success">{{ roleLabel }}</span>
      </div>
    </div>
  `,
  styles: [
    `
      .acp-context {
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
export class AcpManagerContextComponent implements OnInit {
  acpId = '';
  acp: Acp | null = null;
  roleLabel = 'Zugriff gewährt';
  backLink: string[] = ['/acps'];
  backLabel = '← Zur ACP-Liste';

  private roleAssignments: AcpRoleAssignment[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private auth: AuthService,
    private destroyRef: DestroyRef,
  ) {}

  ngOnInit() {
    this.acpId =
      this.route.parent?.snapshot.paramMap.get('acpId') ||
      this.route.snapshot.paramMap.get('acpId') ||
      '';
    if (!this.acpId) return;

    this.setBackNavigation();
    this.updateRoleLabel();

    this.api
      .getAcp(this.acpId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((acp) => {
        this.acp = acp;
      });

    this.api
      .getAcpRoles(this.acpId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((roles: AcpRoleAssignment[]) => {
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
      this.roleLabel = getAcpRoleLabel(null, false);
      return;
    }

    const myRole = this.roleAssignments.find(
      (assignment) => assignment.userId === currentUser.id,
    )?.role;
    this.roleLabel = getAcpRoleLabel(myRole, isAppAdmin);
  }

  private setBackNavigation() {
    const currentPath = this.route.snapshot.routeConfig?.path ?? '';
    if (!currentPath) {
      this.backLink = ['/acps'];
      this.backLabel = '← Zur ACP-Liste';
      return;
    }

    this.backLink = ['/manage', this.acpId];
    this.backLabel = '← Zur ACP-Übersicht';
  }
}
