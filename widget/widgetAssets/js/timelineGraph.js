/*
 * fortiedrCommandTimeline -- graph model + cytoscape configuration for the
 * FortiEDR Command Timeline widget's node view. Pure and require()-able
 * (module.exports shim at the bottom), like timelineModel.js.
 *
 * The console's rdi-events stacks are a flat list of process stages. The
 * "what triggered what" structure lives in the PIDs: a stage whose
 * auxProcessId equals another stage's processId SPAWNED that process. So:
 *
 *   - one NODE per unique processId (a process that appears in several
 *     stages -- e.g. control.exe doing thread-creation, open-process and
 *     credentials-access in one detection -- merges onto one node, keeping
 *     every stage for the detail card);
 *   - one EDGE parent -> child per spawn link, derived once per pair;
 *   - SELF-EDGES dropped (live-proven: control.exe's THREAD CREATION STACK
 *     carries auxProcessId == its own processId -- a thread on itself, not
 *     a spawn);
 *   - dangling aux targets (the opened lsass, the spawned-but-unchained
 *     helper) produce no edge -- the console's chain only shows stages it
 *     kept.
 *
 * Live-derived chain shape (bash alert, sourceId 1508164): a clean
 * 9-node line systemd(1) -> sshd(1064) -> sshd(5225) -> sshd(5300) ->
 * bash(5301) -> sudo(5302) -> bash(5304) -> timeout(5345) -> bash(5346,
 * the /dev/tcp reverse shell).
 */
"use strict";

