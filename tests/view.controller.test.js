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

const CTRL_NAME = "fortiedrCommandTimeline110DevCtrl";
const ngModule = window.angular.mock.module; // eslint-disable-line no-undef
const ngInject = window.angular.mock.inject; // eslint-disable-line no-undef

// A sourcedata payload as the fortinet-fortiedrv2 connector stores it.
// Two processes: sudo (pid 5302) spawned bash (pid 5304); the bash stage is
// "PROCESS ACTIVITY", so the graph must flag it as the activity node.
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
      firstSeenEpoch: 1793725982000,
      lastSeenEpoch: 1793725982000,
      eventCount: 1,
      stacks: [
        { stageName: "PARENT PROCESS CREATION", shortSourceProcessName: "sudo",
          sourceProcessPath: "/usr/bin/sudo", processId: "5302", auxProcessId: "5304",
          certificateStatus: "Unsigned", timestamp: 1793725330000,
          commandLine: "bash /tmp/edr_lab.sh all", stackEntries: [] },
        { stageName: "PROCESS ACTIVITY", shortSourceProcessName: "bash",
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
    };
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

    // The graph: 2 nodes (sudo -> bash), 1 edge, dagre left-to-right.
    expect(ctl.cytoscape.calls.length).toBe(1);
    const opts = ctl.cytoscape.calls[0].opts;
    expect(opts.container.id).toBe("fctl-cy");
    expect(opts.layout).toMatchObject({ name: "dagre", rankDir: "LR" });
    expect(opts.elements.nodes.map((n) => n.data.id)).toEqual(["5302", "5304"]);
    expect(opts.elements.edges).toEqual([
      { data: { id: "e0", source: "5302", target: "5304" } },
    ]);
    // Labels carry the PID so repeated names are distinguishable.
    expect(opts.elements.nodes[1].data.label).toBe("bash\nPID 5304");
    // The activity stage colors its node.
    expect(opts.elements.nodes[1].data.activity).toBe(true);
    expect(opts.elements.nodes[0].data.activity).toBe(false);
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

    nodeTap({ target: { id: () => "5304" } });
    expect(ctl.$scope.selected).not.toBeNull();
    expect(ctl.$scope.selected.label).toBe("bash\nPID 5304");
    expect(ctl.$scope.selected.stages[0].command).toContain("/dev/tcp/1.1.1.1/443");

    ctl.$scope.closeDetail();
    expect(ctl.$scope.selected).toBeNull();

    nodeTap({ target: { id: () => "5302" } });
    expect(ctl.$scope.selected.pid).toBe("5302");
    bgTap.call(inst, { target: inst });         // background tap: target === cy
    expect(ctl.$scope.selected).toBeNull();
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
