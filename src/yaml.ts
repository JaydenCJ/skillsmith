/**
 * A small, dependency-free parser for the YAML subset that actually occurs
 * in skill front-matter: block mappings, block and flow sequences, plain and
 * quoted scalars, `|`/`>` block scalars, and comments.
 *
 * Deliberately NOT supported (each rejected with a clear, lined error
 * instead of silently misparsing): anchors/aliases, tags, flow mappings,
 * multi-document streams, and tab indentation. Front-matter that needs any
 * of those is front-matter that some agent runtime will choke on anyway —
 * pushing authors back to the boring subset is a feature.
 */

export interface YamlError {
  /** 1-based line number within the parsed source. */
  line: number;
  message: string;
}

export interface YamlDoc {
  value: unknown;
  /**
   * 1-based source line of every mapping key, addressed by dotted path
   * (`"metadata.owner"`, `"cases[0].name"`), so callers can anchor
   * diagnostics precisely.
   */
  keyLines: Record<string, number>;
  errors: YamlError[];
}

interface Line {
  /** 1-based line number in the original source. */
  no: number;
  /** Count of leading spaces. */
  indent: number;
  /** Line content with the indent stripped. */
  text: string;
  /** Blank or whole-line comment — skipped outside block scalars. */
  insignificant: boolean;
}

