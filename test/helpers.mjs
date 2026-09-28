// Shared bits for the tests.
import { chromium } from "playwright";

export const root = new URL("..", import.meta.url).pathname;

// Headless Chromium draws WebGL in software with these flags.
export const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

export function launch() {
  return chromium.launch({ args: GL_ARGS });
}

// Collects failures and prints a ✓/✗ line per check.
export function checker(name) {
  let failed = 0;
  console.log(`\n${name}`);
  return {
    check(label, ok, detail) {
      console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && detail !== undefined ? `  (${JSON.stringify(detail)})` : ""}`);
      if (!ok) failed++;
    },
    done() {
      if (failed) {
        console.log(`  ${failed} check(s) failed`);
        process.exitCode = 1;
      }
    },
  };
}

// Waits until fn() is truthy (polling), or gives up after `ms`.
export async function until(fn, ms = 20000, every = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, every));
  }
}

// Reads a value from the open store (demo page only; the extension's store
// lives in an isolated world the page can't see).
export const store = (page, fn) => page.evaluate(`(${fn})(window.Supermarket.current())`);
