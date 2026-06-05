import { RelativeTime } from "./RelativeTime";

type Props = {
  value?: string | null;
  fallback?: string;
};

export function OptionalRelativeTime({ value, fallback = "never" }: Props) {
  return value ? <RelativeTime value={value} /> : fallback;
}
