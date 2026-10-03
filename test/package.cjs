const path = require("path");
const { tests } = require("@iobroker/testing");

// Prüft, dass package.json und io-package.json zusammenpassen (Name, Version, Pflichtfelder).
tests.packageFiles(path.join(__dirname, ".."));
