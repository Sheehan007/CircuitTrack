/*
  Monaco set-up for Arduino sketches, loaded lazily the first time the Code tab opens.

  Completions and hovers come from the same tables the compiler checks calls against (sim/firmware/runtime.ts), so
  the editor only ever suggests what ESP32 Lab can actually run.
*/
import * as monaco from './monacoEntry';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { CLASSES, CONSTANTS, FUNCTIONS, GLOBAL_OBJECTS, STATICS, STRING_METHODS, type NativeSpec } from '../../sim/firmware/runtime';
import type { Diagnostic } from '../../sim/firmware/diagnostics';

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };

const HIDDEN_CLASSES = ['HardwareSerial', 'TwoWire', 'EspClass'];
const TYPES = ['void', 'bool', 'boolean', 'char', 'byte', 'int', 'long', 'short', 'unsigned', 'float', 'double', 'size_t', 'String', 'word',
  'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'int32_t', 'uint32_t', 'int64_t', 'uint64_t', 'const', 'static', 'volatile'];
const KEYWORDS = ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'true', 'false', 'sizeof'];

/** "pinMode(pin, INPUT | OUTPUT)" → a snippet with one tab stop per parameter. */
function snippet(name: string, doc: string) {
  const m = doc.match(/^[\w:.]+\(([^)]*)\)/);
  if (!m || !m[1].trim()) return `${name}()`;
  const params = m[1].split(',').map((p) => p.trim().replace(/[[\]]/g, '')).filter(Boolean);
  return `${name}(${params.map((p, i) => `\${${i + 1}:${p.replace(/[}$\\]/g, '')}}`).join(', ')})`;
}

/** Type of `name` in the sketch, from its declaration (good enough for completion after "name."). */
function typeOfVar(text: string, name: string): string | null {
  if (GLOBAL_OBJECTS[name]) return GLOBAL_OBJECTS[name].cls;
  const re = new RegExp(`\\b(${[...Object.keys(CLASSES), 'String'].join('|')})\\s+${name}\\b`);
  return text.match(re)?.[1] ?? null;
}

