"use strict";
// Unit test for the view controller. Boots a bare `cybersponse` module, loads
// the controller IIFE (which self-registers), then $controller-instantiates it
// with mocked injectables and asserts the view-model. Run with:
//
//   make test-unit WIDGET=fortiedrCommandTimeline        # from the dev-kit root
//   WIDGET=fortiedrCommandTimeline npm test              # in a standalone clone

global.jasmine = global.jasmine || {};

require("angular");
require("angular-mocks");

// The model loads as a plain script in the widget (window attach) and via
// require() in the model tests; the controller reads it off $window, so the
// test provides $window with the required module -- the ztp pattern.
const model = require("../widget/widgetAssets/js/timelineModel.js");
angular.module("cybersponse", []); // eslint-disable-line no-undef
require("../widget/view.controller.js");

const CTRL_NAME = "fortiedrCommandTimeline101DevCtrl";
const ngModule = window.angular.mock.module; // eslint-disable-line no-undef
const ngInject = window.angular.mock.inject; // eslint-disable-line no-undef

// A sourcedata payload as the fortinet-fortiedrv2 connector stores it.
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
          sourceProcessPath: "/usr/bin/sudo", processId: "5302",
          certificateStatus: "Unsigned", timestamp: 1793725330000,
          commandLine: "bash /tmp/edr_lab.sh all", stackEntries: [] },
        { stageName: "PROCESS ACTIVITY", shortSourceProcessName: "timeout",
          sourceProcessPath: "/usr/bin/timeout", processId: "5345",
          certificateStatus: "Unsigned", timestamp: 1793725331000,
          commandLine: "6 bash -c exec 3<>/dev/tcp/1.1.1.1/443", stackEntries: [] },
      ],
    },
  }, over || {}));
}

function makeController(config, record, httpGet, state) {
  const fakeHttp = { get: httpGet || (() => ({ then: () => ({ catch: () => {} }) })) };
  const fakeState = state || { params: {} };
  let $scope;
  ngModule("cybersponse", ($provide) => {
    $provide.value("config", config || {});
    $provide.value("FormEntityService", {
      get: () => (record === undefined ? null : { originalData: record }),
    });
    $provide.value("$http", fakeHttp);
    $provide.value("$state", fakeState);
    $provide.value("$window", { fortiedrCommandTimelineModel: model });
  });
  ngInject((_$rootScope_, _$controller_) => {
    $scope = _$rootScope_.$new();
    _$controller_(CTRL_NAME, {
      $scope, config: config || {},
      FormEntityService: { get: () => (record === undefined ? null : { originalData: record }) },
      $http: fakeHttp,
      $window: { fortiedrCommandTimelineModel: model },
      $state: fakeState,
    });
  });
  return { $scope };
}

describe("fortiedrCommandTimeline view controller", () => {
  test("renders the chronological rail from a stored timeline", () => {
    const rec = { name: "bash - Malicious Application on lab-endpoint-01",
                  "@id": "/api/3/alerts/abc-123", sourcedata: sourcedata() };
    const { $scope } = makeController({}, rec);
    expect($scope.state).toBe("ready");
    expect($scope.recordName).toBe(rec.name);
    expect($scope.event.host).toBe("lab-endpoint-01");
    expect($scope.stages.map((s) => s.process)).toEqual(["sudo", "timeout"]);
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
    const { $scope } = makeController({}, stale, (iri) => {
      fetched += 1;
      expect(iri).toBe("/api/3/alerts/abc-123");
      return { then: (fn) => { fn({ data: fresh }); return { catch: () => {} }; } };
    });
    // the fake resolves synchronously, so the render already adopted the fresh copy
    expect($scope.state).toBe("ready");
    expect($scope.stages).toHaveLength(2);
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
    const { $scope } = makeController({}, undefined, (iri) => {
      fetchedIri = iri;
      return { then: (fn) => { fn({ data: fresh }); return { catch: () => {} }; } };
    }, { params: { id: "seed-1", module: "alerts" } });
    expect(fetchedIri).toBe("/api/3/alerts/seed-1");
    expect($scope.state).toBe("ready");
    expect($scope.stages).toHaveLength(2);
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
    const { $scope } = makeController({}, rec);
    expect($scope.state).toBe("ready");
    expect($scope.stages).toEqual([]);
    expect($scope.event.host).toBe("The-Flame");
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
