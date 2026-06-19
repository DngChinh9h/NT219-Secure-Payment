"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

describe("secret hygiene scan", () => {
  test("repo does not contain private keys, cert files, or real env files", () => {
    const root = path.resolve(__dirname, "../../..");
    const result = spawnSync(process.execPath, ["scripts/secret-scan.js"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Secret scan passed");
  });
});
