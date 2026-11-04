# FortiEDR Command Timeline Widget

FortiSOAR View Panel widget for Alerts. Renders the process/cmd command
timeline the `fortinet-fortiedrv2` connector (v1.1.12+) stores on an alert's
`sourcedata` when its **Include Command Timeline** ingestion flag is on --
the same chain the FortiEDR console's event timeline view draws: which
process triggered which, with command lines.

## Files

```
widget/
  info.json                        -- widget manifest (name + version)
  edit.html / edit.controller.js   -- config modal (title, module frames on/off)
  view.html / view.controller.js   -- the rail + states
  widgetAssets/js/timelineModel.js -- pure model (parse/trim->view-model), jest-requireable
  widgetAssets/fixtures/api3/record.json -- NS1 mock-tier fixture (alert with a timeline)
tests/
  timelineModel.test.js            -- pure model rules
  view.controller.test.js          -- controller wiring (record sources, states)
```

## Data contract

Reads `record.sourcedata` (JSON string or object) -> `command_timeline`:

```
{ eventId, host, os, destination, remoteIP, asn, firstSeenEpoch, lastSeenEpoch,
  eventCount,
  stacks: [ { stageName, shortSourceProcessName, sourceProcessPath, processId,
              auxProcessId, certificateStatus, is64Bit, timestamp, commandLine,
              stackEntries: [ { processPath, certificateStatus, isWritable, main } ] } ] }
```

The connector trims this payload (whitelist + recursive null/empty strip), so
the widget assumes present-but-possibly-missing keys and never a null scalar.

Record resolution order (mirrors ztpAutomationGraph's lesson: the page-load
copy can predate the ingestion upsert, and some hosts hand the record only
through the state):

1. `FormEntityService.get()` -- the open record on a SOAR View Panel mount.
2. If that copy shows no timeline but carries an `@id`, one bounded re-read
   of the record (a pull may have rewritten `sourcedata` after the page
   loaded).
3. No record at all: resolve `$state.params.id` + module and read the record
   from the box once.

## States

- `ready` -- event header (host, OS, destination, first/last seen) above a
  chronological rail of stage cards: stage name, process + PID (+ child PID),
  certificate chip, path, the command line, and the module frames each stage
  loaded (toggleable in the config).
- `empty` -- no timeline stored: points the analyst at the ingestion flag.
- `error` -- `sourcedata` present but not readable JSON.
- `no-record` -- nothing loaded.

Stages sort by timestamp ascending; equal stamps keep the console's own
array order (parent stages are stamped identically); a stage with no usable
stamp sorts last, never first.

## Tests

```
make test-unit WIDGET=fortiedrCommandTimeline          # jest (from the dev-kit root)
make test-e2e-spec WIDGET=fortiedrCommandTimeline      # Playwright, mock tier
```
