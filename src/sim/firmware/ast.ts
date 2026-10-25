// AST for the supported Arduino-C++ subset.

export interface Pos { line: number; col: number }

export interface TypeSpec extends Pos {
  /** Normalised base: 'int', 'unsigned long', 'float', 'String', 'char', 'Servo', … */
  base: string;
  isConst: boolean;
  isStatic: boolean;
  /** Pointer depth: only `const char*` (text) is supported. */
  ptr: number;
}

export type Expr = Pos & (
  | { k: 'num'; value: number; float: boolean; f32?: boolean; unsigned?: boolean; long?: boolean }
  | { k: 'str'; value: string }
  | { k: 'char'; value: number }
  | { k: 'bool'; value: boolean }
  | { k: 'id'; name: string }
  | { k: 'unary'; op: '-' | '+' | '!' | '~'; arg: Expr }
  | { k: 'update'; op: '++' | '--'; prefix: boolean; arg: Expr }
  | { k: 'binary'; op: string; l: Expr; r: Expr }
  | { k: 'logical'; op: '&&' | '||'; l: Expr; r: Expr }
  | { k: 'assign'; op: string; target: Expr; value: Expr }
  | { k: 'cond'; test: Expr; a: Expr; b: Expr }
  | { k: 'call'; callee: Expr; args: Expr[] }
  | { k: 'member'; obj: Expr; prop: string; arrow: boolean }
  | { k: 'index'; obj: Expr; index: Expr }
  | { k: 'cast'; type: TypeSpec; arg: Expr }
  | { k: 'sizeof'; type?: TypeSpec; arg?: Expr }
  | { k: 'addr'; arg: Expr }
  | { k: 'scoped'; ns: string; name: string }
  | { k: 'init'; items: Expr[] }
);

export interface Declarator extends Pos {
  name: string;
  dims: (Expr | null)[];
  init?: Expr;
  /** `Servo s(…)` style constructor arguments. */
  ctorArgs?: Expr[];
}

export type Stmt = Pos & (
  | { k: 'block'; body: Stmt[] }
  | { k: 'expr'; expr: Expr }
  | { k: 'var'; type: TypeSpec; decls: Declarator[] }
  | { k: 'if'; test: Expr; then: Stmt; else?: Stmt }
  | { k: 'while'; test: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; test: Expr }
  | { k: 'for'; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt }
  | { k: 'forrange'; type: TypeSpec; name: string; iter: Expr; body: Stmt }
  | { k: 'switch'; disc: Expr; cases: { test: Expr | null; body: Stmt[]; line: number }[] }
  | { k: 'break' }
  | { k: 'continue' }
  | { k: 'return'; value?: Expr }
  | { k: 'empty' }
);

export interface Param extends Pos { type: TypeSpec; name: string; dims: (Expr | null)[] }

export interface FuncDecl extends Pos {
  k: 'func';
  ret: TypeSpec;
  name: string;
  params: Param[];
  body: Stmt & { k: 'block' } | null;
  endLine: number;
}

export interface GlobalDecl extends Pos { k: 'global'; type: TypeSpec; decls: Declarator[] }

export interface Program { items: (FuncDecl | GlobalDecl)[] }
