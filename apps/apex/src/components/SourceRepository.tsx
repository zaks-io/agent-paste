import { SOURCE_REPOSITORY } from "../copy";

// Public repo callout for the About and How-it-works pages. Rendered as a prose
// block so it sits flush with the surrounding section copy.
export function SourceRepository() {
  return (
    <article className="prose-block">
      <h2 className="prose-title">Source</h2>
      <p className="prose-body">
        The repo is{" "}
        <a className="docs-inline-link" href={SOURCE_REPOSITORY.href}>
          {SOURCE_REPOSITORY.slug}
        </a>{" "}
        for anyone curious.
      </p>
    </article>
  );
}
