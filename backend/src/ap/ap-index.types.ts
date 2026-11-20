export type ApIndexIssueScope = "schema" | "semantic" | "vocabulary" | "file";
export type ApIndexIssueSeverity = "error" | "warning" | "info";

export interface ApIndexValidationIssue {
  code: string;
  scope: ApIndexIssueScope;
  severity: ApIndexIssueSeverity;
  path: string;
  message: string;
}

export interface ApExternalCheck {
  url: string;
  status: "valid" | "invalid" | "cached" | "unavailable";
  checkedAt?: string;
}

export interface ApIndexValidationReport {
  schemaId: "acp-index@0.6";
  valid: boolean;
  publishable: boolean;
  checkedAt: string;
  issues: ApIndexValidationIssue[];
  externalChecks: ApExternalCheck[];
}

export interface ApIndexMigrationPreview {
  candidateIndex: Record<string, unknown>;
  candidateItemProperties: Record<string, Record<string, unknown>>;
  changes: Array<{ path: string; message: string }>;
  unresolved: ApIndexValidationIssue[];
  validation: ApIndexValidationReport;
  sourceUpdatedAt: string;
}
