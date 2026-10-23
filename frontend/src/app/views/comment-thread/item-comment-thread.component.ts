import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, takeUntil, timeout } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { Comment, CommentThreadSnapshot, ReviewCommentTarget } from '../../core/models/api.models';
import { CommentThreadDrafts } from './comment-thread-drafts';
import { unitLabel } from '../../shared/unit-label';

interface CommentThreadGroup {
  id: string;
  root: Comment | null;
  replies: Comment[];
}

@Component({
  selector: 'app-item-comment-thread',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './item-comment-thread.component.html',
  styleUrl: './item-comment-thread.component.css',
})
export class ItemCommentThreadComponent implements OnChanges, OnDestroy {
  @Input() acpId = '';
  @Input() targetType: ReviewCommentTarget['targetType'] = 'ITEM';
  @Input() bookletId = '';
  @Input() bookletName = '';
  @Input() unitId = '';
  @Input() unitName = '';
  @Input() itemId = '';
  @Input() enabled = false;
  @Input() refreshToken = 0;
  @Input() sessionToken = 0;
  @Input() drafts = new CommentThreadDrafts();
  @Input() initiallyOpen = false;
  @Input() hideToggle = false;
  @Output() countChanged = new EventEmitter<{
    targetType?: ReviewCommentTarget['targetType'];
    unitId: string;
    itemId: string;
    count: number;
    refreshToken: number;
  }>();

  open = false;
  loading = false;
  busy = false;
  private operationError = '';

  get error(): string {
    return this.operationError || this.threadLoadError;
  }

  set error(value: string) {
    this.operationError = value;
  }
  snapshot: CommentThreadSnapshot | null = null;
  get replyingTo(): string | null {
    return this.drafts.replyTargets.get(this.targetKey) || null;
  }

  set replyingTo(value: string | null) {
    if (value) this.drafts.replyTargets.set(this.targetKey, value);
    else this.drafts.replyTargets.delete(this.targetKey);
  }

  get editingCommentId(): string | null {
    return this.editingComment?.id || null;
  }

  get editText(): string {
    return this.drafts.edits.get(this.targetKey)?.text || '';
  }

  set editText(value: string) {
    const edit = this.drafts.edits.get(this.targetKey);
    if (edit) edit.text = value;
  }

  private get editingComment(): Comment | null {
    return this.drafts.edits.get(this.targetKey)?.comment || null;
  }

  private requestToken = 0;
  private threadLoadError = '';
  private initialOpenConsumed = false;
  private threadRequest: Subscription | null = null;
  private readonly destroy$ = new Subject<void>();
  private readonly sessionChanged$ = new Subject<void>();
  private get newDrafts() {
    return this.drafts.newComments;
  }
  private get replyDrafts() {
    return this.drafts.replies;
  }
  private get expandedByTarget() {
    return this.drafts.expandedThreads;
  }

  get selectedGroupId(): string {
    return this.drafts.selectedGroups.get(this.targetKey) || '';
  }

  set selectedGroupId(value: string) {
    this.drafts.selectedGroups.set(this.targetKey, value);
  }
  get selectedCategoryId(): string {
    return this.drafts.selectedCategories.get(this.targetKey) || '';
  }

  set selectedCategoryId(value: string) {
    this.drafts.selectedCategories.set(this.targetKey, value);
  }

  get editCategoryId(): string {
    return this.drafts.edits.get(this.targetKey)?.categoryId || '';
  }

  set editCategoryId(value: string) {
    const edit = this.drafts.edits.get(this.targetKey);
    if (edit) edit.categoryId = value;
  }

  get availableCategories() {
    return (this.snapshot?.categories || []).filter((category) => !category.archived);
  }

  unavailableCategoryName(id: string): string {
    if (!id || this.availableCategories.some((category) => category.id === id)) return '';
    const category = this.snapshot?.categories?.find((entry) => entry.id === id);
    return category ? `${category.name} (archiviert)` : 'Kategorie nicht mehr verfügbar';
  }

