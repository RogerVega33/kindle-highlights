// Retry a read if a local mutation made its snapshot obsolete while it was in flight.
export async function readCurrent<T>({ read, isActive, version, commit }: {
  read: () => Promise<T>;
  isActive: () => boolean;
  version: () => number;
  commit: (result: T) => void;
}): Promise<void> {
  while (isActive()) {
    const startedAt = version();
    try {
      const result = await read();
      if (!isActive()) return;
      if (startedAt === version()) {
        commit(result);
        return;
      }
    } catch (error) {
      if (!isActive()) return;
      if (startedAt === version()) throw error;
    }
  }
}
