import type { ReactNode } from "react";
import { Table } from "react-bootstrap";
import { ADMIN_CHART_COLORS } from "../theme";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "start" | "end";
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage?: string;
}

// Shared read-only table for payments / top-users / flagged-accounts — kept
// generic so each admin table is just a column config, not a bespoke
// component. Per the dataviz skill, a table view is always available
// alongside charts rather than being the charts' only fallback.
export default function DataTable<T>({ columns, rows, getRowKey, emptyMessage = "No data yet" }: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-4" style={{ color: ADMIN_CHART_COLORS.ink.muted }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <Table hover size="sm" className="mb-0 align-middle">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.align === "end" ? "text-end" : undefined}
                style={{ color: ADMIN_CHART_COLORS.ink.muted, fontWeight: 500, fontSize: "0.8rem" }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={getRowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} className={col.align === "end" ? "text-end" : undefined}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
