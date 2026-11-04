"use strict";
// Pure-logic tests for the timeline model (widget/widgetAssets/js/timelineModel.js).
// No DOM, no Angular -- just the sourcedata -> view-model rules.
// Run with: make test-unit WIDGET=fortiedrCommandTimeline
const m = require("../widget/widgetAssets/js/timelineModel.js");

// One stage as the console's rdi-events answer carries it (BEFORE the
// connector's trim -- the model must tolerate this shape too, since it only
// promises present-but-possibly-missing keys).
function rawStage(over) {
  return Object.assign({
    stageName: "PARENT PROCESS CREATION",
    shortSourceProcessName: "sudo",
    sourceProcessPath: "/usr/bin/sudo",
    sourceProcessOwner: null,
    destinationProcessPath: "",
    is64Bit: true,
    certificateStatus: "Unsigned",
    processId: "5302",
    auxProcessId: "5304",
    timestamp: 1793725330000,
    commandLine: "bash /tmp/edr_lab.sh all",
    stackNum: 3,
    stackEntries: [{ processPath: "/usr/bin/sudo", shortProcessName: "sudo",
                     certificateStatus: "Unsigned", main: true, isWritable: "No" }],
  }, over || {});
}

function rawTimeline(over) {
  return Object.assign({
    eventId: 694297391,
    host: "lab-endpoint-01",
    os: "Ubuntu 24.04.4 LTS",
    destination: "1.1.1.1",
    remoteIP: "1.1.1.1",
    asn: "13335 CLOUDFLARENET",
    firstSeenEpoch: 1793725982000,
    lastSeenEpoch: 1793725982000,
    eventCount: 1,
    stacks: [rawStage()],
  }, over || {});
}

describe("parseSourcedata", () => {
  test("parses the stored JSON string", () => {
    const payload = { command_timeline: rawTimeline() };
    expect(m.parseSourcedata(JSON.stringify(payload))).toEqual(payload);
  });
  test("passes an already-parsed object through", () => {
    const payload = { command_timeline: rawTimeline() };
    expect(m.parseSourcedata(payload)).toEqual(payload);
  });
  test("null/empty/unparseable -> null", () => {
    expect(m.parseSourcedata(null)).toBeNull();
    expect(m.parseSourcedata("")).toBeNull();
    expect(m.parseSourcedata("{not json")).toBeNull();
    expect(m.parseSourcedata(42)).toBeNull();
  });
});

describe("extractTimeline", () => {
  test("reads command_timeline off the payload", () => {
    const t = rawTimeline();
    expect(m.extractTimeline({ command_timeline: t })).toEqual(t);
  });
  test("absent on alerts ingested with the flag off", () => {
    expect(m.extractTimeline({ name: "x", external_id: "1" })).toBeNull();
    expect(m.extractTimeline(null)).toBeNull();
  });
});

describe("fmtTime", () => {
  test("renders epoch millis as DD-Mon-YYYY HH:mm:ss", () => {
    // 1793725330000 is 2026-11-04T05:02:10Z; asserted via the Date itself so
    // the test passes in any timezone.
    const out = m.fmtTime(1793725330000);
    expect(out).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
    const d = new Date(1793725330000);
    expect(out.startsWith(String(d.getDate()).padStart(2, "0") + "-")).toBe(true);
  });
  test("blank and non-numeric render empty", () => {
    expect(m.fmtTime(null)).toBe("");
    expect(m.fmtTime(undefined)).toBe("");
    expect(m.fmtTime("")).toBe("");
    expect(m.fmtTime("not-a-number")).toBe("");
  });
});

describe("baseName", () => {
  test("strips windows and posix directories", () => {
    expect(m.baseName("\\Device\\HarddiskVolume3\\Windows\\explorer.exe")).toBe("explorer.exe");
    expect(m.baseName("/usr/bin/sudo")).toBe("sudo");
    expect(m.baseName("cloud.exe")).toBe("cloud.exe");
  });
  test("empty stays empty", () => {
    expect(m.baseName("")).toBe("");
    expect(m.baseName(null)).toBe("");
  });
});

