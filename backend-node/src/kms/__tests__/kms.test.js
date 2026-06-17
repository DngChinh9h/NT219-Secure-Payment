const crypto = require("crypto");
const { generateDataKey, unwrapDataKey } = require("../kmsService");

test("generateDataKey trả về plaintext 32 bytes", async () => {
  const { plaintext } = await generateDataKey();

  expect(plaintext).toBeInstanceOf(Buffer);

  expect(plaintext.length).toBe(32);
});

test("generateDataKey trả về wrapped string hex", async () => {
  const { wrapped } = await generateDataKey();
  expect(typeof wrapped).toBe("string");
  expect(wrapped).toMatch(/^[a-f0-9]+$/);
});

test("unwrapDataKey khôi phục đúng plaintext", async () => {
  const { plaintext, wrapped } = await generateDataKey();

  const unwrapped = await unwrapDataKey(wrapped);

  expect(unwrapped).toBeInstanceOf(Buffer);

  expect(unwrapped.equals(plaintext)).toBe(true);
});

test("2 lần generateDataKey", async () => {
  const { plaintext: k1 } = await generateDataKey();

  const { plaintext: k2 } = await generateDataKey();

  expect(k1.equals(k2)).toBe(false);
});

//   test("wrapped key sai → unwrap throw Error", () => {
//     expect(() => unwrapDataKey("a".repeat(64))).toThrow();
//   });
// });
