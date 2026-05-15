import { expect, test } from "vite-plus/test";

test("intentional smoke failure", () => {
  expect(2 + 2).toBe(4);
});
