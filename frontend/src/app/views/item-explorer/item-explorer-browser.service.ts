import { Injectable } from '@angular/core';

/** The browser operations needed by the explorer's data services. */
@Injectable()
export class ItemExplorerBrowser {
  isVisible(): boolean {
    return document.visibilityState === 'visible';
  }

  watchVisibility(refresh: () => void): () => void {
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }

  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }
}
