// Live check of the FortiEDR Command Timeline widget (Story / Graph) and the
// alert card above it, on a real alert. Not a doc chapter: assertions only plus
// a few screenshots for review. ALERT_ID is the alert uuid to open.
import { expect, test, ngGo, waitForAngular } from 'docubot';

test.describe.configure({ mode: 'serial' });

const ALERT_ID = process.env.ALERT_ID || '';
// Stage times and record ids are content here. IPs are masked in the picture (maskText);
// a target shot scans raw element text, so the ip-address text scan is skipped and the
// OCR gate checks the saved PNG instead (same pairing as the kit's labDetailShot).
const SKIP = ['date-or-time', 'key-like-token', 'ip-address'];
// Every IP is masked in a saved picture, public ones included.
const IP = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/;

// Each test gets a fresh page: open the alert and wait for the widget.
async function openAlert(page: import('@playwright/test').Page) {
  await ngGo(page, 'viewPanel.modulesDetail', { module: 'alerts', id: ALERT_ID });
  await waitForAngular(page);
  const root = page.getByTestId('fortiedr-command-timeline-root');
  await root.scrollIntoViewIfNeeded();
  await expect(root).toBeVisible({ timeout: 30_000 });
  return root;
}

test('command timeline story renders and does not repeat the alert card', async ({ gui, capture }) => {
  test.skip(!ALERT_ID, 'ALERT_ID not set');
  const page = await gui('soar');
  const root = await openAlert(page);
  await expect(page.getByTestId('fortiedr-command-timeline-story')).toBeVisible();
  await expect(page.getByTestId('fortiedr-command-timeline-narrative')).toContainText('started a chain of');

  // Header: stats only. Host / destination / times belong to the alert card.
  const head = page.getByTestId('fortiedr-command-timeline-event');
  await expect(head).toContainText('processes');
  const headText = (await head.innerText()).replace(/\s+/g, ' ');
  expect(headText).not.toMatch(/\bHost\b/);
  expect(headText).not.toMatch(/\bTo\b\s+\d/);
  expect(headText).not.toMatch(/\d{2}-[A-Z][a-z]{2}-\d{4}/);

  // The lead-in folds the ancestry; the activity step and net host are shown.
  await expect(page.getByTestId('fortiedr-command-timeline-lead')).toBeVisible();
  const folded = await page.getByTestId('fortiedr-command-timeline-step').count();
  await page.getByTestId('fortiedr-command-timeline-lead').locator('button').click();
  expect(await page.getByTestId('fortiedr-command-timeline-step').count()).toBeGreaterThan(folded);
  await expect(page.locator('.fctl-step-activity').first()).toBeVisible();
  await expect(page.locator('.fctl-tok-sock').first()).toBeVisible();
  await expect(page.getByTestId('fortiedr-command-timeline-net-facts')).toBeVisible();

  await capture.shot(page, 'wc-01-story', { scrubSkip: SKIP, maskText: [IP], target: root });

  // Inline detail opens and shows no repeated process name line.
  await page.getByTestId('fortiedr-command-timeline-step').nth(1).click();
  await expect(page.getByTestId('fortiedr-command-timeline-detail').first()).toBeVisible();
  await capture.shot(page, 'wc-02-story-detail', { scrubSkip: SKIP, maskText: [IP], target: root });
});

test('graph tab mounts the canvas and returns to the story', async ({ gui, capture }) => {
  test.skip(!ALERT_ID, 'ALERT_ID not set');
  const page = await gui('soar');
  await openAlert(page);
  await page.getByTestId('fortiedr-command-timeline-tab-graph').click();
  await expect(page.locator('#fctl-cy canvas').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('fortiedr-command-timeline-legend')).toBeVisible();
  // No picture: the canvas draws the destination IP, which text masks cannot reach.
  await page.getByTestId('fortiedr-command-timeline-tab-story').click();
  await expect(page.getByTestId('fortiedr-command-timeline-story')).toBeVisible();
});

test('alert card: report which generation of the card this alert carries', async ({ gui }) => {
  test.skip(!ALERT_ID, 'ALERT_ID not set');
  const page = await gui('soar');
  await openAlert(page);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  // The old card ends its table with a Last seen row and an Action row; the new tiles card has neither.
  const newCard = !/\bLAST SEEN\b/i.test(body) && /\bDEVICE IP\b/i.test(body);
  const oldRows = /THREAT NAME\s+Unknown/i.test(body);
  test.info().annotations.push({ type: 'card', description: newCard ? 'new card (tiles)' : 'old card (connector not installed / alert not re-ingested)' });
  console.log(`CARD: ${newCard ? 'new tiles card' : 'old table card'}; placeholder threat rows: ${oldRows}`);
  if (newCard) expect(oldRows).toBe(false);
});