const BLOCK_HEADER = /^([|>])([+-]?)\s*(?:#.*)?$/;

class Parser {
  private lines: Line[] = [];
  private pos = 0;
  readonly errors: YamlError[] = [];
  readonly keyLines: Record<string, number> = {};

  constructor(source: string) {
    const raw = source.split(/\r?\n/);
    for (let i = 0; i < raw.length; i++) {
      const full = raw[i] as string;
      const lead = /^[ \t]*/.exec(full)![0];
      if (lead.includes("\t")) {
        this.errors.push({ line: i + 1, message: "tab used for indentation; YAML requires spaces" });
      }
      const trimmed = full.trim();
      this.lines.push({
        no: i + 1,
        indent: lead.length,
        text: full.slice(lead.length),
        insignificant: trimmed === "" || trimmed.startsWith("#"),
      });
    }
  }

  parse(): unknown {
    const value = this.parseNode(0, "");
    const extra = this.peek();
    if (extra !== undefined) {
      this.errors.push({ line: extra.no, message: `unexpected content at indent ${extra.indent}` });
    }
    return value;
  }

  /** Next significant line, without consuming it. */
  private peek(): Line | undefined {
    while (this.pos < this.lines.length && (this.lines[this.pos] as Line).insignificant) this.pos++;
    return this.lines[this.pos];
  }

  private advance(): void {
    this.pos++;
  }

  private static isDashItem(line: Line): boolean {
    return line.text === "-" || line.text.startsWith("- ");
  }

  private parseNode(minIndent: number, path: string): unknown {
    const line = this.peek();
    if (line === undefined || line.indent < minIndent) return null;
    if (Parser.isDashItem(line)) return this.parseSequence(line.indent, path);
    return this.parseMapping(line.indent, path);
  }

  private parseMapping(indent: number, path: string): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (;;) {
      const line = this.peek();
      if (line === undefined || line.indent < indent) break;
      if (line.indent > indent) {
        this.errors.push({ line: line.no, message: `unexpected indent (expected ${indent} spaces)` });
        this.advance();
        continue;
      }
      if (Parser.isDashItem(line)) break;
      const entry = splitKey(line.text);
      if (entry === null) {
        this.errors.push({ line: line.no, message: `expected "key: value", got "${line.text}"` });
        this.advance();
        continue;
      }
      const keyPath = path === "" ? entry.key : `${path}.${entry.key}`;
      if (Object.prototype.hasOwnProperty.call(obj, entry.key)) {
        this.errors.push({ line: line.no, message: `duplicate key "${entry.key}"` });
      }
      this.keyLines[keyPath] = line.no;
      this.advance();
      obj[entry.key] = this.parseValue(entry.rest, line, indent, keyPath);
    }
    return obj;
  }

  private parseSequence(indent: number, path: string): unknown[] {
    const arr: unknown[] = [];
    for (;;) {
      const line = this.peek();
      if (line === undefined || line.indent !== indent || !Parser.isDashItem(line)) break;
      this.advance();
      const rest = line.text === "-" ? "" : line.text.slice(2).trim();
      const itemPath = `${path}[${arr.length}]`;
      if (rest === "") {
        arr.push(this.parseNode(indent + 1, itemPath));
        continue;
      }
      if (splitKey(rest) !== null) {
        // `- key: value` — the item is a mapping whose first entry sits on
        // the dash line. Re-inject the remainder as a synthetic line at the
        // item's body indent and parse a normal block mapping.
        const next = this.lines[this.pos];
        const bodyIndent =
          next !== undefined && !next.insignificant && next.indent > indent && !Parser.isDashItem(next)
            ? next.indent
            : indent + 2;
        this.lines.splice(this.pos, 0, {
          no: line.no,
          indent: bodyIndent,
          text: rest,
          insignificant: false,
        });
        arr.push(this.parseMapping(bodyIndent, itemPath));
        continue;
      }
      arr.push(this.parseInline(rest, line.no));
    }
    return arr;
  }

  private parseValue(rest: string, line: Line, indent: number, path: string): unknown {
    if (rest === "") {
      // Value is a nested block. A child mapping must be indented deeper;
      // a child sequence may sit at the parent key's own indent.
      const next = this.peek();
      if (next !== undefined && next.indent === indent && Parser.isDashItem(next)) {
        return this.parseSequence(indent, path);
      }
      return this.parseNode(indent + 1, path);
    }
    const block = BLOCK_HEADER.exec(rest);
    if (block !== null) {
      return this.parseBlockScalar(indent, block[1] as "|" | ">", block[2] ?? "");
    }
    return this.parseInline(rest, line.no);
  }

  /** Literal (`|`) and folded (`>`) block scalars with `-`/`+` chomping. */
  private parseBlockScalar(parentIndent: number, style: "|" | ">", chomp: string): string {
    const collected: { text: string; blank: boolean }[] = [];
    let contentIndent = -1;
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos] as Line;
      const blank = line.text.trim() === "";
      if (!blank) {
        if (line.indent <= parentIndent) break;
        if (contentIndent === -1) contentIndent = line.indent;
      }
      const keep = blank ? "" : " ".repeat(Math.max(0, line.indent - contentIndent)) + line.text;
      collected.push({ text: keep, blank });
      this.pos++;
    }
    while (collected.length > 0 && (collected[collected.length - 1] as { blank: boolean }).blank) {
      collected.pop();
    }
    let body: string;
    if (style === "|") {
      body = collected.map((l) => l.text).join("\n");
    } else {
      // Folded: single newlines become spaces, blank lines become newlines.
      body = "";
      let pendingBlank = 0;
      for (const l of collected) {
        if (l.blank) {
          pendingBlank++;
          continue;
        }
        if (body === "") body = l.text;
        else body += pendingBlank > 0 ? "\n".repeat(pendingBlank) + l.text : ` ${l.text}`;
        pendingBlank = 0;
      }
    }
    if (chomp === "-") return body;
    return body === "" ? "" : `${body}\n`;
  }

  /** Flow sequences, quoted scalars, and plain scalars on a single line. */
  private parseInline(text: string, lineNo: number): unknown {
    const t = text.trim();
    if (t.startsWith("[")) return this.parseFlowSequence(t, lineNo);
    if (t.startsWith("{")) {
      this.errors.push({ line: lineNo, message: "flow mappings ({...}) are not supported; use block style" });
      return {};
    }
    if (t.startsWith("&") || t.startsWith("*")) {
      this.errors.push({ line: lineNo, message: "anchors and aliases are not supported" });
      return t;
    }
    if (t.startsWith("!")) {
      this.errors.push({ line: lineNo, message: "tags are not supported" });
      return t;
    }
    if (t.startsWith('"') || t.startsWith("'")) {
      const quoted = readQuoted(t, 0);
      if (quoted === null) {
        this.errors.push({ line: lineNo, message: "unterminated quoted scalar" });
        return t;
      }
      const tail = t.slice(quoted.end).trim();
      if (tail !== "" && !tail.startsWith("#")) {
        this.errors.push({ line: lineNo, message: `unexpected content after quoted scalar: "${tail}"` });
      }
      return quoted.value;
    }
    return typePlain(stripPlainComment(t));
  }

  private parseFlowSequence(text: string, lineNo: number): unknown[] {
    const inner = text.trim();
    const close = findFlowClose(inner);
    if (close === -1) {
      this.errors.push({ line: lineNo, message: "unterminated flow sequence ([...])" });
      return [];
    }
    const tail = inner.slice(close + 1).trim();
    if (tail !== "" && !tail.startsWith("#")) {
      this.errors.push({ line: lineNo, message: `unexpected content after flow sequence: "${tail}"` });
    }
    const body = inner.slice(1, close).trim();
    if (body === "") return [];
    return splitFlowItems(body).map((item) => this.parseInline(item, lineNo));
  }
}

