const path = require("path");
const { tests } = require("@iobroker/testing");

// Startet den Adapter in einem Test-js-controller (ohne Token -> warnt und bleibt im Leerlauf, kein Crash).
tests.integration(path.join(__dirname, ".."));
