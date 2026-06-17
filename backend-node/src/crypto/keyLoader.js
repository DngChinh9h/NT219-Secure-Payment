"use strict";

const fs = require("fs");
const path = require("path");

const PUBLIC_KEY_PATH = path.join(__dirname, "../../keys/public.pem");

function loadPublicKey() {
  return fs.readFileSync(PUBLIC_KEY_PATH, "utf8");
}
module.exports = {
  loadPublicKey,
};
