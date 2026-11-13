import { Component, Inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

@Component({
  standalone: true,
  selector: 'app-review-redirect',
  template: `<div class="empty-state"><h3>Review wird geöffnet …</h3></div>`,
})
export class ReviewRedirectComponent implements OnInit {
  constructor(
    @Inject(ActivatedRoute) private readonly route: ActivatedRoute,
    @Inject(Router) private readonly router: Router,
    @Inject(ApiService) private readonly api: ApiService,
  ) {}

  ngOnInit(): void {
    const apId =
      this.route.snapshot.paramMap.get('apId') ||
      this.route.parent?.snapshot.paramMap.get('apId') ||
      '';
    this.api.getCapabilities(apId).subscribe({
      next: (access) => {
        const target = access?.canManageReview
          ? ['/view', apId, 'review', 'manage']
          : ['/view', apId];
        void this.router.navigate(target, { replaceUrl: true });
      },
      error: () => void this.router.navigate(['/view', apId], { replaceUrl: true }),
    });
  }
}
