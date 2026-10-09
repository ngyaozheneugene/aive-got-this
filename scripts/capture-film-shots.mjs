#!/usr/bin/env node
// Captures the desk screens for the launch film, following docs/demo-script.md (sections 3–8)
// on the sample day. Runs against the hosted box by default; nothing touches a real workspace.
//
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/capture-film-shots.mjs                     # hosted box
//   BASE_URL=http://localhost:3000 node scripts/capture-film-shots.mjs
//
// It resets the sample day before and after, so don't run it while someone is demoing.
// Screenshots (2x) and click positions (boxes.json) go to ~/Desktop/dispatch-film-shots.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'https://54.179.142.4.sslip.io').replace(/\/$/, '');
const desktop = path.join(os.homedir(), 'Desktop');
const OUT = process.env.OUT_DIR || path.join(fs.existsSync(desktop) ? desktop : process.cwd(), 'dispatch-film-shots');
fs.mkdirSync(OUT, { recursive: true });
const MODEL_WAIT = +(process.env.MODEL_WAIT || 120_000);

const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) throw new Error(`No desk at ${BASE}.`);
if (!health.optimizer?.ok) console.warn('! Optimizer not connected.');
if (!health.gatewayConfigured) console.warn('! Gateway not configured: the language steps will fail.');

const resetSample = () => fetch(`${BASE}/api/demo/reset`, { method: 'POST', headers: { 'x-workspace': 'simulation' } });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 920 }, deviceScaleFactor: 2 });
const boxes = {};
const failed = [];
const text = () => page.evaluate(() => document.body.innerText);
const waitFor = async (re, ms = MODEL_WAIT) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(await text())) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`Timed out waiting for ${re}`);
};
const tilesSettled = async () => {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('img.leaflet-tile')].every((t) => t.complete), null, { timeout: 10_000 }).catch(() => {});
};
const shot = async (name, wait = 900) => {
  await page.waitForTimeout(wait);
  await tilesSettled();
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('saved', name);
};
// Record where a click lands (for the film's cursor), then click.
const click = async (name, locator) => {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const r = await locator.boundingBox();
  if (r) boxes[name] = [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
  await locator.click();
};
const section = async (name, fn) => {
  try { await fn(); } catch (e) {
    failed.push(name);
    console.warn(`! ${name} failed: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: path.join(OUT, `error_${name}.png`) }).catch(() => {});
  }
};
const nav = async (label) => {
  await page.getByRole('link', { name: label, exact: true }).first().click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
};
const closeDemo = async () => {
  if (/Make this happen/.test(await text())) await page.getByRole('button', { name: 'Demo controls' }).click();
};
const report = async (name, example) => {
  await click(name, page.getByText(example, { exact: true }).first());
  await page.getByRole('textbox', { name: 'What happened?' }).press('Enter');
};
const version = async () => Number((await text()).match(/Schedule version (\d+)/)?.[1] ?? 0);
const approve = async (prefix) => {
  const next = (await version()) + 1;
  const reason = page.getByText('Matches what I know on the ground.').first();
  await click(`${prefix}_reason`, reason);
  await shot(`${prefix}_reason`, 500);
  await click(`${prefix}_approve`, page.getByText('Approve & update schedule'));
  await waitFor(new RegExp(`Schedule version ${next}\\b`));
};

try {
  await resetSample();
  await page.goto(`${BASE}/desk?mode=simulation`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
  await page.waitForTimeout(2500);
  await closeDemo();
  await shot('01_dispatch', 1500);

  await section('team', async () => {
    await nav('Team');
    await shot('02_team');
    await nav('Settings');
    await shot('03_settings');
    await nav('Dispatch');
    await closeDemo();
  });

  // 3. Ask a question
  await section('ask', async () => {
    await report('ask_example', 'Who’s free at 3pm for a water leak?');
    await shot('04_asking', 400);
    await waitFor(/Based on/);
    await shot('05_answer', 1200);
    await click('ask_done', page.getByRole('button', { name: 'Done', exact: true }).first());
  });

  // 4. Kumar's van
  await section('kumar', async () => {
    await report('kumar_example', 'Kumar’s van broke down, he’s out till 2pm');
    await waitFor(/I read that as/);
    await shot('06_read_as', 1000);
    await click('kumar_find', page.getByRole('button', { name: 'Find options' }).first());
    await shot('07_finding', 1500);
    await waitFor(/Approve & update schedule/);
    await shot('08_kumar_plans', 1500);
    await approve('09_kumar');
    await shot('10_kumar_done', 900);
    const how = page.getByText('How the assistant worked this out').first();
    await click('kumar_trace', how);
    await shot('11_trace', 1500);
    await how.click().catch(() => {});
  });

  // 5. New work arrives in bulk
  await section('import', async () => {
    await nav('Jobs');
    await shot('12_jobs');
    await click('import_open', page.getByRole('button', { name: 'Import jobs' }).first());
    await page.waitForTimeout(800);
    await click('import_messy', page.getByText('Messy work orders').first());
    await waitFor(/ready/i);
    await shot('13_import_read', 1500);
    await click('import_book', page.getByRole('button', { name: /^Book \d+ jobs?$/ }).first());
    await waitFor(/46 booked/);
    await shot('14_jobs_booked', 1200);
  });

  // 6. Plan everything at once
  await section('planall', async () => {
    await nav('Dispatch');
    await closeDemo();
    await click('planall_btn', page.getByRole('button', { name: /^Plan all \d+$/ }).first());
    await shot('15_planall_finding', 1500);
    await waitFor(/Approve & update schedule/);
    await shot('16_planall_plans', 1500);
    const waiting = page.getByText(/jobs? stays? waiting|stay waiting/i).first();
    await waiting.scrollIntoViewIfNeeded().catch(() => {});
    await shot('17_planall_waiting', 700);
    await approve('18_planall');
    await shot('19_planall_done', 900);
  });

  // 7. Mei unavailable: partial coverage
  await section('mei', async () => {
    await click('mei_expand', page.getByRole('button', { name: 'Show Mei’s stops' }));
    await click('mei_mark', page.getByRole('button', { name: 'Mark Mei unavailable' }));
    await click('mei_day', page.getByRole('radio', { name: 'Rest of today' }));
    await shot('20_mei_form', 500);
    await click('mei_send', page.getByRole('button', { name: 'Send', exact: true }).last());
    await waitFor(/Approve & update schedule/);
    await shot('21_mei_plans', 1500);
    const call = page.getByText(/left for a call/i).first();
    await call.scrollIntoViewIfNeeded().catch(() => {});
    await shot('22_mei_call', 700);
    await approve('23_mei');
    await shot('24_mei_done', 900);
  });

  // 8. Close: today's events
  await section('events', async () => {
    await click('events_open', page.getByRole('button', { name: 'Today’s events' }).first());
    await shot('25_events', 1200);
  });

  fs.writeFileSync(path.join(OUT, 'boxes.json'), JSON.stringify(boxes, null, 1));
  console.log(`\nDone: ${fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length} screenshots in ${OUT}`);
  if (failed.length) console.log(`Sections that failed: ${failed.join(', ')} (see error_*.png)`);
} finally {
  await browser.close();
  await resetSample().catch(() => {});
}