/** Split `key: rest` at the first unquoted `: ` (or trailing `:`). */
function splitKey(text: string): { key: string; rest: string } | null {
  let key: string;
  let after: string;
  if (text.startsWith('"') || text.startsWith("'")) {
    const quoted = readQuoted(text, 0);
    if (quoted === null) return null;
    key = quoted.value;
    after = text.slice(quoted.end).trimStart();
    if (!after.startsWith(":")) return null;
    after = after.slice(1);
  } else {
    let idx = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== ":") continue;
      const next = text[i + 1];
      if (next === undefined || next === " ") {
        idx = i;
        break;
      }
    }
    if (idx === -1) return null;
    key = text.slice(0, idx).trim();
    after = text.slice(idx + 1);
    if (key === "" || key.includes("#")) return null;
  }
  return { key, rest: after.trim() };
}

/** Read a quoted scalar starting at `start`; returns value and end offset. */
function readQuoted(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start];
  if (quote !== '"' && quote !== "'") return null;
  let value = "";
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote === "'" && ch === "'") {
      if (text[i + 1] === "'") {
        value += "'";
        i++;
        continue;
      }
      return { value, end: i + 1 };
    }
    if (quote === '"' && ch === "\\") {
      const esc = text[i + 1];
      const map: Record<string, string> = { n: "\n", t: "\t", '"': '"', "\\": "\\", "0": "\0" };
      value += map[esc ?? ""] ?? esc ?? "";
      i++;
      continue;
    }
    if (quote === '"' && ch === '"') return { value, end: i + 1 };
    value += ch;
  }
  return null;
}

/** In a plain scalar, ` #` (space before hash) begins a comment. */
function stripPlainComment(text: string): string {
  for (let i = 1; i < text.length; i++) {
    if (text[i] === "#" && text[i - 1] === " ") return text.slice(0, i).trim();
  }
  return text.trim();
}

/** Offset of the `]` closing the flow sequence opened at position 0. */
function findFlowClose(text: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote !== null) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split flow-sequence body on top-level commas, respecting quotes/brackets. */
function splitFlowItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (quote !== null) {
      current += ch;
      if (ch === "\\" && quote === '"') {
        current += body[i + 1] ?? "";
        i++;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "[") {
      depth++;
      current += ch;
    } else if (ch === "]") {
      depth--;
      current += ch;
    } else if (ch === "," && depth === 0) {
      items.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim() !== "") items.push(current.trim());
  return items;
}

/** Type a plain scalar per the YAML 1.2 core-ish rules we care about. */
function typePlain(text: string): unknown {
  if (text === "" || text === "~" || text === "null" || text === "Null" || text === "NULL") return null;
  if (text === "true" || text === "True" || text === "TRUE") return true;
  if (text === "false" || text === "False" || text === "FALSE") return false;
  if (/^[+-]?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(text) && /[.eE]/.test(text)) {
    return Number.parseFloat(text);
  }
  return text;
}

/** Parse a YAML document (the front-matter subset described above). */
export function parseYaml(source: string): YamlDoc {
  const parser = new Parser(source);
  const value = parser.parse();
  return { value, keyLines: parser.keyLines, errors: parser.errors };
}
