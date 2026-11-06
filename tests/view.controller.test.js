"use strict";
// Unit test for the view controller. Boots a bare `cybersponse` module, loads
// the controller IIFE (which self-registers), then $controller-instantiates it
// with mocked injectables and asserts the view-model + the cytoscape mount.
// Run with:
//
//   make test-unit WIDGET=fortiedrCommandTimeline        # from the dev-kit root
//   WIDGET=fortiedrCommandTimeline npm test              # in a standalone clone

global.jasmine = global.jasmine || {};

require("angular");
require("angular-mocks");

// The models load as plain scripts in the widget (window attach) and via
// require() here; the controller reads them off $window -- the ztp pattern.
const model = require("../widget/widgetAssets/js/timelineModel.js");
const graphModel = require("../widget/widgetAssets/js/timelineGraph.js");
angular.module("cybersponse", []); // eslint-disable-line no-undef
require("../widget/view.controller.js");

const CTRL_NAME = "fortiedrCommandTimeline120DevCtrl";
const ngModule = window.angular.mock.module; // eslint-disable-line no-undef
const ngInject = window.angular.mock.inject; // eslint-disable-line no-undef

// A sourcedata payload as the fortinet-fortiedrv2 connector stores it.
// Two processes: sudo (pid 5302) spawned bash (pid 5304); the bash stage is
// the CONNECTION STACK, so the graph anchors the event's internet host
// (1.1.1.1, AS 13335 CLOUDFLARENET) there.
function sourcedata(over) {
  return JSON.stringify(Object.assign({
    name: "bash - Malicious Application on lab-endpoint-01",
    external_id: "694297391",
    classification: "Malicious",
    card: { description: "<table>..." },
    command_timeline: {
      eventId: 694297391,
      host: "lab-endpoint-01",
      os: "Ubuntu 24.04.4 LTS",
      destination: "1.1.1.1",
      remoteIP: "1.1.1.1",
      asn: "13335 CLOUDFLARENET",
      firstSeenEpoch: 1793725982000,
      lastSeenEpoch: 1793725982000,
      eventCount: 1,
      stacks: [
        { stageName: "PARENT PROCESS CREATION", shortSourceProcessName: "sudo",
          sourceProcessPath: "/usr/bin/sudo", processId: "5302", auxProcessId: "5304",
          certificateStatus: "Unsigned", timestamp: 1793725330000,
          commandLine: "bash /tmp/edr_lab.sh all", stackEntries: [] },
        { stageName: "CONNECTION STACK", shortSourceProcessName: "bash",
          sourceProcessPath: "/usr/bin/bash", processId: "5304",
          certificateStatus: "Unsigned", timestamp: 1793725331000,
          commandLine: "6 bash -c exec 3<>/dev/tcp/1.1.1.1/443", stackEntries: [] },
      ],
    },
  }, over || {}));
}

// Cytoscape mock that records every constructed instance and its constructor
// options, and lets a test fire the tap handlers the controller registers.
// handlers are stored per registration shape: "tap:sel" (node, with selector)
// and "tap" (bare, the background) -- real cytoscape keeps both, so must we.
function mockCytoscape() {
  const calls = [];
  const factory = function (opts) {
    const handlers = {};
    const inst = {
      opts,
      on: function (ev, a, b) {
        if (typeof b === "function") { handlers[ev + ":sel"] = b; }
        else { handlers[ev] = a; }
        return this;
      },
      handlers,
      destroy: function () { inst.destroyed = true; },
      destroyed: false,
      resize: function () { return this; },
      fit: function () { return this; },
      // selection API the controller drives for the highlight ring
      $: function () { return { unselect: function () { inst.unselected = true; } }; },
    };
    inst.unselected = false;
    calls.push(inst);
    return inst;
  };
  factory.calls = calls;
  factory.use = function () { factory.useCalled = (factory.useCalled || 0) + 1; };
  return factory;
}

// The mount needs #fctl-cy in the (jsdom) document, with a parent.
function withGraphContainer(fn) {
  const host = document.createElement("div");
  const box = document.createElement("div");
  box.id = "fctl-cy";
  host.appendChild(box);
  document.body.appendChild(host);
  try { return fn(); } finally { host.remove(); }
}

