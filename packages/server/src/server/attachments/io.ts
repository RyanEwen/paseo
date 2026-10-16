/** Preserve both failures at attachment I/O resource boundaries, in operation order. */
export async function withAttachmentResource<T>(
  operation: () => Promise<T>,
  close: () => Promise<void>,
): Promise<T> {
  let result: { value: T } | { failure: unknown };
  try {
    result = { value: await operation() };
  } catch (failure) {
    result = { failure };
  }
  let cleanup: { failure: unknown } | undefined;
  try {
    await close();
  } catch (failure) {
    cleanup = { failure };
  }
  if (cleanup) {
    if ("failure" in result)
      throw new AggregateError(
        [result.failure, cleanup.failure],
        "Attachment operation and resource close failed.",
        { cause: result.failure },
      );
    throw cleanup.failure;
  }
  if ("failure" in result) throw result.failure;
  return result.value;
}
