/*
 * fortiedrCommandTimeline -- pure model for the FortiEDR Command Timeline
 * widget. No DOM, no Angular: the controller wires it to $scope, the jest
 * unit tests require() it directly (the module.exports shim at the bottom).
 *
 * Input is the alert record's `sourcedata` payload written by the
 * fortinet-fortiedrv2 connector (v1.1.12+) when its Include Command Timeline
 * flag is on. The connector stores a TRIMMED timeline under
 * `command_timeline`: whitelisted fields only, nulls and empties stripped
 * recursively, so everything here can assume present-but-possibly-missing
 * keys and never a null scalar.
 *
 * Shape (as stored by ingestion.attach_command_timelines):
 *   command_timeline: {
 *     id, eventId, host, os, osFamily, destination, remoteIP, remoteUrl,
 *     country, asn, firstSeen, lastSeen, firstSeenEpoch, lastSeenEpoch,
 *     eventCount,
 *     stacks: [{
 *       stageName, shortSourceProcessName, sourceProcessPath, is64Bit,
 *       certificateStatus, processId, auxProcessName, auxProcessId,
 *       timestamp, commandLine, stackNum,
 *       stackEntries: [{ processPath, shortProcessName, certificateStatus,
 *                        main, isWritable, hash, ... }]
 *     }]
 *   }
 */
"use strict";

(function (root) {
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // sourcedata rides the record as a JSON string; a freshly parsed record
  // (or a test fixture) may already hand over the object. Anything else is
  // unreadable: null, and the caller shows its error state.
  function parseSourcedata(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw !== "string") return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // The trimmed timeline inside the payload. Absent on alerts ingested with
  // the flag off (or before 1.1.12) -- the caller shows its empty state.
  function extractTimeline(payload) {
    if (!payload || typeof payload !== "object") return null;
    var t = payload.command_timeline;
    return (t && typeof t === "object") ? t : null;
  }

  // epoch millis -> "03-Nov-2026 11:13:02" in the viewer's local time. The
  // console renders sensor-local stamps; the widget renders the analyst's
  // clock, like every other FortiSOAR timestamp. Non-numeric renders "".
  function fmtTime(ms) {
    if (ms === null || ms === undefined || ms === "") return "";
    var n = Number(ms);
    if (isNaN(n)) return "";
    var d = new Date(n);
    if (isNaN(d.getTime())) return "";
    return pad(d.getDate()) + "-" + MONTHS[d.getMonth()] + "-" + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  // Plausible absolute epoch for a process-creation stamp: 2001-01-01 through
  // 2090-01-01. Stage timestamps are NOT a stable unit across sensors --
  // live-proven on the box: a Linux event's stages carry true epoch-ms
  // (1.79e12) while a Windows event's stages carried ~4.1e9, which is
  // neither a plausible epoch-ms nor a plausible epoch-second (that would be
  // the year 2098). Only a value that decodes to a sane wall-clock date may
  // render as one; everything else renders no time but still orders by its
  // raw value (the chain order is what the timeline is for).
  var MS_MIN = 978307200000;   // 2001-01-01
  var MS_MAX = 4102444800000;  // 2090-01-01
  var S_MIN = 978307200;       // same span, in seconds
  var S_MAX = 3786912000;
  function plausibleEpochMs(n) { return n >= MS_MIN && n <= MS_MAX; }

  function stageTime(ts) {
    if (ts === null || ts === undefined || ts === "") return "";
    var n = Number(ts);
    if (isNaN(n)) return "";
    if (plausibleEpochMs(n)) return fmtTime(n);
    // epoch-seconds shape (2001..2090): render as its ms equivalent. The
    // bound matters: the live Windows sensor's relative stamps (~4.1e9) sit
    // just above it -- rendered as seconds they would claim the year 2098.
    if (n >= S_MIN && n <= S_MAX) return fmtTime(n * 1000);
    return "";
  }

  // "\Device\HarddiskVolume3\Windows\explorer.exe" -> "explorer.exe"
  function baseName(path) {
    if (typeof path !== "string" || !path) return "";
    var i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    return i >= 0 ? path.slice(i + 1) : path;
  }

  // One render-ready row per process stage. The console's chain reads oldest
  // first, so stages sort by timestamp ascending and stay stable on the
  // console's own array order for equal stamps (sort must not reorder ties).
  function buildStages(timeline) {
    var stacks = (timeline && timeline.stacks) || [];
    var stages = [];
    for (var i = 0; i < stacks.length; i++) {
      var s = stacks[i] || {};
      var modules = [];
      var entries = s.stackEntries || [];
      for (var j = 0; j < entries.length; j++) {
        var m = entries[j] || {};
        modules.push({
          path: m.processPath || "",
          name: m.shortProcessName || baseName(m.processPath),
          cert: m.certificateStatus || "",
          writable: m.isWritable || "",
          hash: m.hash || "",
          main: !!m.main
        });
      }
      stages.push({
        index: i,
        stage: s.stageName || "",
        process: s.shortSourceProcessName || baseName(s.sourceProcessPath),
        path: s.sourceProcessPath || "",
        pid: s.processId !== undefined && s.processId !== null ? String(s.processId) : "",
        auxName: s.auxProcessName || "",
        auxPid: s.auxProcessId !== undefined && s.auxProcessId !== null ? String(s.auxProcessId) : "",
        command: s.commandLine || "",
        cert: s.certificateStatus || "",
        bits: s.is64Bit ? "64-bit" : "",
        owner: s.sourceProcessOwner || "",
        time: stageTime(s.timestamp),
        // A stage without a usable stamp sorts LAST (after the real chain),
        // never first: Number(null) is 0 and would float junk above the
        // parent process. NaN strings poison a sort, so they land here too.
        epoch: (s.timestamp === undefined || s.timestamp === null || s.timestamp === "" ||
                isNaN(Number(s.timestamp))) ? Number.POSITIVE_INFINITY : Number(s.timestamp),
        modules: modules
      });
    }
    stages.sort(function (a, b) { return (a.epoch - b.epoch) || (a.index - b.index); });
    return stages;
  }

  // The event header above the rail: where, what platform, when, how often.
  function buildEvent(timeline) {
    if (!timeline) return null;
    return {
      host: timeline.host || "",
      os: timeline.os || "",
      destination: timeline.destination || "",
      remoteIP: timeline.remoteIP || "",
      asn: timeline.asn || "",
      // Same plausibility gate as stages; falls back to the console's own
      // stamp strings when the epochs do not decode to a sane date.
      firstSeen: stageTime(timeline.firstSeenEpoch) || timeline.firstSeen || "",
      lastSeen: stageTime(timeline.lastSeenEpoch) || timeline.lastSeen || "",
      eventCount: timeline.eventCount !== undefined && timeline.eventCount !== null
        ? String(timeline.eventCount) : ""
    };
  }

  var model = {
    parseSourcedata: parseSourcedata,
    extractTimeline: extractTimeline,
    fmtTime: fmtTime,
    stageTime: stageTime,
    baseName: baseName,
    buildStages: buildStages,
    buildEvent: buildEvent
  };

  if (typeof module !== "undefined" && module && module.exports) {
    module.exports = model;            // jest / node
  } else {
    root.fortiedrCommandTimelineModel = model;  // the widget (global attach)
  }
})(typeof window !== "undefined" ? window : this);
