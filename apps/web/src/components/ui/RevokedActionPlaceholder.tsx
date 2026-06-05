type Props = {
  /** Placeholder shown when a row is revoked and has no actions. */
  placeholder?: string;
};

export function RevokedActionPlaceholder({ placeholder = "—" }: Props) {
  return <span className="text-[hsl(var(--subtle))]">{placeholder}</span>;
}
