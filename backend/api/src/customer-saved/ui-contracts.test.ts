import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source=async(path:string)=>(await readFile(new URL(`../../../../${path}`,import.meta.url))).toString();
test("Customer menu replaces placeholders with saved/settings navigation and auth-scoped provider",async()=>{
  const app=await source("apps/customer/App.tsx");
  assert.doesNotMatch(app,/Coming soon/);
  assert.match(app,/navigate\("saved"\)/);assert.match(app,/navigate\("settings"\)/);
  assert.match(app,/<SavedItemsProvider key=\{session\.user\.id\}/);
  assert.match(app,/<SavedItemsScreen/);assert.match(app,/<CustomerSettingsScreen/);
});
test("favorites use generated own-customer APIs, revalidate on page entry and never mutate cart",async()=>{
  const context=await source("apps/customer/src/SavedItemsContext.tsx");
  for(const name of ["getCustomerSavedItems","saveCustomerItem","removeCustomerSavedItem"])assert.ok(context.includes(name));
  assert.doesNotMatch(context,/\/cart|checkout|stockQuantity/);
  const saved=await source("apps/customer/src/SavedItemsScreen.tsx");
  assert.match(saved,/load\(pincode\)/);assert.match(saved,/item\.available/);
  assert.match(saved,/onOpenItem\(item\.productId, item\.storeId\)/);
  for(const file of ["ShoppingProductCard.tsx","ShoppingProductDetails.tsx"])assert.match(await source(`apps/customer/src/components/${file}`),/FavoriteControl/);
});
test("settings use existing password fields/policy, clear drafts and never render auth secrets",async()=>{
  const settings=await source("apps/customer/src/CustomerSettingsScreen.tsx");
  assert.match(settings,/getCustomerAccountSettings/);assert.match(settings,/changeCustomerPassword/);
  assert.match(settings,/resetPasswordSchema/);assert.match(settings,/setCurrentPassword\(""\)/);
  assert.match(settings,/confirmPassword/);assert.doesNotMatch(settings,/access_token|refresh_token|password_hash/);
});
test("one shared Vendor image input covers create/edit with preview, same-origin auth and replace",async()=>{
  for(const file of ["VendorNewProductPanel.tsx","CatalogManagementPanel.tsx"])assert.match(await source(`apps/dashboard/src/${file}`),/<VendorProductImageInput/);
  const input=await source("apps/dashboard/src/VendorProductImageInput.tsx");
  for(const text of ["Image URL","Upload Image","Replace","image/webp","same-origin"])assert.ok(input.includes(text),text);
  assert.match(input,/apiAuthorizationHeaders\(token/);assert.match(input,/URL\.revokeObjectURL/);
  assert.doesNotMatch(input,/vendor-documents|PRIVATE_OBJECT_DIR|master-products/);
});
