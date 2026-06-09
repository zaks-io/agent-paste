import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Prose } from "../src/index";

function render(text: string, linkClassName?: string): string {
  return renderToStaticMarkup(createElement(Prose, { text, linkClassName }));
}

describe("Prose", () => {
  it('wraps backtick spans in <code class="code">', () => {
    expect(render("run `pnpm verify` now")).toBe('run <code class="code">pnpm verify</code> now');
  });

  it("turns [label](href) into an anchor with the supplied className", () => {
    expect(render("see [docs](/docs)", "docs-inline-link")).toBe(
      'see <a class="docs-inline-link" href="/docs">docs</a>',
    );
  });

  it("escapes hostile HTML instead of rendering live tags", () => {
    const html = render("text with <script>alert(1)</script> and `<b>code</b>`");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('<code class="code">&lt;b&gt;code&lt;/b&gt;</code>');
  });

  it("passes plain text through unchanged", () => {
    expect(render("just plain text, no markup")).toBe("just plain text, no markup");
  });

  it("matches the inner [label](href) when brackets nest, not the outer span", () => {
    // The label/href classes exclude their own opening delimiter, so an inner
    // pair wins instead of the regex greedily spanning the whole string.
    expect(render("[outer [inner](/in) tail")).toBe('[outer <a href="/in">inner</a> tail');
  });

  it("does not over-match adversarial bracket runs (the ReDoS-safe shape)", () => {
    // The naive [^\]]+ / [^)]+ form backtracks polynomially on this input; the
    // delimiter-excluding form cannot, because no '[' is ever consumed inside a
    // label. Deterministic guard (no wall-clock assertion): the run has no
    // complete [label](href) pair, so it passes through escaped, unchanged.
    const evil = `[${"[\\".repeat(2000)}`;
    const html = render(evil);
    expect(html).not.toContain("<a ");
    expect(html.replace(/&lt;|&gt;|&amp;|&#x27;|&quot;/g, "")).toContain("[[\\");
  });
});