  replyCategoryId(rootId: string): string {
    return this.drafts.replyCategories.get(this.replyDraftKey(rootId)) || '';
  }

  setReplyCategoryId(rootId: string, value: string): void {
    this.drafts.replyCategories.set(this.replyDraftKey(rootId), value);
  }

  private accessDenied = false;
  private readonly poll = setInterval(() => {
    if (this.hasTarget && !this.loading && !this.busy) this.loadThread(true);
  }, 8000);

  constructor(private readonly api: ApiService) {}

  ngOnChanges(changes: SimpleChanges): void {
    const targetChanged =
      changes['acpId'] ||
      changes['targetType'] ||
      changes['bookletId'] ||
      changes['unitId'] ||
      changes['itemId'] ||
      changes['enabled'];
    const sessionChanged = changes['sessionToken'];
    if (sessionChanged) {
      this.sessionChanged$.next();
      this.busy = false;
      if (!sessionChanged.firstChange) this.drafts.clear();
    }
    if (targetChanged || sessionChanged) {
      this.requestToken += 1;
      this.threadRequest?.unsubscribe();
      this.threadRequest = null;
      this.loading = false;
      this.snapshot = null;
      this.error = '';
      this.threadLoadError = '';
      if (this.initiallyOpen && !this.initialOpenConsumed) {
        this.open = true;
        this.initialOpenConsumed = true;
      }
      if (this.hasTarget) this.loadThread();
    } else if (changes['refreshToken'] && !changes['refreshToken'].firstChange && this.hasTarget) {
      if (!this.loading && !this.busy) this.loadThread(true);
    }
  }

  ngOnDestroy(): void {
    clearInterval(this.poll);
    this.threadRequest?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.sessionChanged$.complete();
  }

  get hasTarget(): boolean {
    if (!this.enabled || !this.acpId) return false;
    if (this.targetType === 'BOOKLET') return Boolean(this.bookletId);
    if (this.targetType === 'UNIT') return Boolean(this.unitId);
    return Boolean(this.unitId && this.itemId);
  }

  get panelId(): string {
    return `${this.targetType.toLowerCase()}-comment-panel`;
  }

  get contextLabel(): string {
    if (this.targetType === 'BOOKLET') return `Testheft ${this.bookletName || this.bookletId}`;
    if (this.targetType === 'UNIT')
      return `Aufgabe ${unitLabel({ id: this.unitId, name: this.unitName })}`;
    if (this.targetType === 'CODING') return `Kodierung ${this.unitId} · ${this.itemId}`;
    return `Item ${this.unitId} · ${this.itemId}`;
  }

  get commentHeading(): string {
    if (this.targetType === 'BOOKLET') return `Kommentare zum ${this.contextLabel}`;
    if (this.targetType === 'UNIT') return `Kommentare zur ${this.contextLabel}`;
    if (this.targetType === 'CODING') {
      return `Kommentare zur Kodierung ${this.unitId} · ${this.itemId}`;
    }
    return `Kommentare zu ${this.contextLabel}`;
  }

  get panelAriaLabel(): string {
    return this.targetType === 'ITEM' ? 'Kommentare zum ausgewählten Item' : this.commentHeading;
  }

  get newCommentPlaceholder(): string {
    if (this.targetType === 'ITEM') return 'Kommentar zu diesem Item …';
    if (this.targetType === 'BOOKLET') return `Kommentar zum ${this.contextLabel} …`;
    if (this.targetType === 'UNIT') return `Kommentar zur ${this.contextLabel} …`;
    return `Kommentar zur Kodierung ${this.unitId} · ${this.itemId} …`;
  }

  get emptyStateText(): string {
    return this.targetType === 'ITEM'
      ? 'Noch keine Kommentare zu diesem Item.'
      : 'Noch keine Kommentare in diesem Kontext.';
  }

  get commentCount(): number {
    return (this.snapshot?.comments || []).filter((comment) => !comment.isDeleted).length;
  }