function makeController(config, record, httpGet, state, cytoscape) {
  // The widget now opens on the Story tab; the graph-mechanics tests below
  // exercise the Graph tab, so they default to it. Story tests pass
  // defaultView: "story" explicitly.
  config = Object.assign({ defaultView: "graph" }, config || {});
  const fakeHttp = { get: httpGet || (() => ({ then: () => ({ catch: () => {} }) })) };
  const fakeState = state || { params: {} };
  let $scope;
  let $timeout;
  let spawn = () => {};   // assigned inside ngInject (see below)
  // cytoscape === null means "the graph library failed to load" ($window.cytoscape
  // undefined); undefined/omitted gets a fresh mock.
  const C = cytoscape === null ? undefined : (cytoscape || mockCytoscape());
  const windowLike = () => ({
    fortiedrCommandTimelineModel: model,
    fortiedrCommandTimelineGraph: graphModel,
    cytoscape: C,
    cytoscapeDagre: {},
  });
  ngModule("cybersponse", ($provide) => {
    $provide.value("config", config || {});
    $provide.value("FormEntityService", {
      get: () => (record === undefined ? null : { originalData: record }),
    });
    $provide.value("$http", fakeHttp);
    $provide.value("$state", fakeState);
    // $timeout is NOT overridden: angular-mocks' own is injectable and flushable,
    // and $provide.value here would register the variable's pre-inject undefined.
    $provide.value("$window", windowLike());
  });
  ngInject((_$rootScope_, _$controller_, _$timeout_) => {
    $timeout = _$timeout_;
    // angular-mocks allows ONE module()+inject() pair per test, so additional
    // controller instances (the shared-$window scenarios) boot from THIS
    // injector with fresh scopes instead of re-running makeController.
    // Assigned to the OUTER `spawn` binding (no const here).
    spawn = (rec, cfg) => {
      const s2 = _$rootScope_.$new();
      _$controller_(CTRL_NAME, {
        $scope: s2, config: cfg || config || {},
        FormEntityService: { get: () => (rec === undefined ? null : { originalData: rec }) },
        $http: fakeHttp,
        $window: windowLike(),
        $state: fakeState,
      });
      return s2;
    };
    $scope = spawn(record, config);
  });
  return {
    $scope, $timeout, cytoscape: C, spawn,
    flush: () => { $timeout.flush(); },
  };
}

function readyController(config, rec, cytoscape) {
  const ctl = makeController(config, rec, undefined, undefined, cytoscape);
  withGraphContainer(() => ctl.flush());
  return ctl;
}

