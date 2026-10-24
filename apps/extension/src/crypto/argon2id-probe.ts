import { argon2id } from "hash-wasm";

let running = false;

export async function runSitewardKdfProbe(): Promise<void> {
  if (running) {
    throw new Error("The Argon2id probe is already running.");
  }

  running = true;

  try {
    // first we verify a known answer inside Chrome
    const vector = await argon2id({
      password: "text demo",
      salt: "123456789",
      parallelism: 2,
      iterations: 1,
      memorySize: 64,
      hashLength: 32,
      outputType: "hex",
    });

    const expected =
      "b3f9d902f65bd329cf0810c78b19c746b6f46fbb8243647a8942ab83b6850d47";

    if (vector !== expected) {
      throw new Error("Argon2id browser test vector failed.");
    }

    console.info("Argon2id browser test vector passed.");

    // then we measure out candidate configuration
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const timings: Array<{ run: number; milliseconds: number }> = [];

    for (let run = 1; run <= 3; run++) {
      const started = performance.now();

      const result = await argon2id({
        password: "Siteward benchmark password — dummy input",
        salt,
        parallelism: 4,
        iterations: 3,
        memorySize: 64 * 1024,
        hashLength: 32,
        outputType: "binary",
      });

      const milliseconds = performance.now() - started;

      if (result.byteLength !== 32) {
        throw new Error("Unexpected Argon2id output length.");
      }

      result.fill(0);

      timings.push({
        run,
        milliseconds: Math.round(milliseconds),
      });
    }

    console.table(timings);
  } finally {
    running = false;
  }
}