  get visibilityLabel(): string {
    return this.snapshot?.visibilityMode === 'GROUP'
      ? 'Review-Gruppen'
      : this.snapshot?.visibilityMode === 'SHARED'
        ? 'Geteilt'
        : 'Privat';
  }

  get newCommentText(): string {
    return this.newDrafts.get(this.targetKey) || '';
  }

  set newCommentText(value: string) {
    this.newDrafts.set(this.targetKey, value);
  }

  get editAccessLost(): boolean {
    return (
      this.accessDenied ||
      Boolean(
        this.editingComment?.groupId &&
        this.snapshot?.visibilityMode === 'GROUP' &&
        !this.snapshot.groups?.some((group) => group.id === this.editingComment!.groupId),
      )
    );
  }

  get threadGroups(): CommentThreadGroup[] {
    const comments = [...(this.snapshot?.comments || [])];
    // Keep the active edit and its original version even when another tab changes it.
    if (this.editingComment && !this.editAccessLost) {
      const index = comments.findIndex((comment) => comment.id === this.editingComment!.id);
      if (index >= 0) comments[index] = this.editingComment;
      else comments.push(this.editingComment);
    }
    const roots = comments.filter((comment) => !comment.parentCommentId);
    const repliesByParent = new Map<string, Comment[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) continue;
      const replies = repliesByParent.get(comment.parentCommentId) || [];
      replies.push(comment);
      repliesByParent.set(comment.parentCommentId, replies);
    }
    const groups: CommentThreadGroup[] = roots.map((root) => ({
      id: root.id,
      root,
      replies: repliesByParent.get(root.id) || [],
    }));
    const rootIds = new Set(roots.map((root) => root.id));
    for (const [parentId, replies] of repliesByParent) {
      if (!rootIds.has(parentId)) {
        groups.push({ id: parentId, root: null, replies });
      }
    }
    // A removed reply target must not remove the user's open draft form.
    if (this.replyingTo && !groups.some((group) => group.id === this.replyingTo)) {
      groups.push({ id: this.replyingTo, root: null, replies: [] });
    }
    return groups.sort((left, right) => {
      const leftDate = left.root?.createdAt || left.replies[0]?.createdAt || '';
      const rightDate = right.root?.createdAt || right.replies[0]?.createdAt || '';
      return rightDate.localeCompare(leftDate) || left.id.localeCompare(right.id);
    });
  }

  toggleOpen(): void {
    this.open = !this.open;
    if (this.open && this.hasTarget && !this.loading && !this.snapshot) this.loadThread();
  }

  loadThread(preserveError = false): void {
    if (!this.hasTarget) return;
    this.threadRequest?.unsubscribe();
    const token = ++this.requestToken;
    const refreshToken = this.refreshToken;
    this.loading = true;
    const request =
      this.targetType === 'ITEM'
        ? this.api.getItemCommentThread(this.acpId, this.unitId, this.itemId, this.snapshot)
        : this.api.getReviewCommentThread(this.acpId, this.target, this.snapshot);
    this.threadRequest = request.pipe(timeout(10_000), takeUntil(this.destroy$)).subscribe({
      next: (snapshot) => {
        if (token !== this.requestToken) return;
        this.snapshot = snapshot;
        this.accessDenied = false;
        if (snapshot.visibilityMode !== 'GROUP') this.selectedGroupId = '';
        if (
          this.selectedGroupId &&
          !snapshot.groups?.some((group) => group.id === this.selectedGroupId && !group.archived)
        )
          this.selectedGroupId = '';
        if (!this.selectedGroupId && !this.newCommentText)
          this.selectedGroupId = snapshot.defaultGroupId || '';

        this.countChanged.emit({
          ...(this.targetType === 'ITEM' ? {} : { targetType: this.targetType }),
          unitId: snapshot.target.unitId || '',
          itemId: snapshot.target.itemId || '',
          count: this.commentCount,
          refreshToken,
        });
        this.loading = false;
        this.threadRequest = null;
        if (!preserveError) this.operationError = '';
        this.threadLoadError = '';
      },
      error: (error) => {
        if (token !== this.requestToken) return;
        this.loading = false;
        this.threadRequest = null;
        if (error?.status === 403 || error?.status === 401) {
          this.snapshot = null;
          this.accessDenied = true;
        }
        this.threadLoadError = this.errorMessage(error, 'Kommentare konnten nicht geladen werden.');
        if (!preserveError) this.operationError = '';
      },
    });
  }

  submitComment(parentCommentId?: string): void {
    if (!parentCommentId && this.snapshot?.visibilityMode === 'GROUP' && !this.selectedGroupId) {
      this.error = 'Bitte die Review-Gruppe für diesen Entwurf wählen.';
      return;
    }
    const categoryId = parentCommentId
      ? this.replyCategoryId(parentCommentId)
      : this.selectedCategoryId;
    if (categoryId && !this.availableCategories.some((category) => category.id === categoryId)) {
      this.error = 'Bitte eine verfügbare Kategorie oder „Ohne Kategorie“ wählen.';
      return;
    }
    const targetKey = this.targetKey;
    const acpId = this.acpId;
    const replyDraftKey = parentCommentId ? this.replyDraftKey(parentCommentId, targetKey) : '';
    const text = parentCommentId ? this.replyDrafts.get(replyDraftKey) || '' : this.newCommentText;
    if (!text.trim() || this.busy) return;
    this.busy = true;
    const input = {
      commentText: text.trim(),
      ...(categoryId ? { categoryId } : {}),
      ...(!parentCommentId && this.snapshot?.visibilityMode === 'GROUP' && this.selectedGroupId
        ? { groupId: this.selectedGroupId }
        : {}),
      ...(parentCommentId ? { parentCommentId } : {}),
    };
    const request =
      this.targetType === 'ITEM'
        ? this.api.createItemComment(acpId, {
            unitId: this.unitId,
            itemId: this.itemId,
            ...input,
          })
        : this.api.createReviewComment(acpId, { ...this.target, ...input });
    request.pipe(takeUntil(this.destroy$), takeUntil(this.sessionChanged$)).subscribe({
      next: () => {
        if (parentCommentId) {
          this.replyDrafts.delete(replyDraftKey);
          this.drafts.replyCategories.delete(replyDraftKey);
          this.expandedThreadsFor(targetKey).add(parentCommentId);
          this.drafts.replyTargets.delete(targetKey);
        } else {
          this.newDrafts.delete(targetKey);
          this.drafts.selectedCategories.delete(targetKey);
        }
        this.busy = false;
        if (targetKey === this.targetKey) this.loadThread();
      },
      error: (error) => {
        this.busy = false;
        if (targetKey === this.targetKey) {
          this.error = this.errorMessage(error, 'Kommentar konnte nicht gespeichert werden.');
        }
      },
    });
  }

  startReply(rootId: string): void {
    this.replyingTo = this.replyingTo === rootId ? null : rootId;
  }

  replyText(rootId: string): string {
    return this.replyDrafts.get(this.replyDraftKey(rootId)) || '';
  }

  setReplyText(rootId: string, value: string): void {
    this.replyDrafts.set(this.replyDraftKey(rootId), value);
  }

  startEdit(comment: Comment): void {
    this.drafts.edits.set(this.targetKey, {
      comment: { ...comment },
      text: comment.commentText,
      categoryId: comment.categoryId || '',
    });
  }

  cancelEdit(): void {
    this.drafts.edits.delete(this.targetKey);
  }

  saveEdit(comment: Comment): void {
    if (!this.editText.trim() || this.busy || !comment.version) return;
    const version =
      this.editingComment?.id === comment.id ? this.editingComment.version : comment.version;
    if (!version) return;
    const targetKey = this.targetKey;
    this.busy = true;
    this.api
      .updateItemComment(this.acpId, comment.id, {
        commentText: this.editText.trim(),
        ...(this.editCategoryId !== (this.editingComment?.categoryId || '')
          ? { categoryId: this.editCategoryId || null }
          : {}),
        version,
      })
      .pipe(takeUntil(this.destroy$), takeUntil(this.sessionChanged$))
      .subscribe({
        next: () => {
          this.busy = false;
          this.drafts.edits.delete(targetKey);
          if (targetKey === this.targetKey) this.loadThread();
        },
        error: (error) => {
          this.busy = false;
          if (targetKey === this.targetKey) {
            this.error = this.errorMessage(error, 'Kommentar konnte nicht geändert werden.');
            if (error?.status === 409) this.loadThread(true);
          }
        },
      });
  }

  deleteComment(comment: Comment): void {
    if (!comment.version || this.busy) return;
    if (!window.confirm('Diesen eigenen Kommentar wirklich löschen?')) return;
    const targetKey = this.targetKey;
    this.busy = true;
    this.api
      .deleteItemComment(this.acpId, comment.id, comment.version)
      .pipe(takeUntil(this.destroy$), takeUntil(this.sessionChanged$))
      .subscribe({
        next: () => {
          this.busy = false;
          if (targetKey === this.targetKey) this.loadThread();
        },
        error: (error) => {
          this.busy = false;
          if (targetKey === this.targetKey) {
            this.error = this.errorMessage(error, 'Kommentar konnte nicht gelöscht werden.');
            if (error?.status === 409) this.loadThread(true);
          }
        },
      });
  }

  vote(comment: Comment, value: 'UP' | 'DOWN'): void {
    if (this.busy || !comment.canVote || this.snapshot?.visibilityMode !== 'SHARED') return;
    const targetKey = this.targetKey;
    this.busy = true;
    this.api
      .setCommentVote(this.acpId, comment.id, comment.myVote === value ? null : value)
      .pipe(timeout(10_000), takeUntil(this.destroy$), takeUntil(this.sessionChanged$))
      .subscribe({
        next: () => {
          this.busy = false;
          if (targetKey === this.targetKey) this.loadThread();
        },
        error: (error) => {
          this.busy = false;
          if (targetKey === this.targetKey) {
            this.error = this.errorMessage(error, 'Bewertung konnte nicht gespeichert werden.');
            this.loadThread(true);
          }
        },
      });
  }

  toggleReplies(threadId: string): void {
    const expanded = this.expandedThreads;
    if (expanded.has(threadId)) expanded.delete(threadId);
    else expanded.add(threadId);
  }

  repliesExpanded(threadId: string): boolean {
    return this.expandedThreads.has(threadId);
  }

  authorInitials(label?: string): string {
    const parts = String(label || '?')
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean);
    return (
      parts.length > 1
        ? `${parts[0][0]}${parts[parts.length - 1][0]}`
        : parts[0]?.slice(0, 2) || '?'
    ).toUpperCase();
  }

  wasEdited(comment: Comment): boolean {
    return (comment.version ?? 1) > 1;
  }

  private get targetKey(): string {
    return `${this.acpId}\u0000${this.targetType}\u0000${this.bookletId}\u0000${this.unitId}\u0000${this.itemId}`;
  }

  private get target(): ReviewCommentTarget {
    if (this.targetType === 'BOOKLET') {
      return { targetType: this.targetType, bookletId: this.bookletId };
    }
    if (this.targetType === 'UNIT') {
      return { targetType: this.targetType, unitId: this.unitId };
    }
    return { targetType: this.targetType, unitId: this.unitId, itemId: this.itemId };
  }

  private get expandedThreads(): Set<string> {
    return this.expandedThreadsFor(this.targetKey);
  }

  private expandedThreadsFor(targetKey: string): Set<string> {
    let expanded = this.expandedByTarget.get(targetKey);
    if (!expanded) {
      expanded = new Set<string>();
      this.expandedByTarget.set(targetKey, expanded);
    }
    return expanded;
  }

  private replyDraftKey(rootId: string, targetKey = this.targetKey): string {
    return `${targetKey}\u0000${rootId}`;
  }

  private errorMessage(error: any, fallback: string): string {
    const message = error?.error?.message;
    if (Array.isArray(message)) return message.join(' ');
    return typeof message === 'string' && message.trim() ? message : fallback;
  }
}
