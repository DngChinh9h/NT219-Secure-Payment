"use strict";

const { spawnSync } = require("child_process");

const result = spawnSync(process.execPath, ["scripts/lint-syntax.js"], {
  stdio: "inherit",
});

process.exit(result.status || 0);