(function (root) {
  // Resolved at CALL time, never at load: SOAR auto-injects widgetAssets JS in
  // parallel and executes each on arrival, so this file may run before
  // timelineModel.js. Only the controller (which boots after ALL assets) may
  // assume the globals exist.
  function MODEL() {
    return (typeof module !== "undefined" && module && module.exports)
      ? require("./timelineModel.js")
      : root.fortiedrCommandTimelineModel;
  }

  // Stage names that only establish ancestry (how we got here). Everything
  // else a process DID -- thread creation, open process, credentials access,
  // connection stacks -- is ACTIVITY, the detection-relevant part. Unknown
  // names count as activity: highlighting an unknown is harmless; muting
  // one would hide the interesting bit.
  var ANCESTRY_STAGES = {
    "PARENT PROCESS CREATION": true,
    "PROCESS CREATION": true
  };

  function isActivity(stageName) {
    return !ANCESTRY_STAGES[String(stageName || "").toUpperCase().trim()];
  }

  /**
   * Build the graph view-model from the trimmed timeline (the object
   * extractTimeline returns -- buildStages reads its .stacks).
   * Returns { nodes, edges, roots }:
   *   node: { id, pid, label, time, activity, kinds, stages }
   *     - stages: chronologically sorted shaped stages (timelineModel's
   *       shape: stage/process/path/pid/auxPid/command/cert/bits/time/...)
   *   edge: { source, target } (node ids, parent -> child)
   *   roots: node ids with no incoming edge (layout fallback + ordering)
   */
  function toGraph(timeline) {
    var shaped = MODEL().buildStages(timeline);
    var byId = {};
    var order = [];
    var stageNode = [];

    shaped.forEach(function (st, i) {
      var key = st.pid || "stage-" + i;   // pid-less stages stand alone
      var node = byId[key];
      if (!node) {
        node = {
          id: key,
          pid: st.pid,
          // Two lines: the process name, and its PID -- chains repeat names
          // (three sshd, three bash in the live chains), and without the pid
          // the analyst cannot tell which node is which.
          label: st.process + (st.pid ? "\nPID " + st.pid : ""),
          time: "",
          activity: false,
          kinds: [],
          stages: [],
          firstEpoch: Number.POSITIVE_INFINITY
        };
        byId[key] = node;
        order.push(key);
      }
      node.stages.push(st);
      // Shaped stages carry the name as `stage` (NOT the raw `stageName`).
      if (st.stage && node.kinds.indexOf(st.stage) === -1) node.kinds.push(st.stage);
      if (isActivity(st.stage)) node.activity = true;
      if (st.epoch < node.firstEpoch) {
        node.firstEpoch = st.epoch;
        node.time = st.time || "";      // the earliest stage's renderable time
      }
      stageNode[i] = node;
    });

    var nodes = order.map(function (k) { return byId[k]; });

    var edges = [];
    var seen = {};
    shaped.forEach(function (st, i) {
      var from = stageNode[i];
      if (!st.auxPid) return;                       // no spawned pid recorded
      var to = byId[st.auxPid];
      if (!to || to === from) return;               // dangling target, or self
      var key = from.id + "->" + to.id;
      if (seen[key]) return;
      seen[key] = true;
      edges.push({ source: from.id, target: to.id });
    });

    var targets = {};
    edges.forEach(function (e) { targets[e.target] = true; });
    var roots = nodes.filter(function (n) { return !targets[n.id]; })
                     .map(function (n) { return n.id; });
    // Deterministic root order: earliest first-stage stamp wins (Infinity --
    // unstampable nodes -- sink to the end).
    roots.sort(function (a, b) { return byId[a].firstEpoch - byId[b].firstEpoch; });

    return { nodes: nodes, edges: edges, roots: roots };
  }

  /** Cytoscape element JSON for a graph. */
  function toElements(graph) {
    return {
      nodes: graph.nodes.map(function (n) {
        return {
          data: {
            id: n.id, label: n.label, pid: n.pid, time: n.time,
            activity: n.activity, kindCount: n.kinds.length,
            stageCount: n.stages.length
          }
        };
      }),
      edges: graph.edges.map(function (e, i) {
        return { data: { id: "e" + i, source: e.source, target: e.target } };
      })
    };
  }

  // Palette: mid-dark fills so the white labels read on light AND dark
  // panels without theme detection. The activity fill is the FortiEDR
  // console's detection red; ancestry stays slate.
  var NEUTRAL_FILL = "#4b5563", NEUTRAL_BORDER = "#333b47";
  var ACTIVITY_FILL = "#c2413b", ACTIVITY_BORDER = "#8f2d28";
  var EDGE_COLOR = "#7b8494";
  var SELECT_COLOR = "#22d3ee";

  function graphStyle() {
    return [
      {
        selector: "node",
        style: {
          shape: "round-rectangle",
          width: "label", height: 62,
          "padding-left": "14px", "padding-right": "14px",
          "padding-top": "8px", "padding-bottom": "8px",
          "background-color": NEUTRAL_FILL,
          "border-width": 2, "border-color": NEUTRAL_BORDER,
          label: "data(label)",
          color: "#ffffff",
          "font-size": 13, "font-weight": 600,
          "font-family": "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          "text-valign": "center", "text-halign": "center",
          "text-wrap": "wrap", "text-max-width": 150,
          "text-margin-y": 0
        }
      },
      {
        selector: "node[activity]",
        style: {
          "background-color": ACTIVITY_FILL,
          "border-color": ACTIVITY_BORDER
        }
      },
      {
        selector: "node.selected",
        style: {
          "border-width": 3,
          "border-color": SELECT_COLOR
        }
      },
      {
        selector: "edge",
        style: {
          width: 2,
          "line-color": EDGE_COLOR,
          "target-arrow-color": EDGE_COLOR,
          "target-arrow-shape": "triangle",
          "arrow-scale": 1.1,
          "curve-style": "bezier"
        }
      }
    ];
  }

  /**
   * dagre left-to-right (the spawn chain flows the way it executed), with
   * the breadthfirst fallback if the extension did not register. Registered
   * defensively by the controller; the flag lives on the cytoscape fn.
   */
  function graphLayout(graph) {
    return {
      name: "dagre",
      rankDir: "LR",
      nodeSep: 30,
      rankSep: 90,
      animate: false,
      fit: true
    };
  }

  var model = {
    isActivity: isActivity,
    toGraph: toGraph,
    toElements: toElements,
    graphStyle: graphStyle,
    graphLayout: graphLayout,
    COLORS: {
      NEUTRAL_FILL: NEUTRAL_FILL, NEUTRAL_BORDER: NEUTRAL_BORDER,
      ACTIVITY_FILL: ACTIVITY_FILL, ACTIVITY_BORDER: ACTIVITY_BORDER,
      EDGE_COLOR: EDGE_COLOR, SELECT_COLOR: SELECT_COLOR
    }
  };

  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = model;            // jest / node
  } else {
    root.fortiedrCommandTimelineGraph = model;  // the widget (global attach)
  }
})(typeof window !== "undefined" ? window : this);
