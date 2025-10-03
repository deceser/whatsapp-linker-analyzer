import { chromium, Page } from 'playwright';

/**
 * Launches a headless Chromium instance and walks through the
 * WhatsApp Web "log in with phone number" flow.  The script
 * automatically selects the specified country and fills in the
 * phone number, then waits until WhatsApp displays the six‑digit
 * linking code on screen.  Once the code is visible, it is
 * extracted and printed to stdout.
 *
 * To run this script you will need to install Playwright:
 *   npm install playwright
 *   npx playwright install
 *
 * Provide your WhatsApp E.164 number and country name via
 * environment variables when invoking the script.  For example:
 *   WA_PHONE=501234567 WA_COUNTRY="Israel" ts-node wa_link_code.ts
 *
 * The WA_PHONE should contain only digits (no plus sign or
 * spaces); the WA_COUNTRY should match the country name as it
 * appears in WhatsApp’s country selector.
 */
async function requestLinkCode() {
  const phone = process.env.WA_PHONE;
  const country = process.env.WA_COUNTRY;
  if (!phone || !country) {
    throw new Error(
      'Both WA_PHONE and WA_COUNTRY environment variables are required. WA_PHONE must contain only digits, and WA_COUNTRY should be a country name as displayed in WhatsApp.'
    );
  }

  // Launch Chromium.  Use headless mode so no UI appears.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to WhatsApp Web and wait for the page to load.
  await page.goto('https://web.whatsapp.com');
  // Wait until the "Log in with phone number" link is visible.
  await page.waitForSelector('text=Log in with phone number', { timeout: 60000 });

  // Click the link to bring up the phone number form.
  await page.locator('text=Log in with phone number').click();

  // Wait for the country selector to appear.  The selector has an
  // aria-haspopup property of listbox on the button element.  When
  // clicked, a search field is displayed allowing you to filter countries.
  const countryButton = page.locator('button[aria-haspopup="listbox"]');
  await countryButton.waitFor({ timeout: 30000 });
  await countryButton.click();

  // Within the opened list, there is an input box to search for a country.
  // Type the desired country name and press Enter to select it.
  const countrySearch = page.locator('input[role="combobox"]');
  await countrySearch.fill(country);
  // A slight delay gives the list time to update.
  await page.waitForTimeout(500);
  // Click the first entry in the filtered list to select the country.
  // This selector targets the listbox option that contains the
  // country name.  Adjust if WhatsApp changes its markup.
  await page.locator(`div[role="option"]:text-is("${country}")`).click();

  // Locate the phone number input (it has type="tel").  Fill it with
  // the user’s number (excluding the country code) and blur the field
  // to ensure validation runs.
  const phoneInput = page.locator('input[type="tel"]');
  await phoneInput.fill(phone);
  await phoneInput.blur();

  // Click the "Next" button to submit the phone number.  WhatsApp
  // validates the number and, if valid, proceeds to show a confirm
  // dialog followed by the linking code.
  await page.locator('button:has-text("Next")').click();

  // Wait for the confirm dialog to appear and click "Next" again to
  // confirm the number.  The dialog usually contains the text
  // "Confirm phone number" and has a secondary button labelled "Next".
  // If WhatsApp skips the confirmation dialog, these calls will
  // time out gracefully and the code will proceed.
  try {
    await page.locator('text=Confirm phone number').waitFor({ timeout: 15000 });
    await page.locator('button:has-text("Next")').click();
  } catch {
    // No confirm dialog appeared; continue.
  }

  // The next screen shows a six‑digit code.  Wait until it
  // appears, then extract the text.  WhatsApp labels the code
  // container with aria-label="code"; adjust this selector if it
  // changes.
  await page.waitForSelector('div[aria-label="code"]', { timeout: 60000 });
  const codeText = await page.locator('div[aria-label="code"]').textContent();
  if (!codeText) {
    console.error('Could not extract code');
  } else {
    // The code may include spaces between digits (e.g. "1 2 3 4 5 6").
    const digits = codeText.replace(/\D+/g, '').trim();
    console.log(`Your WhatsApp linking code is: ${digits}`);
  }

  // Close the browser when done.
  await browser.close();
}

requestLinkCode().catch(err => {
  console.error(err);
  process.exit(1);
});