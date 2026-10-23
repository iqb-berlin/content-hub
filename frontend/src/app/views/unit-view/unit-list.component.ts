import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { BreadcrumbComponent, BreadcrumbItem } from '../../shared/components/breadcrumb.component';

@Component({
  selector: 'app-unit-list',
  standalone: true,
  imports: [RouterLink, BreadcrumbComponent],
  template: `
    <app-breadcrumb [items]="breadcrumbs" />

    <div class="page-header">
      <h1>Aufgaben</h1>
      <span class="unit-count">{{ units.length }} Aufgaben</span>
    </div>

    <div class="card">
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (unit of units; track (unit.partId || 'legacy') + '/' + unit.id) {
            <tr>
              <td>
                <code>{{ unit.id }}</code>
              </td>
              <td>{{ unit.name }}</td>
              <td>
                <a
                  [routerLink]="
                    unit.partId
                      ? ['/view', acpId, 'part', unit.partId, 'unit', unit.id]
                      : ['/view', acpId, 'unit', unit.id]
                  "
                  class="btn btn-sm btn-primary"
                  >Ansehen</a
                >
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      .unit-count {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class UnitListComponent implements OnInit {
  acpId = '';
  units: any[] = [];
  breadcrumbs: BreadcrumbItem[] = [];

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
  ) {}

  ngOnInit() {
    this.acpId = this.route.snapshot.paramMap.get('acpId') || '';
    this.breadcrumbs = [
      { label: 'Assessment Content Pool', route: ['/'] },
      { label: 'ACP', route: ['/view', this.acpId] },
      { label: 'Aufgaben' },
    ];
    this.api.getViewUnits(this.acpId).subscribe((u) => (this.units = u));
  }
}
