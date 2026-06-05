import type { ReactNode } from "react";
import { Card } from "./Card";
import { Table } from "./Table";

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