describe("buildStages", () => {
  test("maps the fields the rail renders", () => {
    const stages = m.buildStages(rawTimeline());
    expect(stages).toHaveLength(1);
    const s = stages[0];
    expect(s.stage).toBe("PARENT PROCESS CREATION");
    expect(s.process).toBe("sudo");
    expect(s.path).toBe("/usr/bin/sudo");
    expect(s.pid).toBe("5302");
    expect(s.auxPid).toBe("5304");
    expect(s.command).toBe("bash /tmp/edr_lab.sh all");
    expect(s.cert).toBe("Unsigned");
    expect(s.bits).toBe("64-bit");
    expect(s.modules).toHaveLength(1);
    expect(s.modules[0]).toEqual({
      path: "/usr/bin/sudo", name: "sudo", cert: "Unsigned",
      writable: "No", hash: "", main: true,
    });
  });

  test("sorts chronologically ascending, stable on console order for ties", () => {
    // The console's chain reads oldest first. Two stages share a timestamp
    // (the probe showed parent stages stamped identically); the tie keeps
    // the console's own order instead of shuffling it.
    const t = rawTimeline({
      stacks: [
        rawStage({ shortSourceProcessName: "a-later", timestamp: 2000 }),
        rawStage({ shortSourceProcessName: "b-earlier", timestamp: 1000 }),
        rawStage({ shortSourceProcessName: "c-tie-first", timestamp: 3000 }),
        rawStage({ shortSourceProcessName: "d-tie-second", timestamp: 3000 }),
      ],
    });
    const names = m.buildStages(t).map((s) => s.process);
    expect(names).toEqual(["b-earlier", "a-later", "c-tie-first", "d-tie-second"]);
  });

  test("missing timestamp sorts last, not first", () => {
    const t = rawTimeline({
      stacks: [
        rawStage({ shortSourceProcessName: "no-time", timestamp: null }),
        rawStage({ shortSourceProcessName: "stamped", timestamp: 1000 }),
      ],
    });
    const names = m.buildStages(t).map((s) => s.process);
    expect(names).toEqual(["stamped", "no-time"]);
  });

  test("derives the process name from the path when the short name is missing", () => {
    const t = rawTimeline({
      stacks: [rawStage({ shortSourceProcessName: null })],
    });
    expect(m.buildStages(t)[0].process).toBe("sudo");
  });

  test("no stacks -> empty array (caller shows its empty state)", () => {
    expect(m.buildStages(rawTimeline({ stacks: [] }))).toEqual([]);
    expect(m.buildStages(null)).toEqual([]);
  });
});

describe("stageTime", () => {
  test("renders a plausible epoch-ms stamp", () => {
    expect(m.stageTime(1793725330000)).toMatch(/^\d{2}-[A-Z][a-z]{2}-\d{4} /);
  });
  test("renders an epoch-seconds stamp as its ms equivalent", () => {
    expect(m.stageTime(1793725330)).toBe(m.fmtTime(1793725330000));
  });
  test("a sensor-relative stamp renders NO time (live-caught: ~4.1e9 on the Rozena chain)", () => {
    // The Windows sensor's stage stamps are neither plausible epoch-ms nor
    // plausible epoch-seconds (as seconds they would claim the year 2098).
    expect(m.stageTime(4062960528)).toBe("");
    expect(m.stageTime(4148309287)).toBe("");
  });
  test("blank and non-numeric render empty", () => {
    expect(m.stageTime(null)).toBe("");
    expect(m.stageTime("")).toBe("");
    expect(m.stageTime("junk")).toBe("");
  });
});

describe("buildEvent", () => {
  test("renders the header scalars", () => {
    const e = m.buildEvent(rawTimeline());
    expect(e.host).toBe("lab-endpoint-01");
    expect(e.os).toBe("Ubuntu 24.04.4 LTS");
    expect(e.destination).toBe("1.1.1.1");
    expect(e.remoteIP).toBe("1.1.1.1");
    expect(e.asn).toBe("13335 CLOUDFLARENET");
    expect(e.eventCount).toBe("1");
    expect(e.firstSeen).toMatch(/^\d{2}-/);
  });
  test("null timeline -> null", () => {
    expect(m.buildEvent(null)).toBeNull();
  });
});
