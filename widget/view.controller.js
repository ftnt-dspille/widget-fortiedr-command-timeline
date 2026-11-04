/* Copyright start
   MIT License
   Copyright (c) 2026 Your Team
   Copyright end */
"use strict";
// VIEW controller. The harness/SOAR resolves the controller name as
// `<name><numericVersion>DevCtrl` -- fortiedrCommandTimeline110DevCtrl for
// fortiedrCommandTimeline v1.0.1. `widget bump` rewrites this suffix on a
// version change; never hand-edit it.
(function () {
  angular
    .module("cybersponse")
    .controller("fortiedrCommandTimeline110DevCtrl", fortiedrCommandTimeline110DevCtrl);

  fortiedrCommandTimeline110DevCtrl.$inject =
    ["$scope", "config", "FormEntityService", "$http", "$window", "$state", "$timeout"];

  function fortiedrCommandTimeline110DevCtrl($scope, config, FormEntityService, $http, $window, $state, $timeout) {
    var m = $window.fortiedrCommandTimelineModel;    // sourcedata -> timeline
    var g = $window.fortiedrCommandTimelineGraph;   // timeline -> graph model
    var FETCH_TIMEOUT_MS = 8000;
    var GRAPH_SETTLE_MS = 120;                      // container must be in the DOM

    var defaults = { title: "FortiEDR Command Timeline", showModules: true, graphHeight: 340 };
    $scope.config = angular.extend({}, defaults, config || {});
    // Bounded, scrollable graph viewport (ztp's clamp).
    var gh = Number($scope.config.graphHeight);
    if (!(gh > 0)) gh = 340;
    gh = Math.max(160, Math.min(1200, gh));
    $scope.graphHeightPx = gh + "px";

    $scope.state = "loading"; // loading | ready | empty | error | no-record
    $scope.error = "";
    $scope.recordName = null;
    $scope.event = null;      // event header (host/os/when/where)
    $scope.selected = null;   // the tapped node's detail (stages + commands)

    var cy = null;            // cytoscape instance
    // The platform can rebuild the widget while a layout is in flight; the
    // old controller's callbacks must not touch the new widget's container
    // (ztp's torn-guard lesson).
    var torn = false;

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
      $scope.state = "ready";
      mountGraph(timeline);
    }

    // ---- graph ----------------------------------------------------------

    function mountGraph(timeline) {
      var C = $window.cytoscape;
      if (!C || !g) {
        $scope.state = "error";
        $scope.error = "The graph library failed to load.";
        return;
      }
      var graph = g.toGraph(timeline);
      if (!graph.nodes.length) {          // timeline present, stacks empty
        $scope.graphEmpty = true;         // -> the no-stages note, not a graph
        $scope.state = "ready";
        return;
      }
      $scope.graphEmpty = false;
      var elements = g.toElements(graph);

      if (C.use && $window.cytoscapeDagre && !C._fctlDagreRegistered) {
        try { C.use($window.cytoscapeDagre); } catch (e) { /* already registered */ }
        C._fctlDagreRegistered = true;
      }

      $timeout(function () {
        if (torn) return;
        var container = document.getElementById("fctl-cy");
        if (!container || !container.parentElement) return;  // re-rendered away
        if (cy) { try { cy.destroy(); } catch (e) {} cy = null; }
        cy = C({
          container: container,
          elements: elements,
          style: g.graphStyle(),
          layout: g.graphLayout(graph),
          wheelSensitivity: 0.2,
          boxSelectionEnabled: false,
          autoungrabify: true
        });
        cy.on("tap", "node", function (evt) {
          select(evt.target.id(), graph);
          $scope.$apply();
        });
        cy.on("tap", function (evt) {
          if (evt.target === cy) { $scope.selected = null; $scope.$apply(); }
        });
        $window.__fctlCy = cy; // expose for debugging / e2e node-tap driving
      }, GRAPH_SETTLE_MS);
    }

    // The tapped node's detail: every stage that process ran, chronologically,
    // with the command lines front and center.
    function select(nodeId, graph) {
      var node = null;
      for (var i = 0; i < graph.nodes.length; i++) {
        if (graph.nodes[i].id === nodeId) { node = graph.nodes[i]; break; }
      }
      if (!node) { $scope.selected = null; return; }
      $scope.selected = node;
    }

    $scope.closeDetail = function () { $scope.selected = null; };

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

    $scope.$on("$destroy", function () {
      torn = true;
      if (cy) { try { cy.destroy(); } catch (e) {} cy = null; }
    });

    init();
  }
})();
