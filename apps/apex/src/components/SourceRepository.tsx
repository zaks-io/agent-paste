import { OPERATING_COMPANY } from "@agent-paste/brand";
import { SOURCE_REPOSITORY } from "../copy";
import { INLINE_LINK_CLASS, ProseBlock, SectionHeading } from "./marketing";

// Public repo callout for the About and How-it-works pages. Rendered as a prose
// block so it sits flush with the surrounding section copy.
export function SourceRepository() {
  return (
    <ProseBlock>
      <SectionHeading>Source</SectionHeading>
      <p className="mt-4 text-h3 leading-loose text-muted">
        agent-paste is owned and operated by{" "}
        <a className={INLINE_LINK_CLASS} href={OPERATING_COMPANY.href}>
          {OPERATING_COMPANY.name}
        </a>
        . The repo is{" "}
        <a className={INLINE_LINK_CLASS} href={SOURCE_REPOSITORY.href}>
          {SOURCE_REPOSITORY.slug}
        </a>{" "}
        for anyone curious.
      </p>
    </ProseBlock>
  );
}
