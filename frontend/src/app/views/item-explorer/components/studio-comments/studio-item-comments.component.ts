import { Component, Input, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StudioItemComment } from '../../../../core/models/api.models';

@Component({
  selector: 'app-studio-item-comments',
  standalone: true,
  imports: [CommonModule],
  // Imported rich text has no Angular scope attributes. Keep every style below
  // scoped to this section so embedded images and paragraphs receive the rules.
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (comments.length) {
      <section class="studio-comments card" aria-label="Studio-Kommentare">
        <h3>Studio-Kommentare</h3>
        <p class="source-hint">Aus dem Studio übernommen · nur lesbar</p>
        <ol>
          @for (comment of comments; track comment.id) {
            <li>
              <div class="comment-meta">
                @if (comment.parentId) {
                  <span>Antwort aus dem Studio</span>
                }
                @if (comment.userName) {
                  <span>{{ comment.userName }}</span>
                }
                @if (comment.createdAt) {
                  <time [attr.datetime]="comment.createdAt">{{
                    comment.createdAt | date: 'dd.MM.yyyy HH:mm'
                  }}</time>
                }
                @if (comment.hidden) {
                  <span>Im Studio ausgeblendet</span>
                }
              </div>
              <div class="comment-body" [innerHTML]="comment.body"></div>
            </li>
          }
        </ol>
      </section>
    }
  `,
  styles: `
    .studio-comments {
      min-width: 0;
      padding: 16px;
      margin-bottom: 12px;
      overflow-wrap: anywhere;
    }
    .studio-comments h3 {
      margin: 0 0 4px;
      font-size: 1rem;
    }
    .studio-comments .source-hint,
    .studio-comments .comment-meta {
      color: var(--color-text-secondary);
      font-size: 0.85rem;
    }
    .studio-comments .source-hint {
      margin: 0 0 12px;
    }
    .studio-comments > ol {
      margin: 0;
      padding-left: 20px;
    }
    .studio-comments > ol > li + li {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--color-border);
    }
    .studio-comments .comment-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 4px;
    }
    .studio-comments .comment-body {
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .studio-comments .comment-body img {
      max-width: 100%;
      height: auto;
    }
    .studio-comments .comment-body > :first-child {
      margin-top: 0;
    }
    .studio-comments .comment-body > :last-child {
      margin-bottom: 0;
    }
  `,
})
export class StudioItemCommentsComponent {
  @Input() comments: readonly StudioItemComment[] = [];
}
