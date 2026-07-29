// Shared hard cap for admin CSV exports. Refusing with 413 is better than
// silently truncating — a partial file looks complete to the operator.
export const MAX_EXPORT_ROWS = 10_000;

export class ExportTooLargeError extends Error {
  constructor(public readonly total: number) {
    super(`Export would contain ${total} rows, above the ${MAX_EXPORT_ROWS} row limit`);
    this.name = "ExportTooLargeError";
  }
}
