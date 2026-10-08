import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import type { Server } from "node:http";
import pg from "pg";
import { productImageStorage } from "../product-images/storage.js";
import { validateProductImage, MAX_PRODUCT_IMAGE_BYTES } from "../product-images/validation.js";
import { passwordProvider, changePasswordInput } from "../customer-settings/routes.js";
import { vendorProductImageSchema } from "@workspace/validation";

const exec = promisify(execFile);
const postgres = "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
const customerA = randomUUID(), customerB = randomUUID(), vendorA = randomUUID(), vendorB = randomUUID();
const storeA = randomUUID(), storeB = randomUUID(), productA = randomUUID(), productB = randomUUID(), master = randomUUID();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6SsAAAAASUVORK5CYII=", "base64");
const jpeg = Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(20),Buffer.from([255,217])]);
const webp = Buffer.alloc(30); webp.write("RIFF"); webp.writeUInt32LE(22,4); webp.write("WEBPVP8X",8); webp.writeUInt32LE(10,16);
let pool: pg.Pool, server: Server, directory = "", base = "", imageReference = "";
let beforeCommercial: unknown, storageFailure = false, passwordCalls = 0;
const images = new Map<string, { bytes: Buffer; mimeType: string }>();
const provider = { ...productImageStorage }, passwords = { ...passwordProvider }, originalFetch = globalThis.fetch;
before(async () => {
  directory = await mkdtemp(`${tmpdir()}/saved-settings-images-`);
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0,"127.0.0.1",resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const env = { ...process.env, PGHOST:"127.0.0.1", PGUSER:"feature_qa", PGDATABASE:"postgres", PGPORT:String(port) };
  await exec(`${postgres}/initdb`,["-D",`${directory}/data`,"--auth=trust","--no-locale","-U","feature_qa"],{env});
  await exec(`${postgres}/pg_ctl`,["-D",`${directory}/data`,"-l",`${directory}/postgres.log`,"-o",`-h 127.0.0.1 -k ${directory} -p ${port}`,"-w","start"],{env});
  pool = new pg.Pool({host:"127.0.0.1",port,user:"feature_qa",database:"postgres",ssl:false});
  await pool.query(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE postgres SUPERUSER;
    CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations = new URL("../../../../database/migrations/",import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    await pool.query(await readFile(new URL(file,migrations),"utf8"));
  }
  for (const [id,role] of [[customerA,"customer"],[customerB,"customer"],[vendorA,"vendor"],[vendorB,"vendor"]]) {
    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,`${id}@qa.invalid`]);
    if (role === "vendor") {
      await pool.query("UPDATE user_profiles SET role='vendor' WHERE id=$1",[id]);
      await pool.query("DELETE FROM customers WHERE id=$1",[id]);
    } else {
      await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,id===customerA?"shopper_a":"shopper_b"]);
      await pool.query(`INSERT INTO customer_addresses(customer_id,recipient_name,phone,line1,city,state,pincode,is_default)
        VALUES($1,'Test shopper','9876543210','Test address','Hyderabad','Telangana','500090',true)`,[id]);
    }
  }
  for (const [id,owner] of [[storeA,vendorA],[storeB,vendorB]]) {
    await pool.query("INSERT INTO stores(id,owner_user_id,name,status,documents_required) VALUES($1,$2,'Test shop','ACTIVE',false)",[id,owner]);
    await pool.query("INSERT INTO store_service_pincodes(store_id,pincode) VALUES($1,'500090')",[id]);
    await pool.query("INSERT INTO store_operating_hours(store_id,day_of_week,is_closed,opens_at,closes_at) SELECT $1,generate_series(0,6),false,'00:00','23:59'",[id]);
  }
  await pool.query("INSERT INTO master_products(id,name,brand,image,is_active) VALUES($1,'Mapped sample','Canonical','https://example.invalid/master.png',true)",[master]);
  for (const [id,storeId] of [[productA,storeA],[productB,storeB]]) {
    await pool.query("INSERT INTO products(id,store_id,name,brand,price,stock_quantity,is_active) VALUES($1,$2,'Local sample','Local brand',25,12,true)",[id,storeId]);
    await pool.query("INSERT INTO product_variants(product_id,name,quantity_value,quantity_unit,price,stock_quantity) VALUES($1,'One kg',1,'kg',25,12)",[id]);
  }
  beforeCommercial = (await pool.query("SELECT id,price,stock_quantity FROM product_variants ORDER BY id")).rows;
  process.env.SUPABASE_DB_URL = `postgresql://feature_qa@127.0.0.1:${port}/postgres`;
  process.env.SUPABASE_URL = "https://feature-qa.example.invalid"; process.env.SUPABASE_ANON_KEY = "synthetic-key";
  globalThis.fetch = async (input,init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${process.env.SUPABASE_URL}/auth/v1/user`) return originalFetch(input,init);
    const id = new Headers(init?.headers).get("authorization")?.replace("Bearer ","");
    return [customerA,customerB,vendorA,vendorB].some(actor => actor===id)
      ? Response.json({id,email:`${id}@qa.invalid`}) : Response.json({message:"Invalid token"},{status:401});
  };
  productImageStorage.put = async (storeId,imageId,bytes,mimeType) => {
    if (storageFailure) throw Error("Synthetic storage failure");
    images.set(`${storeId}/${imageId}`,{bytes:Buffer.from(bytes),mimeType});
  };
  productImageStorage.get = async (storeId,imageId) => {
    const image = images.get(`${storeId}/${imageId}`); if (!image) throw Error("Missing image"); return image;
  };
  productImageStorage.discard = async (storeId,imageId) => { images.delete(`${storeId}/${imageId}`); };
  passwordProvider.change = async (id,email,current,next) => {
    passwordCalls++; assert.equal(id,customerA); assert.ok(email.endsWith("@qa.invalid"));
    if (current !== "synthetic-current") { const {HttpError} = await import("../http.js"); throw new HttpError(400,"Current password is incorrect."); }
    assert.equal(next,"synthetic-new-password");
  };
  const {createApp} = await import("../app.js");
  server = createApp().listen(0,"127.0.0.1");
  await new Promise<void>(resolve => server.once("listening",resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
after(async () => {
  globalThis.fetch = originalFetch; Object.assign(productImageStorage,provider); Object.assign(passwordProvider,passwords);
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (pool) { const {getPool} = await import("@workspace/db"); await getPool().end(); await pool.end(); }
  if (directory) { await exec(`${postgres}/pg_ctl`,["-D",`${directory}/data`,"-m","immediate","-w","stop"]); await rm(directory,{recursive:true,force:true}); }
});
type QAResponse = Omit<Response,"json"> & {json():Promise<any>};
async function request(actor:string|null,path:string,method="GET",body?:unknown):Promise<QAResponse> {
  return originalFetch(base+path,{method,headers:{"Content-Type":"application/json",...(actor?{Authorization:`Bearer ${actor}`}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function upload(actor:string,bytes:Buffer,mime:string,fileName:string,productId?:string):Promise<QAResponse> {
  return originalFetch(base+`/api/vendor/product-images?fileName=${encodeURIComponent(fileName)}${productId?`&productId=${productId}`:""}`,
    {method:"POST",headers:{Authorization:`Bearer ${actor}`,"Content-Type":mime},body:new Uint8Array(bytes)});
}
test("saved items enforce roles and own address, accept repeated saves without duplicate records",async () => {
  assert.equal((await request(null,"/api/customer/saved-items")).status,401);
  assert.equal((await request(vendorA,"/api/customer/saved-items")).status,403);
  assert.equal((await request(customerA,"/api/customer/saved-items")).status,200);
  assert.equal((await request(customerA,"/api/customer/saved-items","POST",{productId:productA,pincode:"999999"})).status,404);
  assert.equal((await request(customerA,"/api/customer/saved-items","POST",{productId:productA,pincode:"500090",customerId:customerB})).status,400);
  assert.equal((await request(customerA,"/api/customer/saved-items","POST",{productId:productA,pincode:"500090"})).status,201);
  assert.equal((await request(customerA,"/api/customer/saved-items","POST",{productId:productA,pincode:"500090"})).status,200);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM customer_saved_items")).rows[0].n,1);
});
test("favorites persist via readback, use current price/units/store/brand, and never reserve inventory or cart",async () => {
  const result = await (await request(customerA,"/api/customer/saved-items?pincode=500090")).json();
  assert.equal(result.items.length,1); const item=result.items[0];
  assert.equal(item.productId,productA); assert.equal(item.storeId,storeA); assert.equal(item.available,true);
  assert.equal(item.product.brand,"Local brand"); assert.equal(item.product.variants[0].price,"25.00");
  assert.equal(item.product.variants[0].quantityUnit,"kg");
  assert.ok(!JSON.stringify(item).includes("stockQuantity"));
  assert.deepEqual((await pool.query("SELECT id,price,stock_quantity FROM product_variants ORDER BY id")).rows,beforeCommercial);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM carts")).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM orders")).rows[0].n,0);
});
test("different-store listings stay distinct; customer B cannot read/delete A favorite; direct SQL is denied",async () => {
  await pool.query("UPDATE products SET master_product_id=$1 WHERE id IN ($2,$3)",[master,productA,productB]);
  assert.equal((await request(customerA,"/api/customer/saved-items","POST",{productId:productB,pincode:"500090"})).status,201);
  assert.equal((await (await request(customerB,"/api/customer/saved-items")).json()).items.length,0);
  assert.equal((await request(customerB,`/api/customer/saved-items/${productA}`,"DELETE")).status,204);
  assert.equal((await (await request(customerA,"/api/customer/saved-items?pincode=500090")).json()).items.length,2);
  await pool.query("UPDATE product_variants SET price=28 WHERE product_id=$1",[productB]);
  const changed=(await (await request(customerA,"/api/customer/saved-items?pincode=500090")).json()).items;
  assert.equal(changed.find((item:any)=>item.productId===productB).product.variants[0].price,"28.00");
  assert.equal(changed.filter((item:any)=>item.product.name==="Mapped sample").length,2);
  await pool.query("UPDATE product_variants SET price=25 WHERE product_id=$1",[productB]);
  const client=await pool.connect();
  try { await client.query("SET ROLE authenticated"); await assert.rejects(client.query("SELECT * FROM customer_saved_items"),{code:"42501"}); }
  finally { await client.query("RESET ROLE"); client.release(); }
});
test("unavailable saved items remain removable; no address does not discard favorites",async () => {
  await pool.query("UPDATE products SET availability=false WHERE id=$1",[productA]);
  const item=(await (await request(customerA,"/api/customer/saved-items?pincode=500090")).json()).items.find((i:any)=>i.productId===productA);
  assert.equal(item.available,false); assert.ok(item.unavailableReason);
  assert.equal((await (await request(customerA,"/api/customer/saved-items")).json()).items.length,2);
  await pool.query("UPDATE products SET availability=true WHERE id=$1",[productA]);
  assert.equal((await request(customerA,`/api/customer/saved-items/${productA}`,"DELETE")).status,204);
  assert.equal((await (await request(customerA,"/api/customer/saved-items")).json()).items.length,1);
});
test("settings expose only safe fields and mask recovery email; profile edits reuse existing endpoint",async () => {
  assert.equal((await request(null,"/api/customer/account-settings")).status,401);
  assert.equal((await request(vendorA,"/api/customer/account-settings")).status,403);
  const result=await (await request(customerA,"/api/customer/account-settings")).json();
  assert.deepEqual(Object.keys(result.account).sort(),["fullName","phone","registeredEmail","username"]);
  assert.equal(result.account.username,"shopper_a"); assert.ok(result.account.registeredEmail.includes("***"));
  assert.ok(!JSON.stringify(result).includes(customerA));
  assert.equal((await request(customerA,"/api/customer/profile","PATCH",{fullName:"Updated synthetic shopper",phone:"9876543210"})).status,200);
  assert.equal((await (await request(customerA,"/api/customer/account-settings")).json()).account.fullName,"Updated synthetic shopper");
});
test("password change verifies current password, confirmation and existing policy without returning auth secrets",async () => {
  const input={currentPassword:"synthetic-current",newPassword:"synthetic-new-password",confirmPassword:"synthetic-new-password"};
  assert.equal((await request(customerA,"/api/customer/account-settings/password","POST",{...input,newPassword:"short",confirmPassword:"short"})).status,400);
  assert.equal((await request(customerA,"/api/customer/account-settings/password","POST",{...input,confirmPassword:"different-password"})).status,400);
  assert.equal(passwordCalls,0);
  assert.equal((await request(customerA,"/api/customer/account-settings/password","POST",{...input,currentPassword:"wrong"})).status,400);
  const changed=await request(customerA,"/api/customer/account-settings/password","POST",input);
  assert.equal(changed.status,200); assert.deepEqual(Object.keys(await changed.json()),["message"]); assert.equal(passwordCalls,2);
  assert.equal(changePasswordInput.safeParse({...input,userId:customerB}).success,false);
});
test("image URL schema rejects unsafe schemes/userinfo, and ownership rejects other-store managed images",async () => {
  assert.equal(vendorProductImageSchema.safeParse("https://example.invalid/image.webp").success,true);
  assert.equal((await request(vendorB,`/api/vendor/products/${productB}`,"PATCH",{imageUrl:"https://example.invalid/image.webp"})).status,200);
  const external=await (await request(customerA,`/api/customer/stores/${storeB}/products/${productB}?pincode=500090`)).json();
  assert.equal(external.product.imageUrl,"https://example.invalid/image.webp");
  for (const url of ["javascript:alert(1)","data:image/png;base64,a","not a URL","https://user:pass@example.invalid/image.png"]) {
    assert.equal(vendorProductImageSchema.safeParse(url).success,false);
    assert.equal((await request(vendorA,`/api/vendor/products/${productA}`,"PATCH",{imageUrl:url})).status,400);
  }
  assert.equal((await request(vendorA,`/api/vendor/products/${productA}`,"PATCH",{imageUrl:`/api/product-images/${storeB}/${randomUUID()}`})).status,403);
});
test("JPEG/PNG/WebP are accepted; invalid MIME/content/extension, empty, executable and oversize rejected",async () => {
  for (const [bytes,mime,name] of [[jpeg,"image/jpeg","sample.jpeg"],[png,"image/png","sample.png"],[webp,"image/webp","sample.webp"]] as const) {
    validateProductImage(name,mime,bytes);
    assert.equal((await upload(vendorA,bytes,mime,name)).status,201);
  }
  for (const [bytes,mime,name] of [[png,"image/png","bad.exe"],[png,"image/jpeg","bad.png"],[Buffer.from("html"),"image/png","bad.png"],[Buffer.alloc(0),"image/png","bad.png"]] as const) {
    assert.equal((await upload(vendorA,bytes,mime,name)).status,400);
  }
  assert.equal((await upload(vendorA,Buffer.alloc(MAX_PRODUCT_IMAGE_BYTES+1),"image/png","large.png")).status,413);
});
test("image upload isolates ownership; bytes unavailable before publish except to owner; failure does not change listing",async () => {
  assert.equal((await upload(customerA,png,"image/png","sample.png")).status,403);
  assert.equal((await upload(vendorA,png,"image/png","sample.png",productB)).status,404);
  const uploaded=await upload(vendorA,png,"image/png","sample.png",productA); assert.equal(uploaded.status,201);
  imageReference=(await uploaded.json()).imageUrl;
  assert.ok(imageReference.startsWith(`/api/product-images/${storeA}/`));
  assert.ok(!imageReference.includes("bucket"));
  assert.equal((await request(vendorB,imageReference)).status,404);
  assert.equal((await request(customerA,imageReference)).status,403);
  assert.equal((await request(null,imageReference)).status,401);
  assert.equal((await request(vendorA,imageReference)).status,200);
  storageFailure=true;
  assert.equal((await upload(vendorA,png,"image/png","sample.png",productA)).status,503);
  storageFailure=false;
  assert.equal((await pool.query("SELECT image_url FROM products WHERE id=$1",[productA])).rows[0].image_url,null);
});
test("own image saves to existing listing field; Customer catalog sees image; Master canonical image unchanged",async () => {
  assert.equal((await request(vendorA,`/api/vendor/products/${productA}`,"PATCH",{imageUrl:imageReference})).status,200);
  assert.equal((await request(vendorB,`/api/vendor/products/${productA}`,"PATCH",{imageUrl:imageReference})).status,403);
  const catalog=await (await request(customerA,`/api/customer/stores/${storeA}/products/${productA}?pincode=500090`)).json();
  assert.equal(catalog.product.imageUrl,imageReference);
  const bytes=await request(null,imageReference); assert.equal(bytes.status,200);
  assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),png); assert.equal(bytes.headers.get("content-type"),"image/png");
  assert.equal((await pool.query("SELECT image FROM master_products WHERE id=$1",[master])).rows[0].image,"https://example.invalid/master.png");
  await pool.query("UPDATE products SET is_active=false WHERE id=$1",[productA]);
  assert.equal((await request(customerA,imageReference)).status,403);
  assert.equal((await request(vendorA,imageReference)).status,200);
  await pool.query("UPDATE products SET is_active=true WHERE id=$1",[productA]);
});
test("uploaded reference works in new store-local product creation without Master writes",async () => {
  const created=await request(vendorA,"/api/vendor/products","POST",{
    name:"Unique new image listing",brand:"Synthetic new",price:30,imageUrl:imageReference,
    variants:[{quantityValue:1,quantityUnit:"pack",price:30,stockQuantity:4,availability:true,isActive:true}],
  });
  assert.equal(created.status,201); assert.equal((await created.json()).product.imageUrl,imageReference);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM master_products")).rows[0].n,1);
  assert.equal((await pool.query("SELECT count(*)::integer n FROM vendor_documents")).rows[0].n,0);
  assert.deepEqual((await pool.query("SELECT id,price,stock_quantity FROM product_variants WHERE product_id IN ($1,$2) ORDER BY id",[productA,productB])).rows,beforeCommercial);
});
