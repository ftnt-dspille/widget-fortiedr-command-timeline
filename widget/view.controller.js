/* Copyright start
   MIT License
   Copyright (c) 2026 Your Team
   Copyright end */
"use strict";
// VIEW controller. The harness/SOAR resolves the controller name as
// `<name><numericVersion>DevCtrl` -- fortiedrCommandTimeline100DevCtrl for
// fortiedrCommandTimeline v1.0.0. `widget bump` rewrites this suffix on a
// version change; never hand-edit it.
(function () {
  angular
    .module("cybersponse")
    .controller("fortiedrCommandTimeline100DevCtrl", fortiedrCommandTimeline100DevCtrl);

  fortiedrCommandTimeline100DevCtrl.$inject =
    ["$scope", "config", "FormEntityService", "$http", "$window", "$state"];

  function fortiedrCommandTimeline100DevCtrl($scope, config, FormEntityService, $http, $window, $state) {
    var m = $window.fortiedrCommandTimelineModel;
    var FETCH_TIMEOUT_MS = 8000;

    var defaults = { title: "FortiEDR Command Timeline", showModules: true };
    $scope.config = angular.extend({}, defaults, config || {});

    $scope.state = "loading"; // loading | ready | empty | error | no-record
    $scope.error = "";
    $scope.recordName = null;
    $scope.event = null;      // event header (host/os/when/where)
    $scope.stages = [];       // chronological process stages

    // The open record. SOAR injects it via FormEntityService on a View-Panel
    // mount; the NS1 fixture layer serves it locally on the mock e2e tier.
    function getRecord() {
      try {
        var e = FormEntityService.get();
        if (!e) return null;
        if (e.originalData) return e.originalData;   // { originalData: record }
        if (e["@id"] || e.uuid || e.id) return e;    // bare record
        if (e.fields) return e.fields;               // entity.fields
        return null;
      } catch (err) { return null; }
    }

    // The record's own IRI ("/api/3/alerts/<uuid>") -- used to re-read the
    // record when the page-load copy carries no sourcedata (it can predate
    // the ingestion upsert that writes the timeline).
    function recordIri(rec) {
      var iri = rec && rec["@id"];
      return (typeof iri === "string" && iri.indexOf("/api/3/") === 0) ? iri : "";
    }

    // render(record) -> void. Pure decision, easy to re-run after a refetch.
    function render(rec) {
      $scope.recordName = rec && (rec.name || rec["@id"]) || null;
      if (!rec) { $scope.state = "no-record"; return; }
      var payload = m.parseSourcedata(rec.sourcedata);
      if (rec.sourcedata && !payload) {
        $scope.state = "error";
        $scope.error = "The alert's sourcedata is not readable JSON.";
        return;
      }
      var timeline = m.extractTimeline(payload);
      if (!timeline) {
        $scope.state = "empty";
        return;
      }
      $scope.event = m.buildEvent(timeline);
      $scope.stages = m.buildStages(timeline);
      // A stored timeline with no stages is NOT the flag-off case: the
      // console returned an empty stacks list for this event (live-proven on
      // the box: two Delete Shadow Copies events carry no stacks at all).
      // The header still renders; the template shows a different note.
      $scope.state = "ready";
    }

    function init() {
      var rec = getRecord();
      if (rec) {
        render(rec);
        refetchIfTimelineMissing(rec);
        return;
      }
      // No page-load record: resolve the record from the route state and read
      // it from the box (the harness mounts this way; some SOAR hosts hand
      // the record only through the state). Bounded, one call.
      var id = ($state.params && $state.params.id) || "";
      var module = ($state.params && $state.params.module) || "alerts";
      if (!id) { $scope.state = "no-record"; return; }
      $http.get("/api/3/" + module + "/" + id, { timeout: FETCH_TIMEOUT_MS })
        .then(function (resp) {
          if (resp && resp.data) { render(resp.data); refetchIfTimelineMissing(resp.data); }
          else { $scope.state = "no-record"; }
        })
        .catch(function () { $scope.state = "no-record"; });
    }

    // The page-load copy can predate the upsert that stored the timeline (an
    // analyst sitting on the record while ingestion rewrites it). One bounded
    // re-read, only when the copy shows no timeline at all.
    function refetchIfTimelineMissing(rec) {
      if ($scope.state !== "empty" || !recordIri(rec)) return;
      $http.get(recordIri(rec), { timeout: FETCH_TIMEOUT_MS })
        .then(function (resp) {
          var fresh = resp && resp.data;
          if (!fresh) return;
          var t = m.extractTimeline(m.parseSourcedata(fresh.sourcedata));
          if (t) render(fresh);
        })
        .catch(function () { /* keep the empty state */ });
    }

    // Diagnostics the template shows alongside the states.
    $scope.emptyHint = "No command timeline is stored on this alert. Enable "
      + "Include Command Timeline in the FortiEDR data ingestion "
      + "configuration and re-pull the event.";

    init();
  }
})();
