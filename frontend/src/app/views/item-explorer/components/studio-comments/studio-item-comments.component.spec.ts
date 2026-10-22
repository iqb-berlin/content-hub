import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioItemCommentsComponent } from './studio-item-comments.component';

describe('StudioItemCommentsComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  async function render() {
    await TestBed.configureTestingModule({
      imports: [StudioItemCommentsComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    return TestBed.createComponent(StudioItemCommentsComponent);
  }

  it('only shows nonempty imported comments, in source order, without editing controls', async () => {
    const fixture = await render();
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('section')).toBeNull();
    fixture.componentRef.setInput('comments', [
      {
        id: 1,
        body: '<p>First <strong>hint</strong></p>',
        userName: 'Author',
        createdAt: '2026-10-21T08:00:00Z',
        hidden: false,
      },
      { id: 2, body: 'Second hint', parentId: 1, hidden: true },
    ]);
    fixture.detectChanges();
    expect(root.querySelector('section')?.getAttribute('aria-label')).toBe('Studio-Kommentare');
    expect([...root.querySelectorAll('.comment-body')].map((node) => node.textContent)).toEqual([
      'First hint',
      'Second hint',
    ]);
    expect(root.querySelector('strong')?.textContent).toBe('hint');
    expect(root.textContent).toContain('nur lesbar');
    expect(root.textContent).toContain('Antwort aus dem Studio');
    expect(root.textContent).toContain('Im Studio ausgeblendet');
    expect(root.querySelector('button, textarea, input')).toBeNull();
    fixture.componentRef.setInput('comments', []);
    fixture.detectChanges();
    expect(root.querySelector('section')).toBeNull();
  });

  it('sanitizes imported HTML while preserving readable content', async () => {
    const fixture = await render();
    fixture.componentRef.setInput('comments', [
      {
        id: 1,
        hidden: false,
        body: '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">Hint</a>',
      },
    ]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('script, [onerror]')).toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).not.toBe('javascript:alert(1)');
    expect(root.textContent).toContain('Hint');
  });
});
