import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { useTheme } from "../../theme-provider";
import { buildActionCommandItems } from "./command-items-actions";
import { buildNavigationCommandItems } from "./command-items-navigation";
import type { CommandItem } from "./types";

export function useCommandItems(isOperator: boolean, close: () => void): CommandItem[] {
  const router = useRouter();
  const { setPreference } = useTheme();

  const navigate = useCallback(
    (to: string) => {
      close();
      void router.navigate({ to });
    },
    [close, router],
  );

  return useMemo(
    () => [...buildNavigationCommandItems(navigate, isOperator), ...buildActionCommandItems(setPreference, close)],
    [close, isOperator, navigate, setPreference],
  );
}
