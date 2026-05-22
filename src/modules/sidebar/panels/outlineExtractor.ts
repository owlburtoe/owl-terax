import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { go } from "@codemirror/lang-go";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";

export type OutlineNode = {
  label: string;
  kind: "function" | "class" | "variable" | "heading" | "other";
  line: number;
  depth: number;
};

const EXT_TO_GRAMMAR: Record<string, () => import("@codemirror/state").Extension> = {
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  py: () => python(),
  rs: () => rust(),
  go: () => go(),
  md: () => markdown(),
  mdx: () => markdown(),
};

function grammarFor(ext: string): (() => import("@codemirror/state").Extension) | null {
  return EXT_TO_GRAMMAR[ext.toLowerCase()] ?? null;
}

const PYTHON_FUNCTION_TYPES = new Set(["FunctionDefinition"]);
const PYTHON_CLASS_TYPES = new Set(["ClassDefinition"]);
const RUST_FUNCTION_TYPES = new Set(["FunctionItem"]);
const RUST_TYPE_TYPES = new Set(["StructItem", "EnumItem", "ImplItem"]);
const GO_FUNCTION_TYPES = new Set(["FunctionDecl", "MethodDecl"]);
const GO_TYPE_TYPES = new Set(["TypeDecl"]);

// Nodes that represent callable bodies — used for depth tracking in JS/TS.
const JS_FUNC_DEPTH_NODES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunction",
]);

function lineAt(state: EditorState, pos: number): number {
  return state.doc.lineAt(pos).number;
}

type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>["cursor"]>["node"];

function nameFromNode(state: EditorState, node: SyntaxNode): string | null {
  const nameNode =
    node.getChild("VariableDefinition") ??
    node.getChild("TypeDefinition") ??
    node.getChild("PropertyDefinition");
  if (nameNode) return state.doc.sliceString(nameNode.from, nameNode.to);
  const ident = node.getChild("Identifier");
  if (ident) return state.doc.sliceString(ident.from, ident.to);
  return null;
}

function extractJsOutline(state: EditorState, parsed: ReturnType<typeof syntaxTree>): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  // funcDepth: how many function-like bodies we're currently inside.
  // depth 0 = file scope, depth 1 = inside a component/function, depth 2+ = nested callback
  let funcDepth = 0;

  parsed.cursor().iterate(
    (node) => {
      // Don't descend into deeply nested function bodies (callbacks inside hooks, etc.)
      if (funcDepth >= 2) return false;

      if (JS_FUNC_DEPTH_NODES.has(node.name)) {
        // Collect named function declarations at any visible depth.
        const nameNode = node.node.getChild("VariableDefinition");
        if (nameNode) {
          nodes.push({
            label: state.doc.sliceString(nameNode.from, nameNode.to),
            kind: "function",
            line: lineAt(state, node.from),
            depth: funcDepth,
          });
        }
        funcDepth++;
        return; // continue descending into this function body
      }

      if (node.name === "ClassDeclaration" || node.name === "ClassExpression") {
        const nameNode = node.node.getChild("VariableDefinition");
        if (nameNode) {
          nodes.push({
            label: state.doc.sliceString(nameNode.from, nameNode.to),
            kind: "class",
            line: lineAt(state, node.from),
            depth: funcDepth,
          });
        }
      }

      // TypeScript type/interface declarations
      if (node.name === "TypeAliasDeclaration" || node.name === "InterfaceDeclaration") {
        const nameNode = node.node.getChild("TypeDefinition") ?? node.node.getChild("Identifier");
        if (nameNode) {
          nodes.push({
            label: state.doc.sliceString(nameNode.from, nameNode.to),
            kind: "class",
            line: lineAt(state, node.from),
            depth: funcDepth,
          });
        }
      }

      // Lezer JS grammar: VariableDeclaration has VariableDefinition as a direct
      // child (no VariableDeclarator wrapper). Covers const/let/var.
      if (node.name === "VariableDeclaration") {
        const nameNode = node.node.getChild("VariableDefinition");
        if (!nameNode) return; // destructuring pattern — skip

        const label = state.doc.sliceString(nameNode.from, nameNode.to);

        if (funcDepth === 0) {
          // File scope: only show arrow/function expression declarations
          // (i.e. `const Foo = () => {}`, not `const MAX = 100`)
          let child = node.node.firstChild;
          while (child) {
            if (child.name === "ArrowFunction" || child.name === "FunctionExpression") {
              nodes.push({ label, kind: "function", line: lineAt(state, node.from), depth: 0 });
              break;
            }
            child = child.nextSibling;
          }
        } else if (funcDepth === 1) {
          // Inside a component/function body: show all named declarations.
          // This captures useCallback, useMemo, useState, useRef, plain consts, etc.
          nodes.push({ label, kind: "variable", line: lineAt(state, node.from), depth: 1 });
        }
      }
    },
    (node) => {
      if (JS_FUNC_DEPTH_NODES.has(node.name)) funcDepth--;
    },
  );

  return nodes;
}

export function extractOutline(source: string, ext: string): OutlineNode[] {
  const grammar = grammarFor(ext);
  if (!grammar) return [];

  const state = EditorState.create({ doc: source, extensions: [grammar()] });
  // ensureSyntaxTree forces a full parse — Lezer is lazy on fresh EditorStates.
  const parsed = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
  const nodes: OutlineNode[] = [];

  const isMarkdown = ext === "md" || ext === "mdx";
  const isJS = ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx";

  if (isMarkdown) {
    parsed.cursor().iterate((node) => {
      if (!node.name.startsWith("ATXHeading")) return;
      const level = parseInt(node.name.replace("ATXHeading", ""), 10);
      if (!Number.isFinite(level)) return;
      const markEnd = node.node.firstChild?.to ?? node.from;
      const text = state.doc.sliceString(markEnd, node.to).trim();
      nodes.push({ label: text, kind: "heading", line: lineAt(state, node.from), depth: level });
    });
    return nodes;
  }

  if (isJS) {
    return extractJsOutline(state, parsed);
  }

  parsed.cursor().iterate((node) => {
    if (ext === "py") {
      if (PYTHON_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (PYTHON_CLASS_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (ext === "rs") {
      if (RUST_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (RUST_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    } else if (ext === "go") {
      if (GO_FUNCTION_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "function", line: lineAt(state, node.from), depth: 0 });
      } else if (GO_TYPE_TYPES.has(node.name)) {
        const name = nameFromNode(state, node.node);
        if (name) nodes.push({ label: name, kind: "class", line: lineAt(state, node.from), depth: 0 });
      }
    }
  });

  return nodes;
}
