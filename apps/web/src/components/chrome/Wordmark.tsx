export function Wordmark({ tone = "accent" }: { tone?: "solid" | "accent" }) {
  return (
    <span className="font-semibold text-[15px]" style={{ letterSpacing: "-0.02em", color: "hsl(var(--foreground))" }}>
      agent
      <span style={{ color: tone === "accent" ? "hsl(var(--accent))" : "inherit" }}>-</span>
      paste
    </span>
  );
}