describe("fortiedrCommandTimeline view controller", () => {
  test("renders ready and mounts the spawn graph for the stored timeline", () => {
    const rec = { name: "bash - Malicious Application on lab-endpoint-01",
                  "@id": "/api/3/alerts/abc-123", sourcedata: sourcedata() };
    const ctl = readyController({}, rec);
    expect(ctl.$scope.state).toBe("ready");
    expect(ctl.$scope.recordName).toBe(rec.name);
    expect(ctl.$scope.event.host).toBe("lab-endpoint-01");
    expect(ctl.$scope.graphEmpty).toBe(false);

    // The graph: sudo -> bash -> internet host. jsdom gives the container no
    // measurable width, so the snake declines and dagre lays it out.
    expect(ctl.cytoscape.calls.length).toBe(1);
    const opts = ctl.cytoscape.calls[0].opts;
    expect(opts.container.id).toBe("fctl-cy");
    expect(opts.layout).toMatchObject({ name: "dagre", rankDir: "LR" });
    expect(opts.elements.nodes.map((n) => n.data.id)).toEqual(
      ["5302", "5304", "net:1.1.1.1"]);
    expect(opts.elements.edges).toEqual([
      { data: { id: "e0", source: "5302", target: "5304", net: false,
                color: graphModel.COLORS.ACTIVITY_BORDER } },
      { data: { id: "e1", source: "5304", target: "net:1.1.1.1", net: true,
                color: graphModel.COLORS.NET_BORDER } },
    ]);
    // Cards: name + PID, the kind an activity node committed, its command.
    expect(opts.elements.nodes[1].data.label).toBe(
      "bash\nPID 5304\nCONNECTION STACK");
    expect(opts.elements.nodes[0].data.label).toBe(
      "sudo\nPID 5302");
    // The internet host card carries the API's own triple.
    expect(opts.elements.nodes[2].data.label).toBe(
      "Internet host\n1.1.1.1\nAS 13335 CLOUDFLARENET");
    expect(opts.elements.nodes[2].data.net).toBe(true);
    // Border color carries the meaning: slate ancestry, red activity, blue net.
    expect(opts.elements.nodes[0].data.color).toBe(graphModel.COLORS.ANCESTRY_BORDER);
    expect(opts.elements.nodes[1].data.color).toBe(graphModel.COLORS.ACTIVITY_BORDER);
    expect(opts.elements.nodes[2].data.color).toBe(graphModel.COLORS.NET_BORDER);
  });

  test("the record's action renders on the net card when the connector stores it", () => {
    const rec = { name: "x", action: "Block", sourcedata: sourcedata() };
    const ctl = readyController({}, rec);
    const net = ctl.cytoscape.calls[0].opts.elements.nodes
      .find((n) => n.data.id === "net:1.1.1.1");
    expect(net.data.label).toBe("Internet host (Block)\n1.1.1.1\nAS 13335 CLOUDFLARENET");
    // And a record without the field renders no action, never a guess.
    withGraphContainer(() => {
      ctl.spawn({ name: "x", sourcedata: sourcedata() });
      ctl.flush();
    });
    const net2 = ctl.cytoscape.calls[1].opts.elements.nodes
      .find((n) => n.data.id === "net:1.1.1.1");
    expect(net2.data.label).toBe("Internet host\n1.1.1.1\nAS 13335 CLOUDFLARENET");
  });

  test("tapping the internet host opens its facts and the command that reached out", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = readyController({}, rec);
    const inst = ctl.cytoscape.calls[0];
    inst.handlers["tap:sel"]({ target: { id: () => "net:1.1.1.1", select: () => {} } });
    expect(ctl.$scope.selected.net).toEqual({
      ip: "1.1.1.1", asn: "13335 CLOUDFLARENET", country: "",
      remoteUrl: "", action: "",
    });
    // The net node's stages ARE the connection stages: the exact command.
    expect(ctl.$scope.selected.stages[0].command).toContain("/dev/tcp/1.1.1.1/443");
  });

  test("registers cytoscape-dagre once, defensively (the flag lives on the fn)", () => {
    const C = mockCytoscape();
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = readyController({}, rec, C);
    expect(C.useCalled).toBe(1);
    // A second widget instance sharing the $window must NOT re-register.
    withGraphContainer(() => {
      const s2 = ctl.spawn(rec);
      expect(s2.graphEmpty).toBe(false);
      ctl.flush();  // the second instance's deferred mount, container still present
    });
    expect(ctl.cytoscape.calls.length).toBe(2);
    expect(C.useCalled).toBe(1);
  });

  test("tap on a node opens its detail card; tap on the background closes it", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = readyController({}, rec);
    const inst = ctl.cytoscape.calls[0];
    const nodeTap = inst.handlers["tap:sel"];   // registered with the node selector
    const bgTap = inst.handlers.tap;            // registered bare (background)

    nodeTap({ target: { id: () => "5304", select: () => {} } });
    expect(ctl.$scope.selected).not.toBeNull();
    expect(ctl.$scope.selected.name).toBe("bash");
    expect(ctl.$scope.selected.stages[0].command).toContain("/dev/tcp/1.1.1.1/443");

    ctl.$scope.closeDetail();
    expect(ctl.$scope.selected).toBeNull();

    nodeTap({ target: { id: () => "5302", select: () => {} } });
    expect(ctl.$scope.selected.pid).toBe("5302");
    bgTap.call(inst, { target: inst });         // background tap: target === cy
    expect(ctl.$scope.selected).toBeNull();
    expect(inst.unselected).toBe(true);         // the highlight ring clears
  });

  test("$destroy tears down the LIVE graph instance", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = readyController({}, rec);
    expect(ctl.cytoscape.calls.length).toBe(1);
    ctl.$scope.$destroy();
    expect(ctl.cytoscape.calls[0].destroyed).toBe(true);
  });

  test("$destroy tears the graph down and cancels a pending mount", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = makeController({}, rec);
    ctl.$scope.$destroy();
    ctl.flush();  // the deferred mount fires after the teardown: it must no-op
    expect(ctl.cytoscape.calls.length).toBe(0);
  });

  test("graphHeight defaults to 340px and clamps low", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = readyController({}, rec);
    expect(ctl.$scope.graphHeightPx).toBe("340px");
    expect(ctl.spawn(rec, { graphHeight: 50 }).graphHeightPx).toBe("160px");
  });

  test("graphHeight clamps high and falls back on junk", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    const ctl = readyController({ graphHeight: 99999 }, rec);
    expect(ctl.$scope.graphHeightPx).toBe("1200px");
    expect(ctl.spawn(rec, { graphHeight: "junk" }).graphHeightPx).toBe("340px");
  });

  test("degrades loudly when cytoscape did not load", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    // mountGraph hits the missing-library check synchronously (before it
    // schedules the deferred mount), so no $timeout.flush() here.
    const { $scope } = makeController({}, rec, undefined, undefined, null);
    expect($scope.state).toBe("error");
    expect($scope.error).toMatch(/graph library/);
  });

  test("shows the enable-the-flag hint on an alert without a timeline", () => {
    // sourcedata WITHOUT command_timeline: a pre-1.1.12 row or flag-off pull.
    const rec = { name: "old alert", sourcedata: sourcedata({ command_timeline: undefined }) };
    const { $scope } = makeController({}, rec);
    expect($scope.state).toBe("empty");
    expect($scope.emptyHint).toMatch(/Include Command Timeline/);
  });

  test("re-reads the record once when the page-load copy predates the upsert", () => {
    const stale = { name: "fresh alert", "@id": "/api/3/alerts/abc-123" }; // no sourcedata yet
    const fresh = { name: "fresh alert", sourcedata: sourcedata() };
    let fetched = 0;
    const ctl = makeController({}, stale, (iri) => {
      fetched += 1;
      expect(iri).toBe("/api/3/alerts/abc-123");
      return { then: (fn) => { fn({ data: fresh }); return { catch: () => {} }; } };
    });
    withGraphContainer(() => ctl.flush());
    // the fake resolves synchronously, so the render already adopted the fresh copy
    expect(ctl.$scope.state).toBe("ready");
    expect(ctl.cytoscape.calls.length).toBe(1);
    expect(fetched).toBe(1);
  });

  test("a failed refetch keeps the empty state instead of erroring", () => {
    const stale = { name: "x", "@id": "/api/3/alerts/abc-123" };
    const { $scope } = makeController({}, stale, () => ({
      then: () => ({ catch: () => {} }),
    }));
    expect($scope.state).toBe("empty");
  });

  test("no refetch when the copy already carries a timeline", () => {
    const rec = { name: "x", "@id": "/api/3/alerts/abc-123", sourcedata: sourcedata() };
    let fetched = 0;
    const { $scope } = makeController({}, rec, () => {
      fetched += 1;
      return { then: () => ({ catch: () => {} }) };
    });
    expect($scope.state).toBe("ready");
    expect(fetched).toBe(0);
  });

  test("a record with no sourcedata at all and no IRI stays empty, loudly", () => {
    const { $scope } = makeController({}, { name: "bare" });
    expect($scope.state).toBe("empty");
    expect($scope.emptyHint).toMatch(/Include Command Timeline/);
  });

  test("unparseable sourcedata is an error, not an empty state", () => {
    const rec = { name: "x", sourcedata: "{truncated" };
    const { $scope } = makeController({}, rec);
    expect($scope.state).toBe("error");
    expect($scope.error).toMatch(/sourcedata/);
  });

  test("degrades loudly when no record is loaded", () => {
    const { $scope } = makeController({}, undefined);
    expect($scope.state).toBe("no-record");
  });

  test("resolves the record from route state when no page-load record exists", () => {
    // The harness mounts this way (record arrives via $state, not
    // FormEntityService); on the box it covers hosts that hand the record
    // only through the state.
    const fresh = { name: "state-fed alert", sourcedata: sourcedata() };
    let fetchedIri = "";
    const ctl = makeController({}, undefined, (iri) => {
      fetchedIri = iri;
      return { then: (fn) => { fn({ data: fresh }); return { catch: () => {} }; } };
    }, { params: { id: "seed-1", module: "alerts" } });
    withGraphContainer(() => ctl.flush());
    expect(fetchedIri).toBe("/api/3/alerts/seed-1");
    expect(ctl.$scope.state).toBe("ready");
    expect(ctl.cytoscape.calls.length).toBe(1);
  });

  test("a failed state-fed fetch stays no-record", () => {
    const { $scope } = makeController({}, undefined, () => ({
      then: () => ({ catch: (fn) => { fn(new Error("boom")); } }),
    }), { params: { id: "seed-1", module: "alerts" } });
    expect($scope.state).toBe("no-record");
  });

  test("a stored timeline with no stages renders the header, not the flag hint", () => {
    // Live-caught on the box: two Delete Shadow Copies events answer
    // stacks: [] from the console, and the connector's empties-stripper
    // drops the empty list -- command_timeline exists WITHOUT stacks. That
    // is not the flag-off case; the hint must not tell the analyst to
    // enable a flag that is already on.
    const rec = { name: "Delete Shadow Copies - None on The-Flame",
                  sourcedata: sourcedata({
                    command_timeline: { eventId: 1492642, host: "The-Flame",
                                        eventCount: 1 },
                  }) };
    const ctl = makeController({}, rec);
    expect(ctl.$scope.state).toBe("ready");
    expect(ctl.$scope.graphEmpty).toBe(true);
    expect(ctl.$scope.event.host).toBe("The-Flame");
    // No graph was mounted for an empty stacks list (and nothing was deferred).
    expect(ctl.cytoscape.calls.length).toBe(0);
  });

  test("showModules defaults on", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    expect(makeController({}, rec).$scope.config.showModules).toBe(true);
  });

  test("showModules rides the config when set", () => {
    const rec = { name: "x", sourcedata: sourcedata() };
    expect(makeController({ showModules: false }, rec).$scope.config.showModules).toBe(false);
  });
});

