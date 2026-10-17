// Smoke test for the hospital case-entry form (Section 9).
// Signs in as the demo hospital-staff account from the root .env (DEMO_STAFF_EMAIL/PASSWORD) and
// submits one zero-count row tagged "e2e smoke test", so it doesn't change the illness map.
// Run: npx playwright install chromium   (once)   then   npm run e2e -w @jagasekitar/web
import { expect, test } from '@playwright/test';

const email = process.env.DEMO_STAFF_EMAIL;
const password = process.env.DEMO_STAFF_PASSWORD;

test.skip(!email || !password, 'Set DEMO_STAFF_EMAIL and DEMO_STAFF_PASSWORD in the root .env');

test('staff can sign in and submit a daily report', async ({ page }) => {
  await page.goto('/hospital/report');
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Work email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();

  await page.waitForURL(/\/hospital\/report/);
  await expect(page.getByText('Enter aggregated counts only.')).toBeVisible();

  await page.getByLabel('Disease, row 1').selectOption({ label: 'Conjunctivitis' });
  await page.getByLabel('New confirmed cases, row 1').fill('0');
  await page.getByLabel('Suspected cases, row 1').fill('0');
  await page.getByLabel('Notes, row 1').fill('e2e smoke test');
  await page.getByRole('button', { name: /^Submit 1 row/ }).click();

  await expect(page.getByRole('status')).toContainText('Saved');

  await page.goto('/hospital/history');
  await expect(page.getByText('e2e smoke test').first()).toBeVisible();
});

test('personal data in notes is refused before it reaches the server', async ({ page }) => {
  await page.goto('/login?next=/hospital/report');
  await page.getByLabel('Work email').fill(email!);
  await page.getByLabel('Password').fill(password!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await page.waitForURL(/\/hospital\/report/);

  await page.getByLabel('Disease, row 1').selectOption({ label: 'Conjunctivitis' });
  await page.getByLabel('New confirmed cases, row 1').fill('0');
  await page.getByLabel('Notes, row 1').fill('patient 850101-08-1234');
  await page.getByRole('button', { name: /^Submit 1 row/ }).click();
  await expect(page.getByRole('alert')).toContainText('must not contain IC numbers');
});
