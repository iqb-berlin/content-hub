import { Comment } from '../../core/models/api.models';

/** In-memory drafts owned by the containing workspace, keyed by full target identity. */
export class CommentThreadDrafts {
  readonly newComments = new Map<string, string>();
  readonly replies = new Map<string, string>();
  readonly edits = new Map<string, { comment: Comment; text: string; categoryId?: string }>();
  readonly replyTargets = new Map<string, string>();
  readonly selectedCategories = new Map<string, string>();
  readonly replyCategories = new Map<string, string>();
  readonly selectedGroups = new Map<string, string>();
  readonly expandedThreads = new Map<string, Set<string>>();

  clear(): void {
    this.newComments.clear();
    this.replies.clear();
    this.edits.clear();
    this.replyTargets.clear();
    this.selectedGroups.clear();
    this.selectedCategories.clear();
    this.replyCategories.clear();
    this.expandedThreads.clear();
  }
}
