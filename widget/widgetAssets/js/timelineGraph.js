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
 * INTERNET HOST node (API-derived, nothing invented): when the event
 * carries a destination/remoteIP AND at least one CONNECTION-type stage
 * (live-proven stage name: "CONNECTION STACK"), a terminal net node is
 * appended holding the IP + autonomous system (+ country / remote URL),
 * linked from every process that owned a connection stage. The net node's
 * stages ARE those connection stages, so tapping it shows the exact
 * command that reached out. No connection stage -> no net node: the event
 * header already carries the destination, and an edge we cannot anchor
 * would be a guess.
 *
 * Layout: linear chains (the common case) snake-wrap into rows of big
 * readable cards at zoom 1, ztp zig-zag style; branched graphs fall back
 * to dagre left-to-right. The extension registers defensively via the
 * controller (`C._fctlDagreRegistered`).
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

  function isConnectionStage(stageName) {
    return /CONNECTION/i.test(String(stageName || ""));
  }

  // ASCII ellipsis only: the en/em dash characters are banned by the
  // pre-commit hook, and "..." reads the same on a canvas.
  function ellipsize(s, n) {
    s = String(s === null || s === undefined ? "" : s);
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 3)) + "...";
  }

  /**
   * Build the graph view-model from the trimmed timeline (the object
   * extractTimeline returns -- buildStages reads its .stacks).
   * opts.action: the event's action ("Block"/"Log") from the record, when
   * the connector stores it -- rendered on the net card, never invented.
   * Returns { nodes, edges, roots }:
   *   node: { id, pid, name, label, command, activity, net, kinds, stages }
   *     - stages: chronologically sorted shaped stages (timelineModel's
   *       shape); `command` is the newest stage's command line;
   *     - net: null on process nodes; the { ip, asn, country, remoteUrl,
   *       action } facts on the internet-host node.
   *   edge: { source, target, net } (node ids, parent -> child; net edges
   *   flagged for the dashed style).
   *   roots: node ids with no incoming edge (dagre fallback ordering).
   */
  function toGraph(timeline, opts) {
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
          name: st.process || "unknown",
          label: st.process || "unknown",
          command: "",
          activity: false,
          net: null,
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
      if (st.command) node.command = st.command;   // stages are chronological
      if (st.epoch < node.firstEpoch) node.firstEpoch = st.epoch;
      stageNode[i] = node;
    });

    var nodes = order.map(function (k) { return byId[k]; });

    var edges = [];
    var seen = {};
    function addEdge(from, to, isNet) {
      var key = from.id + "->" + to.id;
      if (seen[key]) return;
      seen[key] = true;
      edges.push({ source: from.id, target: to.id, net: !!isNet });
    }

    shaped.forEach(function (st, i) {
      var from = stageNode[i];
      if (!st.auxPid) return;                       // no spawned pid recorded
      var to = byId[st.auxPid];
      if (!to || to === from) return;               // dangling target, or self
      addEdge(from, to, false);
    });

    // The internet-host node, when the event both names a destination and
    // carries a connection stage to anchor it to.
    var ip = timeline && (timeline.destination || timeline.remoteIP);
    var connPairs = [];
    shaped.forEach(function (st, i) {
      if (isConnectionStage(st.stage)) connPairs.push({ node: stageNode[i], st: st });
    });
    if (ip && connPairs.length) {
      var action = opts && opts.action ? String(opts.action) : "";
      var net = {
        id: "net:" + ip,
        pid: "",
        name: "Internet host" + (action ? " (" + action + ")" : ""),
        label: "",
        command: "",
        activity: false,
        net: {
          ip: ip,
          asn: timeline.asn || "",
          country: timeline.country || "",
          remoteUrl: timeline.remoteUrl || "",
          action: action
        },
        kinds: ["INTERNET HOST"],
        stages: connPairs.map(function (p) { return p.st; }),
        firstEpoch: Number.POSITIVE_INFINITY
      };
      var lines = [net.name, ip];
      if (timeline.asn) lines.push("AS " + timeline.asn);
      if (timeline.country) lines.push(timeline.country);
      if (timeline.remoteUrl) lines.push(ellipsize(timeline.remoteUrl, 34));
      net.label = lines.join("\n");
      byId[net.id] = net;
      nodes.push(net);
      // Every process that owned a connection stage talked to this host.
      var linked = {};
      connPairs.forEach(function (p) {
        if (p.node && p.node !== net && !linked[p.node.id]) {
          linked[p.node.id] = true;
          addEdge(p.node, net, true);
        }
      });
    }

    var targets = {};
    edges.forEach(function (e) { targets[e.target] = true; });
    var roots = nodes.filter(function (n) { return !targets[n.id]; })
                     .map(function (n) { return n.id; });
    // Deterministic root order: earliest first-stage stamp wins (Infinity --
    // unstampable nodes -- sink to the end).
    roots.sort(function (a, b) {
      return (byId[a].firstEpoch || 0) - (byId[b].firstEpoch || 0);
    });

    return { nodes: nodes, edges: edges, roots: roots };
  }

  // The card's kind line: the first ACTIVITY kind (with "+N" when the node
  // merged more kinds), or nothing on ancestry-only cards -- a chain of
  // "PARENT PROCESS CREATION" lines would be pure noise; the slate border
  // already says ancestry.
  function kindText(node) {
    if (!node || node.net) return "";
    var acts = node.kinds.filter(function (k) { return isActivity(k); });
    if (!acts.length) return "";
    return acts.length > 1 ? acts[0] + " +" + (acts.length - 1) : acts[0];
  }

  // The canvas card: process name / PID / what it did. Command lines live in
  // the Story view and the tapped node's detail: packing them into a card made
  // the graph a wall of text.
  function cardLabel(node) {
    if (!node) return "";
    if (node.net) return node.label;
    if (node.fold) return node.label;
    var lines = [ellipsize(node.name, 24)];
    if (node.pid) lines.push("PID " + node.pid);
    var kind = kindText(node);
    if (kind) lines.push(ellipsize(kind, 30));
    return lines.join("\n");
  }

  // Icons for the card's left edge: white strokes as data URIs (cytoscape
  // paints them as the node's background image).
  function svgUri(path, fill) {
    return "data:image/svg+xml;utf8," + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 24 24' fill='" + (fill || "none") +
      "' stroke='#e8ebf0' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'>" + path + "</svg>");
  }
  var ICONS = {
    terminal: svgUri("<path d='M4 6l6 6-6 6M12 19h8'/>"),
    globe: svgUri("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'/>"),
    shield: svgUri("<path d='M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'/>"),
    key: svgUri("<circle cx='8' cy='15' r='4'/><path d='M11 12l9-9M16 7l3 3'/>"),
    cube: svgUri("<path d='M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9'/>"),
    layers: svgUri("<path d='M12 3l9 5-9 5-9-5zM3 13l9 5 9-5'/>")
  };

  // The earliest plain-ancestry run collapsed into ONE node, mirroring the
  // story's fold (story.lead): the chain then opens on the interesting part.
  // Returns a new graph; the input is untouched.
  function foldLead(graph, story) {
    var lead = (story && story.lead) || [];
    if (!lead.length) return graph;
    var hide = {};
    lead.forEach(function (st) { hide[st.id] = true; });
    var names = lead.map(function (st) { return st.node.name; });
    var fold = {
      id: "fold", pid: "", name: lead.length + " earlier processes", fold: true,
      label: lead.length + " earlier processes\n" + ellipsize(names.join(" > "), 40),
      command: "", activity: false, net: null, kinds: [], stages: [], firstEpoch: 0,
      hidden: lead.map(function (st) { return st.node; })
    };
    var nodes = [fold].concat(graph.nodes.filter(function (n) { return !hide[n.id]; }));
    var edges = [], seen = {};
    graph.edges.forEach(function (e) {
      var from = hide[e.source] ? (hide[e.target] ? null : "fold") : e.source;
      if (!from) return;                                   // inside the folded run
      var k = from + "->" + e.target;
      if (seen[k]) return;
      seen[k] = true;
      edges.push({ source: from, target: e.target, net: e.net });
    });
    return { nodes: nodes, edges: edges, roots: ["fold"] };
  }

  /** Cytoscape element JSON for a graph. */
  function toElements(graph) {
    var roleOf = {};
    var nodes = graph.nodes.map(function (n) {
      var role = n.fold ? "fold" : (n.net ? "net" : (n.activity ? "activity" : "ancestry"));
      roleOf[n.id] = role;
      return {
        data: {
          id: n.id, label: cardLabel(n), name: n.name, pid: n.pid,
          color: n.net ? COLORS.NET_BORDER
               : (n.activity ? COLORS.ACTIVITY_BORDER : COLORS.ANCESTRY_BORDER),
          net: !!n.net, activity: !!n.activity, fold: !!n.fold, role: role,
          icon: ICONS[n.fold ? "layers" : iconKeyFor(n)],
          kindCount: n.kinds.length, stageCount: n.stages.length
        },
        classes: role
      };
    });
    var edges = graph.edges.map(function (e, i) {
      var tr = roleOf[e.target];
      return { data: { id: "e" + i, source: e.source, target: e.target, net: !!e.net,
        color: e.net ? COLORS.NET_BORDER : (tr === "activity" ? COLORS.ACTIVITY_BORDER : COLORS.EDGE_COLOR) } };
    });
    return { nodes: nodes, edges: edges };
  }

  // Same mapping the story's iconFor uses, on a graph node.
  function iconKeyFor(node) {
    if (node.net) return "globe";
    var n = String(node.name || "").toLowerCase().replace(/\.exe$/, "");
    if (/^(bash|sh|zsh|dash|ksh|fish|cmd|powershell|pwsh)$/.test(n)) return "terminal";
    if (/^(sudo|su|runas|doas)$/.test(n)) return "shield";
    if (/^(sshd|ssh|rdp|mstsc|winrm)/.test(n)) return "key";
    return "cube";
  }

  // Palette: ONE dark fill; the border and a soft glow carry the meaning --
  // slate = ancestry (muted), red = activity (glowing), blue = the internet
  // host. Labels read on the fixed dark canvas in light AND dark panels.
  var FILL = "#2b3648", LABEL = "#e8ebf0", LABEL_MUTED = "#aab4c3";
  var ANCESTRY_BORDER = "#64748b", ACTIVITY_BORDER = "#e5484d", NET_BORDER = "#3b82f6";
  var EDGE_COLOR = "#5b6577";
  var SELECT_COLOR = "#22d3ee";

  function graphStyle() {
    return [
      {
        selector: "node",
        style: {
          shape: "round-rectangle",
          width: CARD_W, height: "label",
          "padding-top": "10px", "padding-bottom": "10px",
          "padding-left": "34px", "padding-right": "10px",
          "background-color": FILL,
          "border-width": 2, "border-color": "data(color)",
          "background-image": "data(icon)",
          "background-fit": "none", "background-width": 16, "background-height": 16,
          "background-position-x": 12, "background-position-y": "50%",
          "background-clip": "none",
          label: "data(label)",
          color: LABEL,
          "font-size": 11, "font-weight": 600, "line-height": 1.3,
          "font-family": "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          "text-valign": "center", "text-halign": "center",
          "text-wrap": "wrap", "text-max-width": CARD_W - 52,
          "text-margin-x": 12
        }
      },
      { selector: "node.ancestry", style: { color: LABEL_MUTED, "border-opacity": 0.8 } },
      {
        selector: "node.activity",
        style: {
          "border-width": 3,
          "underlay-color": ACTIVITY_BORDER, "underlay-opacity": 0.22,
          "underlay-padding": 7, "underlay-shape": "round-rectangle"
        }
      },
      {
        selector: "node.net",
        style: {
          "underlay-color": NET_BORDER, "underlay-opacity": 0.2,
          "underlay-padding": 7, "underlay-shape": "round-rectangle"
        }
      },
      {
        selector: "node.fold",
        style: {
          "background-opacity": 0.35, "border-style": "dashed",
          color: LABEL_MUTED, "font-weight": 500
        }
      },
      {
        selector: "node.selected",
        style: {
          "border-width": 3,
          "border-color": SELECT_COLOR,
          "underlay-color": SELECT_COLOR, "underlay-opacity": 0.25, "underlay-padding": 7
        }
      },
      {
        selector: "edge",
        style: {
          width: 1.8,
          "line-color": "data(color)",
          "target-arrow-color": "data(color)",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.9,
          "curve-style": "bezier"
        }
      },
      {
        // A network connection is not a spawn: dashed marks the difference.
        selector: "edge[net]",
        style: { "line-style": "dashed" }
      }
    ];
  }

  // Card geometry shared by the style and the snake layout. The style's
  // width IS 200 -- the snake math must never disagree with the paint.
  var CARD_W = 184, CARD_H = 64;   // height nominal: real cards auto-height
  var SEP_X = 56, SEP_Y = 44, PAD = 32;

  /**
   * Snake layout for LINEAR chains: the chain wraps boustrophedon into rows
   * sized to the viewport, so every card renders at zoom 1 (dagre on a
   * 9-card line would shrink the whole graph to ~0.6x -- the unreadable
   * look). Returns null for anything with a branch, more than one root, or
   * a disconnected node: those get dagre.
   */
  function snakeLayout(graph, env) {
    if (!env || !(env.width > 0)) return null;
    var indeg = {}, outdeg = {};
    graph.edges.forEach(function (e) {
      outdeg[e.source] = (outdeg[e.source] || 0) + 1;
      indeg[e.target] = (indeg[e.target] || 0) + 1;
    });
    var roots = graph.nodes.filter(function (n) { return !indeg[n.id]; });
    if (roots.length !== 1) return null;
    for (var i = 0; i < graph.nodes.length; i++) {
      var id = graph.nodes[i].id;
      if ((outdeg[id] || 0) > 1 || (indeg[id] || 0) > 1) return null;
    }
    // Walk the line from its single root.
    var next = {};
    graph.edges.forEach(function (e) { next[e.source] = e.target; });
    var orderList = [roots[0].id];
    while (next[orderList[orderList.length - 1]]) {
      orderList.push(next[orderList[orderList.length - 1]]);
    }
    if (orderList.length !== graph.nodes.length) return null;

    var n = orderList.length;
    var availW = env.width - PAD * 2;
    var availH = (env.height || 0) - PAD * 2;
    var maxRows = availH > 0 ? Math.max(1, Math.floor(availH / (CARD_H + SEP_Y))) : 1;
    var rows = 0, cols = 0;
    for (var r = 1; r <= maxRows; r++) {
      cols = Math.ceil(n / r);
      if (cols * (CARD_W + SEP_X) - SEP_X <= availW) { rows = r; break; }
    }
    if (!rows) { rows = maxRows; cols = Math.ceil(n / rows); }  // fit shrinks

    var positions = {};
    orderList.forEach(function (id, s) {
      var row = Math.floor(s / cols), col = s % cols;
      if (row % 2 === 1) col = cols - 1 - col;   // boustrophedon: snake back
      positions[id] = {
        x: PAD + col * (CARD_W + SEP_X) + CARD_W / 2,
        y: PAD + row * (CARD_H + SEP_Y) + CARD_H / 2
      };
    });
    // fit:false + no zoom: the coordinates are built for zoom 1 inside the
    // viewport, top-left anchored -- preset must not upscale a short chain.
    return { name: "preset", positions: positions, fit: false, animate: false };
  }

  /**
   * Snake for linear chains (env = the mounted viewport's pixel size);
   * dagre left-to-right for branched graphs or pre-attach (no measurement
   * yet), where fit:true scales the whole picture to the box.
   */
  function graphLayout(graph, env) {
    var snake = snakeLayout(graph, env);
    if (snake) return snake;
    return {
      name: "dagre", rankDir: "LR", nodeSep: 40, rankSep: 80,
      animate: false, fit: true
    };
  }


  // ---- storyline (the default view) ------------------------------------
  //
  // The same graph, read as a narrative: how the chain started, what the
  // detection-relevant processes did, where it reached. Everything below is
  // derived from the stored stages; nothing is invented.

  // Tokens worth the analyst's eye inside a command line. Presentation only
  // (nothing gates on these): IPs, temp-dir paths, and shell-socket paths.
  var TOKEN_RE = new RegExp(
    "(\\/dev\\/(?:tcp|udp)\\/[^\\s\"']*)" +                       // 1 socket path
    "|(\\b\\d{1,3}(?:\\.\\d{1,3}){3}\\b(?::\\d+)?)" +              // 2 ip[:port]
    "|((?:\\/tmp|\\/var\\/tmp|\\/dev\\/shm)\\/[^\\s\"';|&]*)" +    // 3 temp path
    "|((?:[A-Za-z]:)?\\\\[^\\s\"']*\\\\(?:Temp|AppData)\\\\[^\\s\"']*)", "g"); // 4 win temp
  var TOKEN_KIND = [null, "sock", "ip", "tmp", "tmp"];

  /** Split a command line into [{ t: text, k: 'sock'|'ip'|'tmp'|'' }]. */
  function tokenizeCommand(cmd) {
    cmd = String(cmd || "");
    var out = [], last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(cmd)) !== null) {
      if (m.index > last) out.push({ t: cmd.slice(last, m.index), k: "" });
      var kind = "";
      for (var i = 1; i <= 4; i++) { if (m[i]) { kind = TOKEN_KIND[i]; break; } }
      out.push({ t: m[0], k: kind });
      last = m.index + m[0].length;
      if (m[0].length === 0) TOKEN_RE.lastIndex++;
    }
    if (last < cmd.length) out.push({ t: cmd.slice(last), k: "" });
    return out;
  }

  // Short, factual call-outs for a process card.
  function signalsFor(node) {
    var sig = [];
    if (!node || node.net) return sig;
    var blob = [node.command].concat(node.stages.map(function (s) { return s.path; })).join(" ");
    if (/\/dev\/(tcp|udp)\//.test(node.command)) sig.push("Opens a network socket from a shell");
    if (/(^|[\s\/])(\/tmp|\/var\/tmp|\/dev\/shm)\//.test(blob) ||
        /\\(Temp|AppData)\\/i.test(blob)) sig.push("Runs from a temporary location");
    if (/^(sudo|su|runas|doas)(\.exe)?$/i.test(node.name)) sig.push("Privilege elevation");
    node.stages.forEach(function (s) {
      if (s.modules && s.modules.some(function (m) { return String(m.writable).toLowerCase() === "yes"; }) &&
          sig.indexOf("Loads a writable module") === -1) sig.push("Loads a writable module");
    });
    return sig;
  }

  // Icon key for a card (CSS-mask SVGs in the story, data URIs on the canvas).
  var iconFor = iconKeyFor;

  function fmtDelta(sec) {
    if (!(sec >= 0) || !isFinite(sec)) return "";
    if (sec < 1) return "same second";
    if (sec < 60) return "+" + Math.round(sec) + "s";
    if (sec < 3600) return "+" + Math.floor(sec / 60) + "m " + Math.round(sec % 60) + "s";
    return "+" + Math.floor(sec / 3600) + "h " + Math.floor((sec % 3600) / 60) + "m";
  }

  // epoch (ms, plausible) of a node's first stage, or NaN when the sensor's
  // stamps do not decode to a wall-clock date (same gate the stages use).
  function nodeMs(node) {
    var e = node.firstEpoch;
    return (isFinite(e) && MODEL().stageTime(e)) ? (e >= 978307200000 ? e : e * 1000) : NaN;
  }

  /**
   * The storyline: an ordered, depth-annotated walk of the graph.
   * Returns { steps, lead, stats, narrative }:
   *   steps: [{ id, node, depth, role: 'ancestry'|'activity'|'net', delta,
   *             tokens, signals }]   (depth-first, earliest child first)
   *   lead:  the run of plain-ancestry steps at the top that the view folds
   *          into one "How it started" strip (kept to those beyond the last
   *          two, so the immediate parents stay as full cards).
   *   stats: { processes, activity, depth, spanText, hasNet }
   *   narrative: one sentence, built only from the stored facts.
   */
  function toStory(graph) {
    var byId = {}, kids = {};
    graph.nodes.forEach(function (n) { byId[n.id] = n; kids[n.id] = []; });
    graph.edges.forEach(function (e) {
      if (kids[e.source]) kids[e.source].push(e.target);
    });
    function ord(a, b) { return (byId[a].firstEpoch - byId[b].firstEpoch) || 0; }
    Object.keys(kids).forEach(function (k) { kids[k].sort(ord); });

    var steps = [], visited = {}, maxDepth = 0;
    function walk(id, depth, prevMs) {
      if (visited[id]) return;
      visited[id] = true;
      var n = byId[id];
      var ms = nodeMs(n);
      var delta = (isFinite(ms) && isFinite(prevMs)) ? fmtDelta((ms - prevMs) / 1000) : "";
      steps.push({
        id: id, node: n, depth: depth,
        role: n.net ? "net" : (n.activity ? "activity" : "ancestry"),
        delta: delta,
        icon: iconFor(n),
        tokens: tokenizeCommand(n.command),
        signals: signalsFor(n)
      });
      if (depth > maxDepth) maxDepth = depth;
      var anchor = isFinite(ms) ? ms : prevMs;
      kids[id].forEach(function (c) { walk(c, depth + 1, anchor); });
    }
    var targets = {};
    graph.edges.forEach(function (e) { targets[e.target] = true; });
    graph.nodes.filter(function (n) { return !targets[n.id]; })
      .sort(function (a, b) { return a.firstEpoch - b.firstEpoch || 0; })
      .forEach(function (n) { walk(n.id, 0, NaN); });
    graph.nodes.forEach(function (n) { walk(n.id, 0, NaN); });   // orphans / cycles

    // Fold the leading run of plain ancestry, keeping the last two visible.
    var run = 0;
    while (run < steps.length && steps[run].role === "ancestry" &&
           steps[run].depth === run) run++;
    var lead = run > 3 ? steps.slice(0, run - 2) : [];

    var procs = steps.filter(function (s) { return s.role !== "net"; });
    var acts = procs.filter(function (s) { return s.role === "activity"; });
    var epochs = procs.map(function (s) { return nodeMs(s.node); }).filter(isFinite);
    var span = epochs.length > 1 ? (Math.max.apply(null, epochs) - Math.min.apply(null, epochs)) / 1000 : NaN;
    var branched = Object.keys(kids).some(function (k) { return kids[k].length > 1; });
    var hasNet = steps.some(function (s) { return s.role === "net"; });

    var narrative = "";
    if (procs.length) {
      var first = procs[0].node, lastAct = acts.length ? acts[acts.length - 1].node : procs[procs.length - 1].node;
      var net = steps.filter(function (s) { return s.role === "net"; })[0];
      var who = function (n) { return n.name + (n.pid ? " (PID " + n.pid + ")" : ""); };
      narrative = procs.length === 1
        ? who(first) + " is the only process the console recorded."
        : who(first) + " started a chain of " + procs.length + " processes ending in " + who(lastAct);
      if (procs.length > 1) narrative += net
        ? ", which connected to " + net.node.net.ip + (net.node.net.asn ? " (AS " + net.node.net.asn + ")" : "") + "."
        : ".";
      else if (net) narrative = who(first) + " connected to " + net.node.net.ip + ".";
    }

    return {
      steps: steps, lead: lead, narrative: narrative,
      stats: {
        processes: procs.length, activity: acts.length, depth: maxDepth + 1, branched: branched,
        spanText: isFinite(span) ? fmtDelta(span).replace(/^\+/, "") : "", hasNet: hasNet
      }
    };
  }

  var COLORS = {
    FILL: FILL, LABEL: LABEL,
    ANCESTRY_BORDER: ANCESTRY_BORDER, ACTIVITY_BORDER: ACTIVITY_BORDER,
    NET_BORDER: NET_BORDER, EDGE_COLOR: EDGE_COLOR, SELECT_COLOR: SELECT_COLOR, LABEL_MUTED: LABEL_MUTED
  };

  var model = {
    isActivity: isActivity,
    isConnectionStage: isConnectionStage,
    ellipsize: ellipsize,
    kindText: kindText,
    cardLabel: cardLabel,
    toGraph: toGraph,
    foldLead: foldLead,
    toElements: toElements,
    graphStyle: graphStyle,
    graphLayout: graphLayout,
    snakeLayout: snakeLayout,
    toStory: toStory,
    tokenizeCommand: tokenizeCommand,
    signalsFor: signalsFor,
    fmtDelta: fmtDelta,
    iconFor: iconFor,
    CARD_W: CARD_W,
    COLORS: COLORS
  };

  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = model;            // jest / node
  } else {
    root.fortiedrCommandTimelineGraph = model;  // the widget (global attach)
  }
})(typeof window !== "undefined" ? window : this);
