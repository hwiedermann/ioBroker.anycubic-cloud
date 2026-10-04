const path = require("path");
const { tests } = require("@iobroker/testing");

// checks that package.json and io-package.json match (name, version, required fields)
tests.packageFiles(path.join(__dirname, ".."));
