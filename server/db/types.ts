/** The small part of a PostgreSQL driver used by the repository. */
export interface DatabaseResult<Row extends Record<string, unknown>> {
  rows: Row[];
  rowCount: number | null;
}

export interface DatabaseExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<DatabaseResult<Row>>;
}

export interface DatabaseClient extends DatabaseExecutor {
  release(): void;
}

export interface DatabasePool extends DatabaseExecutor {
  connect(): Promise<DatabaseClient>;
}
