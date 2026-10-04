const path = require("path");
const assert = require("node:assert");
const { tests } = require("@iobroker/testing");

const NS = "anycubic-cloud.0";
const DEV = `${NS}.123`;
const oldUsage = {
    taskid: "42",
    datei: "part",
    ergebnis: "abgebrochen",
    start: "2026-10-02T10:00:00.000Z",
    ende: "2026-10-02T11:00:00.000Z",
    mm: 393,
    quelle: "mm",
    slots: [{ slot: 2, gramm: 1.2, geplant: 256.9, farbe: "#eff0f1", material: "PETG", sku: "X", manuell: false, restVorher: 90, restNachher: 89 }],
};

async function state(harness, id, type, val) {
    await harness.objects.setObjectAsync(id, { type: "state", common: { name: id, type, role: "state", read: true, write: false }, native: {} });
    await harness.states.setStateAsync(id, { val, ack: true });
}

tests.integration(path.join(__dirname, ".."), {
    defineAdditionalTests({ suite }) {
        suite("migration from 0.2.x", getHarness => {
            it("keeps the usage history and removes the German objects", async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.objects.setObjectAsync(DEV, { type: "device", common: { name: "printer" }, native: {} });
                await harness.objects.setObjectAsync(`${DEV}.temp`, { type: "channel", common: { name: "Temperaturen" }, native: {} });
                await state(harness, `${DEV}.temp.duese`, "number", 210);
                await state(harness, `${DEV}.zustand`, "string", "druckt");
                await state(harness, `${DEV}.ace.slot1.farbe`, "string", "#000000");
                await state(harness, `${DEV}.ace.slot1.material`, "string", "PLA");
                await state(harness, `${DEV}.verbrauch.verlauf`, "string", JSON.stringify([oldUsage]));
                await state(harness, `${DEV}.job.merker`, "string", JSON.stringify({ plan: null, job: { taskid: "42", start: null, rest: [90] } }));
                await state(harness, `${NS}.info.tokenTage`, "number", 30);

                await harness.startAdapterAndWait();
                await new Promise(r => setTimeout(r, 3000));

                const ids = Object.keys(await harness.objects.getObjectListAsync({ startkey: `${NS}.`, endkey: `${NS}.香` }).then(r => Object.fromEntries(r.rows.map(x => [x.id, 1]))));
                for (const gone of ["temp", "temp.duese", "zustand", "ace.slot1.farbe", "verbrauch.verlauf", "job.merker"]) {
                    assert.ok(!ids.includes(`${DEV}.${gone}`), `${gone} should be deleted`);
                }
                assert.ok(!ids.includes(`${NS}.info.tokenTage`), "info.tokenTage should be deleted");
                assert.ok(ids.includes(`${DEV}.ace.slot1.material`), "unchanged IDs stay");

                const history = JSON.parse((await harness.states.getStateAsync(`${DEV}.usage.history`)).val);
                assert.strictEqual(history[0].taskId, "42");
                assert.strictEqual(history[0].result, "stopped");
                assert.strictEqual(history[0].slots[0].grams, 1.2);
                assert.strictEqual(history[0].slots[0].remainingAfter, 89);
                const memo = JSON.parse((await harness.states.getStateAsync(`${DEV}.job.internal`)).val);
                assert.deepStrictEqual(memo.job, { taskId: "42", start: null, remaining: [90] });
            });
        });
    },
});
