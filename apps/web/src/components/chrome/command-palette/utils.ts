import type { CommandGroup, CommandGroupSection, CommandItem } from "./types";

export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesQuery(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const haystack = [item.label, ...item.keywords].map(normalize).join(" ");
  return haystack.includes(query);
}

export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const normalized = normalize(query);
  return items.filter((item) => matchesQuery(item, normalized));
}

const GROUP_LABELS: Record<CommandGroup, string> = {
  navigation: "Navigation",
  actions: "Actions",
};

export function groupCommandItems(items: CommandItem[]): CommandGroupSection[] {
  const groups: CommandGroupSection[] = [
    { group: "navigation", label: GROUP_LABELS.navigation, items: [] },
    { group: "actions", label: GROUP_LABELS.actions, items: [] },
  ];
  for (const item of items) {
    const bucket = groups.find((entry) => entry.group === item.group);
    bucket?.items.push(item);
  }
  return groups.filter((entry) => entry.items.length > 0);
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export function signOut(): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/api/auth/sign-out";
  document.body.appendChild(form);
  form.submit();
}
