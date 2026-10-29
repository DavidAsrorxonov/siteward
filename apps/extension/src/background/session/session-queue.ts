export function createSessionQueue() {
  let tail: Promise<void> = Promise.resolve();

  return function run<SitewardOps>(
    operation: () => SitewardOps | Promise<SitewardOps>,
  ): Promise<SitewardOps> {
    const result = tail.then(operation);

    tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  };
}
