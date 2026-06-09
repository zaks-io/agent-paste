import { Card, Table } from "@agent-paste/ui";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function DataTable({ children }: Props) {
  return (
    <Card flush className="overflow-hidden">
      <Table>{children}</Table>
    </Card>
  );
}
