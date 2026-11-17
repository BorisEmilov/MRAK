export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** Stable machine-readable code, used by tests and the editor. */
  code: string;
  message: string;
  file?: string | undefined;
  /** "collection/id", e.g. "trees/exorcist". */
  entity?: string | undefined;
  path?: string | undefined;
}

export class IssueList {
  readonly items: Issue[] = [];

  error(
    code: string,
    message: string,
    where: Omit<Issue, 'severity' | 'code' | 'message'> = {},
  ): void {
    this.items.push({ severity: 'error', code, message, ...where });
  }

  warn(
    code: string,
    message: string,
    where: Omit<Issue, 'severity' | 'code' | 'message'> = {},
  ): void {
    this.items.push({ severity: 'warning', code, message, ...where });
  }

  get errors(): Issue[] {
    return this.items.filter((i) => i.severity === 'error');
  }
}

export function formatIssue(issue: Issue): string {
  const where = [issue.file, issue.entity, issue.path].filter(Boolean).join(' › ');
  return `${issue.severity.toUpperCase()} [${issue.code}] ${where ? `${where}: ` : ''}${issue.message}`;
}
