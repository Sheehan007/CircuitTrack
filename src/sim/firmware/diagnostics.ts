export interface Diagnostic {
  line: number;
  col: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export class CompileError extends Error {
  constructor(public diag: Diagnostic) { super(diag.message); }
}
