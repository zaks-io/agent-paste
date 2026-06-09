import type { ReactNode } from "react";

/**
 * Tokenizes inline marketing prose into real React nodes. Two syntaxes are
 * recognized:
 *
 *   [label](href)  ->  <a className={linkClassName} href={href}>{label}</a>
 *   `code`         ->  <code className="code">{code}</code>
 *
 * Everything else passes through as plain text. Because the output is React
 * nodes (never an HTML string), React escapes all text and attribute values:
 * the result is structurally injection-safe with no dangerouslySetInnerHTML,
 * no raw(), and no hand-rolled HTML escaping.
 */
// The label and href classes exclude their own opening delimiter ([ and (
// respectively), not just the closing one. That makes each alternative
// unambiguous so the engine never backtracks across them — the match is linear,
// not polynomial, even on adversarial input like "[" + "[\\".repeat(n) (a real
// ReDoS in the naive [^\]]+ / [^)]+ form). Behavior on valid prose is identical.
const PROSE_PATTERN = /\[([^\][]+)\]\(([^()]+)\)|`([^`]+)`/g;

export function parseProse(text: string, linkClassName?: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  PROSE_PATTERN.lastIndex = 0;
  for (let match = PROSE_PATTERN.exec(text); match !== null; match = PROSE_PATTERN.exec(text)) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const [, linkLabel, linkHref, code] = match;
    if (code !== undefined) {
      nodes.push(
        <code className="code" key={key}>
          {code}
        </code>,
      );
    } else {
      nodes.push(
        <a className={linkClassName} href={linkHref} key={key}>
          {linkLabel}
        </a>,
      );
    }

    key += 1;
    lastIndex = PROSE_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function Prose({ text, linkClassName }: { text: string; linkClassName?: string }) {
  return <>{parseProse(text, linkClassName)}</>;
}