let ready = false;
export function setupArduino() {
  if (ready) return;
  ready = true;

  monaco.editor.defineTheme('esp32-ink', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'f4b829' },
      { token: 'keyword.directive', foreground: 'f4b829' },
      { token: 'string', foreground: '9fd38b' },
      { token: 'string.escape', foreground: 'c3e6b4' },
      { token: 'number', foreground: '8ec5ff' },
      { token: 'number.hex', foreground: '8ec5ff' },
      { token: 'number.float', foreground: '8ec5ff' },
      { token: 'comment', foreground: '8a8476', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'e8e4da' },
      { token: 'delimiter', foreground: 'b9b2a3' },
      { token: 'annotation', foreground: 'f29e7a' },
    ],
    colors: {
      'editor.background': '#1f2228',
      'editor.foreground': '#e8e4da',
      'editorLineNumber.foreground': '#6d675c',
      'editorLineNumber.activeForeground': '#e8e4da',
      'editor.lineHighlightBackground': '#272b33',
      'editor.selectionBackground': '#3b4252',
      'editorCursor.foreground': '#f4b829',
      'editorError.foreground': '#ff7a6b',
      'editorWarning.foreground': '#f0b04a',
      'editorGutter.background': '#1f2228',
    },
  });

  const kinds = monaco.languages.CompletionItemKind;
  monaco.languages.registerCompletionItemProvider('cpp', {
    triggerCharacters: ['.', ':'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const before = model.getLineContent(position.lineNumber).slice(0, word.startColumn - 1);
      const member = before.match(/(\w+)\s*\.\s*$/);
      const method = (name: string, spec: NativeSpec) => ({
        label: name, kind: kinds.Method, detail: spec.doc, range,
        insertText: snippet(name, spec.doc), insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        documentation: spec.doc,
      });
      if (member) {
        const cls = typeOfVar(model.getValue(), member[1]);
        if (cls === 'String') return { suggestions: Object.entries(STRING_METHODS).map(([k, v]) => method(k, v)) };
        if (cls && CLASSES[cls]) return { suggestions: Object.entries(CLASSES[cls].methods).map(([k, v]) => method(k, v)) };
        return { suggestions: [] };
      }
      if (/::\s*$/.test(before)) {
        return { suggestions: Object.entries(STATICS).map(([k, v]) => method(k.split('::')[1], v)) };
      }
      const suggestions: monaco.languages.CompletionItem[] = [];
      for (const [k, v] of Object.entries(FUNCTIONS)) {
        suggestions.push({ label: k, kind: kinds.Function, detail: v.doc, range, insertText: snippet(k, v.doc), insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet });
      }
      for (const [k, v] of Object.entries(CONSTANTS)) suggestions.push({ label: k, kind: kinds.Constant, detail: `${Number.isInteger(v.value) && v.value > 9 ? `0x${v.value.toString(16).toUpperCase()}` : v.value}`, range, insertText: k });
      for (const [k, v] of Object.entries(CLASSES)) if (!HIDDEN_CLASSES.includes(k)) suggestions.push({ label: k, kind: kinds.Class, detail: `${v.ctor.doc}  (#include <${v.header}>)`, range, insertText: k });
      for (const [k, v] of Object.entries(GLOBAL_OBJECTS)) suggestions.push({ label: k, kind: kinds.Variable, detail: v.cls, range, insertText: k });
      for (const t of TYPES) suggestions.push({ label: t, kind: kinds.Keyword, range, insertText: t });
      for (const t of KEYWORDS) suggestions.push({ label: t, kind: kinds.Keyword, range, insertText: t });
      suggestions.push(
        { label: 'setup/loop', kind: kinds.Snippet, detail: 'sketch skeleton', range, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, insertText: 'void setup() {\n\tSerial.begin(115200);\n\t$0\n}\n\nvoid loop() {\n\t\n}\n' },
        { label: 'for', kind: kinds.Snippet, detail: 'for loop', range, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:count}; ${1:i}++) {\n\t$0\n}' },
        { label: '#include', kind: kinds.Snippet, detail: 'supported libraries', range, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, insertText: '#include <${1|Wire.h,ESP32Servo.h,Adafruit_SSD1306.h,Adafruit_GFX.h,Adafruit_BME280.h,Adafruit_ST7735.h,DHT.h,SPI.h|}>' },
      );
      // the sketch's own variables and functions
      const seen = new Set(suggestions.map((s) => s.label as string));
      for (const m of model.getValue().matchAll(/\b(?:int|long|float|double|bool|byte|char|String|unsigned|uint\d+_t|int\d+_t|void|const|\w+)\s+(\w+)\s*[=;(,[)]/g)) {
        if (!seen.has(m[1]) && !TYPES.includes(m[1]) && !KEYWORDS.includes(m[1])) { seen.add(m[1]); suggestions.push({ label: m[1], kind: kinds.Variable, range, insertText: m[1] }); }
      }
      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider('cpp', {
    provideHover(model, position) {
      const w = model.getWordAtPosition(position);
      if (!w) return null;
      const name = w.word;
      const line = model.getLineContent(position.lineNumber);
      const member = line.slice(0, w.startColumn - 1).match(/(\w+)\s*\.\s*$/);
      let text: string | null = null;
      if (member) {
        const cls = typeOfVar(model.getValue(), member[1]);
        const spec = cls === 'String' ? STRING_METHODS[name] : cls ? CLASSES[cls]?.methods[name] : undefined;
        if (spec) text = `**${cls === 'String' ? 'String' : cls}.${spec.doc}**`;
      } else if (FUNCTIONS[name]) text = `**${FUNCTIONS[name].doc}**`;
      else if (CONSTANTS[name]) text = `**${name}** = ${CONSTANTS[name].value}`;
      else if (CLASSES[name] && !HIDDEN_CLASSES.includes(name)) text = `**${name}** — \`${CLASSES[name].ctor.doc}\`  \nneeds \`#include <${CLASSES[name].header}>\``;
      else if (GLOBAL_OBJECTS[name]) text = `**${name}** (${GLOBAL_OBJECTS[name].cls}): ${Object.keys(CLASSES[GLOBAL_OBJECTS[name].cls].methods).join(', ')}`;
      if (!text) return null;
      return { range: new monaco.Range(position.lineNumber, w.startColumn, position.lineNumber, w.endColumn), contents: [{ value: text }, { value: '_Supported in ESP32 Lab_' }] };
    },
  });
}

export function setMarkers(model: monaco.editor.ITextModel, diags: Diagnostic[]) {
  const sev = { error: monaco.MarkerSeverity.Error, warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
  monaco.editor.setModelMarkers(model, 'esp32lab', diags.map((d) => {
    const line = Math.max(1, Math.min(model.getLineCount(), d.line));
    const text = model.getLineContent(line);
    const col = Math.max(1, Math.min(text.length + 1, d.col || 1));
    // underline the word at the reported column (or the whole line when the column is at its start)
    const word = model.getWordAtPosition({ lineNumber: line, column: col });
    const start = word ? word.startColumn : col, end = word ? word.endColumn : Math.max(col + 1, text.length + 1);
    return { severity: sev[d.severity], message: d.message, startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end, source: 'ESP32 Lab' };
  }));
}
