import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { ApiService } from '../services/api.service';
import {
  explorerCapabilityGuard,
  reviewCommentsGuard,
  reviewManageGuard,
} from './capability.guard';

describe('Explorer route access', () => {
  it.each([true, false])('uses server permission %s', async (canViewExplorer) => {
    const redirect = {};
    const api = { getCapabilities: vi.fn().mockReturnValue(of({ canViewExplorer })) };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: { createUrlTree: vi.fn().mockReturnValue(redirect) } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      explorerCapabilityGuard({ paramMap: { get: () => 'ap' } } as any),
    );
    expect(await firstValueFrom(result as any)).toBe(canViewExplorer ? true : redirect);
    TestBed.resetTestingModule();
  });
  it('fails closed if permissions cannot be loaded', async () => {
    const redirect = {};
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getCapabilities: () => throwError(() => new Error()) } },
        { provide: Router, useValue: { createUrlTree: () => redirect } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      explorerCapabilityGuard({ paramMap: { get: () => 'ap' } } as any),
    );
    expect(await firstValueFrom(result as any)).toBe(redirect);
    TestBed.resetTestingModule();
  });
});

describe('Review management route access', () => {
  it.each([true, false])('uses server permission %s', async (canManageReview) => {
    const redirect = {};
    const api = { getCapabilities: vi.fn().mockReturnValue(of({ canManageReview })) };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: { createUrlTree: vi.fn().mockReturnValue(redirect) } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      reviewManageGuard({ paramMap: { get: () => 'ap' } } as any),
    );
    expect(await firstValueFrom(result as any)).toBe(canManageReview ? true : redirect);
    expect(api.getCapabilities).toHaveBeenCalledWith('ap');
    TestBed.resetTestingModule();
  });

  it('fails closed if permissions cannot be loaded', async () => {
    const redirect = {};
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getCapabilities: () => throwError(() => new Error()) } },
        { provide: Router, useValue: { createUrlTree: () => redirect } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      reviewManageGuard({ paramMap: { get: () => 'ap' } } as any),
    );
    expect(await firstValueFrom(result as any)).toBe(redirect);
    TestBed.resetTestingModule();
  });
});

describe('Review comment route access', () => {
  afterEach(() => TestBed.resetTestingModule());

  it.each([true, false])(
    'uses comment access %s while the Booklet Review is disabled',
    async (canReadReviewComments) => {
      const redirect = {};
      const api = {
        getCapabilities: vi
          .fn()
          .mockReturnValue(of({ canReadReviewComments, canReview: false, canManageReview: false })),
      };
      TestBed.configureTestingModule({
        providers: [
          { provide: ApiService, useValue: api },
          { provide: Router, useValue: { createUrlTree: vi.fn().mockReturnValue(redirect) } },
        ],
      });
      const result = TestBed.runInInjectionContext(() =>
        reviewCommentsGuard({
          paramMap: { get: () => null },
          parent: { paramMap: { get: () => 'ap' } },
        } as any),
      );
      expect(await firstValueFrom(result as any)).toBe(canReadReviewComments ? true : redirect);
      expect(api.getCapabilities).toHaveBeenCalledWith('ap');
    },
  );

  it('fails closed if Review access cannot be loaded', async () => {
    const redirect = {};
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: { getCapabilities: () => throwError(() => new Error()) } },
        { provide: Router, useValue: { createUrlTree: () => redirect } },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      reviewCommentsGuard({ paramMap: { get: () => 'ap' } } as any),
    );
    expect(await firstValueFrom(result as any)).toBe(redirect);
  });
});