describe("fortiedrCommandTimeline story view", () => {
  const rec = { name: "x", "@id": "/api/3/alerts/abc", sourcedata: sourcedata() };
  // No canvas timer in the story view, so no flush: build the controller directly.
  const readyController = (cfg, r, c) => makeController(cfg, r, undefined, undefined, c);

  test("opens on the story and mounts no canvas", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    expect(ctl.$scope.view).toBe("story");
    expect(ctl.$scope.story.stats.processes).toBe(2);
    expect(ctl.cytoscape.calls.length).toBe(0);
  });

  test("story still renders when cytoscape never loaded", () => {
    const ctl = readyController({ defaultView: "story" }, rec, null);
    expect(ctl.$scope.state).toBe("ready");
  });

  test("switching to Graph mounts once; back to Story tears it down", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    ctl.$scope.setView("graph");
    withGraphContainer(() => ctl.flush());
    expect(ctl.cytoscape.calls.length).toBe(1);
    ctl.$scope.setView("story");
    expect(ctl.$scope.view).toBe("story");
  });

  test("detail expands inline, and only for steps with something to add", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    const steps = ctl.$scope.visibleSteps();
    const first = steps[0];
    expect(ctl.$scope.hasMore(first)).toBe(true);        // cert / path / bits
    ctl.$scope.toggle(first);
    expect(ctl.$scope.open[first.id]).toBe(true);
    ctl.$scope.toggle(first);
    expect(ctl.$scope.open[first.id]).toBe(false);
  });

  test("the lead-in toggles through a scope function (ng-if safe)", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    expect(ctl.$scope.leadOpen).toBe(false);
    ctl.$scope.toggleLead();
    expect(ctl.$scope.leadOpen).toBe(true);
  });

  test("otherModules drops the stage's own binary", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    const stage = { path: "/usr/bin/x", modules: [{ path: "/usr/bin/x" }, { path: "/lib/y.so" }] };
    expect(ctl.$scope.otherModules(stage)).toEqual([{ path: "/lib/y.so" }]);
  });

  test("leadNames lists what the fold hides, in order", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    expect(ctl.$scope.leadNames()).toBe("");          // a 2-step chain folds nothing
    ctl.$scope.story = { lead: [{ node: { name: "systemd" } }, { node: { name: "sshd" } }] };
    expect(ctl.$scope.leadNames()).toBe("systemd > sshd");
  });

  test("a chain with no branches is not indented", () => {
    const ctl = readyController({ defaultView: "story" }, rec);
    expect(ctl.$scope.stepIndent(ctl.$scope.visibleSteps()[1])).toBe("0");
  });
});
