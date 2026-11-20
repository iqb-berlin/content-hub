import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it } from 'vitest';
import { SplitPaneComponent } from './split-pane.component';

@Component({
  standalone: true,
  imports: [SplitPaneComponent],
  template: `
    <app-split-pane [hideRight]="hidden"
      ><div left>Table</div>
      <div right>Preview</div></app-split-pane
    >
  `,
})
class Host {
  hidden = false;
}

afterEach(() => TestBed.resetTestingModule());

it('removes the divider and right pane, fills the width and restores the previous split', async () => {
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideZonelessChangeDetection()],
  }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const split = fixture.debugElement.children[0].componentInstance as SplitPaneComponent;
  split.leftPercent = 62;
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  expect(root.querySelector<HTMLElement>('.pane-left')?.style.width).toBe('62%');
  split.onDragStart(new MouseEvent('mousedown'));
  fixture.componentInstance.hidden = true;
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  expect(split.isDragging).toBe(false);
  expect(root.querySelector('.divider')).toBeNull();
  expect(root.querySelector('.pane-right')).toBeNull();
  expect(root.querySelector<HTMLElement>('.pane-left')?.style.width).toBe('100%');
  fixture.componentInstance.hidden = false;
  fixture.changeDetectorRef.markForCheck();
  fixture.detectChanges();
  expect(root.querySelector('.divider')).not.toBeNull();
  expect(root.querySelector<HTMLElement>('.pane-left')?.style.width).toBe('62%');
});
