export type AcpIndexIssueScope = "schema" | "semantic" | "vocabulary" | "file";
export type AcpIndexIssueSeverity = "error" | "warning" | "info";

export interface AcpIndexValidationIssue {
  code: string;
  scope: AcpIndexIssueScope;
  severity: AcpIndexIssueSeverity;
  path: string;
  message: string;
}

export interface AcpExternalCheck {
  url: string;
  status: "valid" | "invalid" | "cached" | "unavailable";
  checkedAt?: string;
}

export interface AcpIndexValidationReport {
  schemaId: "acp-index@0.6";
  valid: boolean;
  publishable: boolean;
  checkedAt: string;
  issues: AcpIndexValidationIssue[];
  externalChecks: AcpExternalCheck[];
}

export interface AcpIndexMigrationPreview {
  candidateIndex: Record<string, unknown>;
  candidateItemProperties: Record<string, Record<string, unknown>>;
  changes: Array<{ path: string; message: string }>;
  unresolved: AcpIndexValidationIssue[];
  validation: AcpIndexValidationReport;
  sourceUpdatedAt: string;
}
