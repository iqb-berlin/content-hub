import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StudioItemComment } from '../../../../core/models/api.models';

@Component({
  selector: 'app-studio-item-comments',
  standalone: true,
  imports: [CommonModule],
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
      padding: 16px;
      margin-bottom: 12px;
      overflow-wrap: anywhere;
    }
    h3 {
      margin: 0 0 4px;
      font-size: 1rem;
    }
    .source-hint,
    .comment-meta {
      color: var(--color-text-secondary);
      font-size: 0.85rem;
    }
    .source-hint {
      margin: 0 0 12px;
    }
    ol {
      margin: 0;
      padding-left: 20px;
    }
    li + li {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--color-border);
    }
    .comment-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 4px;
    }
    .comment-body {
      white-space: pre-wrap;
    }
    .comment-body :first-child {
      margin-top: 0;
    }
    .comment-body :last-child {
      margin-bottom: 0;
    }
  `,
})
export class StudioItemCommentsComponent {
  @Input() comments: readonly StudioItemComment[] = [];
}
