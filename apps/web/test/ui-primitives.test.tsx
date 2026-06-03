import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../src/components/ui/Badge";
import { Button } from "../src/components/ui/Button";
import { Card, CardHeader, SectionLabel } from "../src/components/ui/Card";
import { EmptyState } from "../src/components/ui/EmptyState";
import { PageHeader } from "../src/components/ui/PageHeader";
import { StatBand } from "../src/components/ui/StatBand";

describe("Badge", () => {
  it("renders a status dot when requested", () => {
    const { container } = render(
      <Badge tone="success" dot>
        Live
      </Badge>,
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });

  it("renders without a dot by default", () => {
    const { container } = render(<Badge>Plain</Badge>);
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});

describe("Card", () => {
  it("uses the accent hairline when elevated", () => {
    const { container } = render(<Card elevated>body</Card>);
    expect(container.firstElementChild?.className).toContain("border-[hsl(var(--accent)/0.35)]");
  });

  it("drops padding when flush", () => {
    const { container } = render(<Card flush>body</Card>);
    expect(container.firstElementChild?.className).toContain("p-0");
  });

  it("renders a card header with subtitle and actions", () => {
    render(<CardHeader title="Title" subtitle="Sub" actions={<span>act</span>} />);
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Sub")).toBeInTheDocument();
    expect(screen.getByText("act")).toBeInTheDocument();
  });

  it("renders a section label", () => {
    render(<SectionLabel>Recent</SectionLabel>);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });
});

describe("PageHeader", () => {
  it("renders eyebrow, meta, and actions when supplied", () => {
    render(
      <PageHeader
        eyebrow="The record"
        title="Artifacts"
        description="desc"
        meta={<span>12 total</span>}
        actions={<button type="button">do</button>}
      />,
    );
    expect(screen.getByText("The record")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Artifacts" })).toBeInTheDocument();
    expect(screen.getByText("desc")).toBeInTheDocument();
    expect(screen.getByText("12 total")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "do" })).toBeInTheDocument();
  });

  it("renders only the title when nothing else is supplied", () => {
    render(<PageHeader title="Bare" />);
    expect(screen.getByRole("heading", { name: "Bare" })).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders an icon, body, and code block when provided", () => {
    render(<EmptyState title="Empty" body="nothing" code="run me" icon={<span>icon</span>} />);
    expect(screen.getByText("Empty")).toBeInTheDocument();
    expect(screen.getByText("nothing")).toBeInTheDocument();
    expect(screen.getByText("run me")).toBeInTheDocument();
    expect(screen.getByText("icon")).toBeInTheDocument();
  });

  it("renders bare title only", () => {
    render(<EmptyState title="Just title" />);
    expect(screen.getByText("Just title")).toBeInTheDocument();
  });
});

describe("StatBand", () => {
  it("renders accented values and hints", () => {
    const { container } = render(
      <StatBand
        stats={[
          { label: "Artifacts", value: "12" },
          { label: "Live", value: "3", accent: true, hint: "now" },
        ]}
      />,
    );
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
    expect(screen.getByText("now")).toBeInTheDocument();
    expect(container.innerHTML).toContain("text-[hsl(var(--accent))]");
  });
});

describe("Button", () => {
  it("shows a spinner and disables when loading", () => {
    render(
      <Button variant="accent" loading>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading")).toBeInTheDocument();
  });

  it("renders a link variant without size classes", () => {
    render(<Button variant="link">More</Button>);
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});
