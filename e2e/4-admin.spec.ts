// Admin journeys: the admin account (COMICHUDDLE_ADMIN_EMAILS on the test server) sees and uses the admin pages.
import {test,expect,open,signedInAs} from './fixtures';

test.describe('admin',()=>{
 signedInAs('admin');
 test('admin overview opens with every admin section',async({page})=>{
  await open(page,'/admin');
  for(const name of [/overview/i,/safepurchase/i,/cover photos/i,/emails/i,/audit log/i])await expect(page.getByRole('link',{name}).first()).toBeVisible();
 });
 test('cover photo review opens',async({page})=>{
  const response=await open(page,'/admin/covers');
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole('heading',{level:1})).toContainText(/cover/i);
 });
 test('email previews show every customer email with Huddles',async({page})=>{
  await open(page,'/admin/emails');
  const frames=page.locator('iframe');
  await expect(frames).toHaveCount(5);
  const receipt=page.frameLocator('iframe').first();
  await expect(receipt.getByText(/it’s yours/i)).toBeVisible();
  await expect(receipt.locator('img[alt*="Huddles"]')).toBeVisible();
  await expect(page.getByText(/sending is off until an email service is connected|go out automatically/i)).toBeVisible();
 });
 test('audit log opens',async({page})=>{
  const response=await open(page,'/admin/audit');
  expect(response?.status()).toBeLessThan(400);
 });
});
