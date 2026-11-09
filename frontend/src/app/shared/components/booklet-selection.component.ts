import { Component, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

export interface BookletSelectionItem {
  id: string;
  name?: string | null;
}

@Component({
  selector: 'app-booklet-selection',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="booklet-toolbar">
      <label>
        <span>Testhefte durchsuchen</span>
        <input type="search" [(ngModel)]="searchQuery" placeholder="Bezeichnung oder Booklet-ID" />
      </label>
      <span class="result-count">{{ filteredCount }} von {{ booklets.length }} Testheften</span>
    </div>

    <ul class="booklet-list">
      @for (booklet of filteredBooklets; track booklet.id) {
        <li>
          <div class="booklet-identity">
            <code class="booklet-id">{{ booklet.id }}</code>
            @if (hasDistinctName(booklet)) {
              <span class="booklet-name">{{ displayName(booklet) }}</span>
            }
          </div>
          <a
            [routerLink]="['/view', apId, 'sequence', booklet.id]"
            [queryParams]="{ kind: 'booklet' }"
            >{{ actionLabel }}</a
          >
        </li>
      } @empty {
        <li class="empty-state">Keine Testhefte entsprechen dem Filter.</li>
      }
    </ul>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-top: 16px;
      }
      .booklet-toolbar {
        display: flex;
        align-items: end;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 12px;
      }
      .booklet-toolbar label {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        min-width: min(100%, 320px);
        margin: 0;
        font-weight: 600;
      }
      .booklet-toolbar input {
        width: 100%;
        padding: 0.55rem 0.7rem;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        font: inherit;
      }
      .result-count {
        color: var(--color-text-secondary);
        font-size: 0.9rem;
      }
      .booklet-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
        gap: 0;
        margin: 0;
        padding: 0;
        list-style: none;
        border-top: 1px solid var(--color-border);
        border-left: 1px solid var(--color-border);
      }
      .booklet-list .empty-state {
        grid-column: 1 / -1;
        color: var(--color-text-secondary);
      }
      .booklet-list li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
        padding: 10px 12px;
        border-right: 1px solid var(--color-border);
        border-bottom: 1px solid var(--color-border);
      }
      .booklet-identity {
        display: flex;
        flex-direction: column;
        gap: 3px;
        min-width: 0;
      }
      .booklet-name {
        overflow: hidden;
        color: var(--color-text-secondary);
        font-size: 0.82rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .booklet-id {
        overflow-wrap: anywhere;
        color: inherit;
        font-family: inherit;
        font-size: 0.95rem;
        font-weight: 700;
      }
      .booklet-list a {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      @media (max-width: 600px) {
        .booklet-toolbar label {
          min-width: 100%;
        }
        .booklet-list li {
          align-items: flex-start;
        }
      }
    `,
  ],
})
export class BookletSelectionComponent {
  @Input({ required: true }) apId = '';
  @Input() booklets: BookletSelectionItem[] = [];
  @Input() actionLabel = 'Prüfansicht öffnen';

  searchQuery = '';

  get filteredBooklets(): BookletSelectionItem[] {
    const query = this.normalize(this.searchQuery);
    return [...this.booklets]
      .filter((item) => {
        const displayName = this.displayName(item);
        if (!query) return true;
        return (
          this.normalize(displayName).includes(query) || this.normalize(item.id).includes(query)
        );
      })
      .sort((left, right) => left.id.localeCompare(right.id, 'de', { numeric: true }));
  }

  get filteredCount(): number {
    return this.filteredBooklets.length;
  }

  displayName(booklet: BookletSelectionItem): string {
    return booklet.name?.trim() || booklet.id;
  }

  hasDistinctName(booklet: BookletSelectionItem): boolean {
    return !!booklet.name?.trim() && booklet.name.trim() !== booklet.id;
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLocaleLowerCase('de');
  }
}
