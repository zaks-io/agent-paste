import type { FC } from "hono/jsx";
import { SOURCE_REPOSITORY } from "../copy.js";

export const SourceRepositoryBlock: FC = () => (
  <article class="prose-block">
    <h2 class="prose-title">Source</h2>
    <p class="prose-body">
      The repo is{" "}
      <a class="docs-inline-link" href={SOURCE_REPOSITORY.href}>
        {SOURCE_REPOSITORY.slug}
      </a>{" "}
      for anyone curious.
    </p>
  </article>
);
