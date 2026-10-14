import assert from "node:assert/strict";
import { before,after,test } from "node:test";
import { execFile,spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp,readFile,readdir,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createApp } from "../app.js";
import { getPool } from "@workspace/db";
import { bankDetailsInput } from "../vendor-documents/bank-details.js";
import { documentStorage } from "../vendor-documents/storage.js";
import { pickupPhotoStorage } from "../delivery-partner/photos.js";
import { orderReportRows,dailyReportRows } from "./reports.js";
import { dailyBounds,indiaDate,orderDateBounds } from "./report-dates.js";
import type { Server } from "node:http";

const exec = promisify(execFile), binary = "/nix/store/269nimkimaaivb4z46bjc1rnjv9jpc0l-postgresql-17.6/bin";
const admin=randomUUID(),customer=randomUUID(),vendorA=randomUUID(),vendorB=randomUUID(),partnerA=randomUUID(),partnerB=randomUUID();
const storeA=randomUUID(),storeB=randomUUID(),productA=randomUUID(),productB=randomUUID(),oldOrder=randomUUID(),oldAssignment=randomUUID();
const roles = new Map<string,string>([[admin,"admin"],[customer,"customer"],[vendorA,"vendor"],[vendorB,"vendor"],[partnerA,"delivery_partner"],[partnerB,"delivery_partner"]]);
const originalFetch=globalThis.fetch;
type FixtureResponse=Omit<Awaited<ReturnType<typeof originalFetch>>,"json"> & {json():Promise<any>};
let pool:pg.Pool,server:Server,dir:string,base:string,readyOrder:string,assignment:string,winner:string,loser:string;
let failStorage=false;
const objects=new Map<string,Buffer>();
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZAAAAABJRU5ErkJggg==","base64");
const bank={accountHolderName:"Fixture Vendor",accountNumber:"00123456789012",ifsc:"SBIN0001234",bankName:"Fixture Bank",bankBranch:"Hyderabad",vendorMobileNumber:"9876543210"};
async function call(path:string,actor?:string,body?:unknown,method?:string) {
  return await originalFetch(`${base}${path}`,{method:method ?? (body===undefined?"GET":"POST"),
    headers:{...(actor?{Authorization:`Bearer fixture-${actor}`} : {}),...(body!==undefined?{"Content-Type":"application/json"}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})}) as FixtureResponse;
}
async function upload(path:string,actor:string,bytes=png) {
  return await originalFetch(`${base}${path}?fileName=fixture.png&capturedAt=${encodeURIComponent(new Date().toISOString())}`,
    {method:"POST",headers:{Authorization:`Bearer fixture-${actor}`,"Content-Type":"image/png"},body:new Uint8Array(bytes)}) as FixtureResponse;
}
async function makeOrder(store:string,status="PLACED",at=new Date().toISOString()) {
  const id=randomUUID();
  await pool.query(`INSERT INTO orders(id,customer_id,store_id,status,subtotal,delivery_fee_snapshot,handling_fee_snapshot,total_amount,
    delivery_contact_name,delivery_contact_phone,delivery_address_snapshot,created_at)
    VALUES($1,$2,$3,$4,70,7.50,2.50,80,'Fixture Customer','9876543210',
      '{"line1":"Flat 302, Fixture Street","city":"Hyderabad","state":"Telangana","pincode":"500090"}',$5)`,[id,customer,store,status,at]);
  await pool.query(`INSERT INTO order_items(order_id,product_id,product_name_snapshot,product_price_snapshot,quantity,subtotal,
    variant_name_snapshot,variant_quantity_value_snapshot,variant_quantity_unit_snapshot)
    VALUES($1,$2,'Fixture Rice',35,2,70,'One kilogram',1,'kg')`,[id,store===storeA?productA:productB]);
  return id;
}
async function pdfText(bytes:Buffer) {
  return new Promise<string>((resolve,reject)=>{
    const child=spawn("pdftotext",["-","-"]),chunks:Buffer[]=[];
    child.stdout.on("data",chunk=>chunks.push(chunk));child.on("error",reject);
    child.on("close",code=>code===0?resolve(Buffer.concat(chunks).toString()):reject(new Error(`pdftotext: ${code}`)));
    child.stdin.end(bytes);
  });
}
before(async()=>{
  dir=await mkdtemp(`${tmpdir()}/marketplace-enhancements-`);
  const socket=net.createServer();await new Promise<void>(r=>socket.listen(0,"127.0.0.1",r));
  const port=(socket.address() as net.AddressInfo).port;await new Promise<void>(r=>socket.close(()=>r()));
  await exec(`${binary}/initdb`,["-D",`${dir}/data`,"--auth=trust","--no-locale","-U","fixture"]);
  await exec(`${binary}/pg_ctl`,["-D",`${dir}/data`,"-l",`${dir}/postgres.log`,"-o",`-h 127.0.0.1 -k ${dir} -p ${port}`,"-w","start"]);
  pool=new pg.Pool({host:"127.0.0.1",port,database:"postgres",user:"fixture",ssl:false});
  await pool.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE postgres SUPERUSER;
    CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  const migrations=new URL("../../../../database/migrations/",import.meta.url);
  for(const file of (await readdir(migrations)).filter(f=>/^\d.*\.sql$/.test(f) && !["0024","0025"].some(prefix => f.startsWith(prefix))).sort())
    await pool.query(await readFile(new URL(file,migrations),"utf8"));
  for(const [id,role] of roles){
    await pool.query("INSERT INTO auth.users(id,email) VALUES($1,$2)",[id,`${role}_${id.slice(0,8)}@fixture.invalid`]);
    await pool.query("UPDATE user_profiles SET role=$2::app_role WHERE id=$1",[id,role]);
    if(role!=="customer")await pool.query("DELETE FROM customers WHERE id=$1",[id]);
  }
  for(const [id,vendor] of [[storeA,vendorA],[storeB,vendorB]])
    await pool.query("INSERT INTO stores(id,owner_user_id,name,status,documents_required) VALUES($1,$2,$3,'ACTIVE',false)",[id,vendor,`Fixture Store ${id}`]);
  for(const [id,store] of [[productA,storeA],[productB,storeB]])
    await pool.query("INSERT INTO products(id,store_id,name,price,stock_quantity,availability) VALUES($1,$2,'Fixture Rice',35,12,true)",[id,store]);
  for(const id of [partnerA,partnerB]){
    await pool.query("INSERT INTO delivery_partner_profiles(user_id,display_name,status) VALUES($1,'Fixture Partner','ACTIVE')",[id]);
    await pool.query("INSERT INTO identity_usernames(user_id,normalized_username) VALUES($1,$2)",[id,`partner_${id.slice(0,8)}`]);
  }
  await pool.query(`INSERT INTO orders(id,customer_id,store_id,status,subtotal,delivery_fee_snapshot,total_amount,delivery_contact_name,
    delivery_contact_phone,delivery_address_snapshot) VALUES($1,$2,$3,'READY',70,0,70,'Existing','9876543210','{}')`,[oldOrder,customer,storeA]);
  await pool.query(`INSERT INTO delivery_assignments(id,order_id,partner_user_id,status,assigned_at,accepted_at,picked_up_at)
    VALUES($1,$2,$3,'PICKED_UP',now()-interval '3 hours',now()-interval '2 hours',now()-interval '1 hour')`,[oldAssignment,oldOrder,partnerA]);
  await pool.query(await readFile(new URL("0024_vendor_compliance_and_delivery_photos.sql",migrations),"utf8"));
  await pool.query(await readFile(new URL("0025_fssai_expiry_and_vendor_notifications.sql",migrations),"utf8"));
  // Even a broader hypothetical column grant must not bypass the Vendor policy.
  await pool.query("GRANT SELECT(id,delivery_fee,handling_fee) ON stores TO authenticated");
  process.env.SUPABASE_DB_URL=`postgresql://fixture@127.0.0.1:${port}/postgres?sslmode=disable`;
  process.env.SUPABASE_URL="https://enhancements.fixture.invalid";
  process.env.SUPABASE_ANON_KEY="synthetic-fixture-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY="synthetic-fixture-service-key";
  process.env.PRIVATE_OBJECT_DIR="/fixture/private";
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
    if(!url.startsWith(`${process.env.SUPABASE_URL}/auth/v1/`))return originalFetch(input,init);
    const headers=new Headers(init?.headers),id=headers.get("Authorization")?.replace("Bearer fixture-","");
    if(!id || !roles.has(id))return Response.json({message:"Invalid token"},{status:401});
    return Response.json({id,email:`fixture_${id.slice(0,8)}@fixture.invalid`,aud:"authenticated",role:"authenticated"});
  };
  for(const storage of [documentStorage,pickupPhotoStorage]){
    storage.put=async(ref,bytes)=>{if(failStorage)throw new Error("Simulated unavailable cloud storage");objects.set(ref,bytes);};
    storage.get=async(ref)=>{const bytes=objects.get(ref);if(!bytes)throw new Error("Missing fixture object");return bytes;};
    storage.discard=async(ref)=>{objects.delete(ref);};
  }
  server=createApp().listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  base=`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
});
after(async()=>{
  globalThis.fetch=originalFetch;
  if(server)await new Promise<void>(r=>server.close(()=>r()));
  if(process.env.SUPABASE_DB_URL?.includes("fixture@"))await getPool().end();
  await pool?.end();
  if(dir){await exec(`${binary}/pg_ctl`,["-D",`${dir}/data`,"-m","immediate","-w","stop"]).catch(()=>{});await rm(dir,{recursive:true,force:true});}
});
test("forward migration preserves identities, stock, historical orders and already-picked-up deliveries",async()=>{
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n,6);
  assert.equal((await pool.query("SELECT stock_quantity FROM products WHERE id=$1",[productA])).rows[0].stock_quantity,12);
  assert.equal((await pool.query("SELECT status FROM delivery_assignments WHERE id=$1",[oldAssignment])).rows[0].status,"PICKED_UP");
  assert.equal((await pool.query("SELECT bool_and(documents_required) AS required FROM stores")).rows[0].required,true);
  assert.equal((await call("/api/vendor/products",vendorA)).status,403);
  const started=await call(`/api/delivery-partner/deliveries/${oldAssignment}/actions`,partnerA,{action:"START"});
  assert.equal(started.status,200); // Pre-rollout pickup is not retroactively invalidated.
});
test("bank validation preserves leading zeros, accepts varying lengths and rejects malformed or privileged fields",()=>{
  assert.equal(bankDetailsInput.parse(bank).accountNumber,"00123456789012");
  assert.equal(bankDetailsInput.parse({...bank,accountNumber:"123456"}).vendorMobileNumber,"+919876543210");
  for(const change of [{ifsc:"INVALID"},{accountNumber:"1234"},{accountNumber:"12e100"},{vendorMobileNumber:"12345"},{status:"APPROVED"},{storeId:storeB}])
    assert.equal(bankDetailsInput.safeParse({...bank,...change}).success,false);
});
test("bank entry/review is owner scoped, masked and version checked, with non-sensitive audit history",async()=>{
  assert.equal((await call("/api/vendor/bank-details")).status,401);
  assert.equal((await call(`/api/admin/vendors/${vendorA}/bank-details`,vendorB)).status,403);
  const saved=await call("/api/vendor/bank-details",vendorA,bank,"PATCH");assert.equal(saved.status,200);
  const data=await saved.json();assert.equal(data.bankDetails.status,"SUBMITTED");assert.equal("accountNumber" in data.bankDetails,false);
  assert.equal(JSON.stringify(data).includes(bank.accountNumber),false);
  const ownB=await(await call(`/api/vendor/bank-details?storeId=${storeA}`,vendorB)).json();assert.equal(ownB.bankDetails,null);
  const revealed=await(await call(`/api/admin/vendors/${vendorA}/bank-details?reveal=true`,admin)).json();
  assert.equal(revealed.bankDetails.accountNumber,bank.accountNumber);
  assert.equal((await call(`/api/admin/vendors/${vendorA}/bank-details/review`,admin,{submissionId:randomUUID(),action:"APPROVE"})).status,409);
  assert.equal((await call(`/api/admin/vendors/${vendorA}/bank-details/review`,admin,{submissionId:data.bankDetails.submissionId,action:"REJECT"})).status,400);
  assert.equal((await call(`/api/admin/vendors/${vendorA}/bank-details/review`,admin,{submissionId:data.bankDetails.submissionId,action:"APPROVE"})).status,200);
});
test("four mandatory documents include Labour License, not photo; only combined Admin approvals unlock catalog",async()=>{
  for(const type of ["fssai","aadhaar","pan","labour_license"]){
    const response=await originalFetch(`${base}/api/vendor/documents/${type}?fileName=fixture.png${type==="fssai"?"&expiryDate=2099-12-31":""}`,{
      method:"PUT",headers:{Authorization:`Bearer fixture-${vendorA}`,"Content-Type":"image/png"},body:new Uint8Array(png)});
    assert.equal(response.status,201,await response.text());
  }
  const submitted=await call("/api/vendor/documents/submit",vendorA,{});assert.equal(submitted.status,200);
  const state=await submitted.json();assert.equal(state.mandatoryCount,4);assert.equal(state.canManageCatalog,false);
  assert.equal(state.documents.find((d:{type:string})=>d.type==="photo").mandatory,false);
  const reviewed=await call(`/api/admin/vendors/${vendorA}/documents/approve`,admin,{submissionId:state.submissionId});
  assert.equal(reviewed.status,200,await reviewed.text());
  const current=await(await call("/api/vendor/documents",vendorA)).json();assert.equal(current.canManageCatalog,true);
  assert.equal((await call("/api/vendor/products",vendorA)).status,200);
});
test("approved bank revisions revoke catalog and new-order eligibility, and stale reviews cannot reapprove",async()=>{
  const initial=await(await call("/api/vendor/bank-details",vendorA)).json();
  const revised=await call("/api/vendor/bank-details",vendorA,{...bank,bankBranch:"Revised Branch"},"PATCH");assert.equal(revised.status,200);
  assert.equal((await call("/api/vendor/products",vendorA)).status,403);
  assert.equal((await pool.query("SELECT public.vendor_compliance_approved($1) AS approved",[storeA])).rows[0].approved,false);
  assert.equal((await call(`/api/admin/vendors/${vendorA}/bank-details/review`,admin,{submissionId:initial.bankDetails.submissionId,action:"APPROVE"})).status,409);
  const state=await revised.json();
  assert.equal((await call(`/api/admin/vendors/${vendorA}/bank-details/review`,admin,{submissionId:state.bankDetails.submissionId,action:"APPROVE"})).status,200);
});
test("Vendor fees are omitted and rejected, paired coordinates persist only on the owned store",async()=>{
  const own=await(await call("/api/vendor/store",vendorA)).json();assert.equal("deliveryFee" in own.store,false);assert.equal("handlingFee" in own.store,false);
  assert.equal((await call("/api/vendor/store",vendorA,{deliveryFee:99},"PATCH")).status,400);
  assert.equal((await call("/api/vendor/store",vendorA,{handlingFee:99},"PATCH")).status,400);
  assert.equal((await call("/api/vendor/store",vendorA,{latitude:91,longitude:0},"PATCH")).status,400);
  assert.equal((await call("/api/vendor/store",vendorA,{latitude:17.4},"PATCH")).status,400);
  const changed=await call("/api/vendor/store",vendorA,{latitude:17.4,longitude:78.5},"PATCH");assert.equal(changed.status,200);
  assert.equal((await changed.json()).store.latitude,17.4);
  assert.equal((await pool.query("SELECT latitude FROM stores WHERE id=$1",[storeB])).rows[0].latitude,null);
});
test("Accept records genuine Accepted then Preparing; Ready requires no manual Preparing action",async()=>{
  readyOrder=await makeOrder(storeA);
  const denied=await call(`/api/vendor/orders/${readyOrder}/actions`,vendorB,{action:"ACCEPT"});assert.equal(denied.status,404);
  const response=await call(`/api/vendor/orders/${readyOrder}/actions`,vendorA,{action:"ACCEPT"});assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.order.status,"PREPARING");
  assert.deepEqual(body.order.statusHistory.map((h:{status:string})=>h.status),["ACCEPTED","PREPARING"]);
  assert.equal((await call(`/api/vendor/orders/${readyOrder}/actions`,vendorA,{action:"READY"})).status,200);
});
test("simultaneous eligible claims have exactly one winner; inactive partners and role overrides fail",async()=>{
  assert.equal((await call(`/api/delivery-partner/orders/${readyOrder}/claim`,customer,{})).status,403);
  assert.equal((await call(`/api/delivery-partner/orders/${readyOrder}/claim`,partnerA,{partnerId:partnerB})).status,400);
  const results=await Promise.all([call(`/api/delivery-partner/orders/${readyOrder}/claim`,partnerA,{}),call(`/api/delivery-partner/orders/${readyOrder}/claim`,partnerB,{})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  winner=results[0].status===200?partnerA:partnerB;loser=winner===partnerA?partnerB:partnerA;
  const saved=await results[results[0].status===200?0:1].json();assignment=saved.assignment.id;
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM delivery_assignments WHERE order_id=$1 AND status='ACCEPTED'",[readyOrder])).rows[0].n,1);
  await pool.query("UPDATE delivery_partner_profiles SET status='INACTIVE' WHERE user_id=$1",[loser]);
  assert.equal((await call("/api/delivery-partner/available-deliveries",loser)).status,403);
  await pool.query("UPDATE delivery_partner_profiles SET status='ACTIVE' WHERE user_id=$1",[loser]);
});
test("pickup requires durable private photo; denied users and failed uploads leave delivery state unchanged",async()=>{
  const path=`/api/delivery-partner/deliveries/${assignment}/photo`;
  assert.equal((await call(`/api/delivery-partner/deliveries/${assignment}/actions`,winner,{action:"PICKUP"})).status,409);
  assert.equal((await upload(path,loser)).status,404);
  failStorage=true;assert.equal((await upload(path,winner)).status,500);failStorage=false;
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM delivery_pickup_photos WHERE assignment_id=$1",[assignment])).rows[0].n,0);
  assert.equal((await pool.query("SELECT status FROM delivery_assignments WHERE id=$1",[assignment])).rows[0].status,"ACCEPTED");
  const saved=await upload(path,winner);assert.equal(saved.status,201);
  const metadata=await saved.json();assert.equal("objectRef" in metadata.photo,false);
  assert.equal((await call(path,loser)).status,404);
  assert.equal((await call(`/api/admin/deliveries/${assignment}/photo`,vendorA)).status,403);
  assert.equal((await call(`/api/admin/deliveries/${assignment}/photo`,customer)).status,403);
  const authorized=await call(`/api/admin/deliveries/${assignment}/photo`,admin);assert.equal(authorized.status,200);
  assert.equal(authorized.headers.get("cache-control"),"private, no-store");
  assert.deepEqual(Buffer.from(await authorized.arrayBuffer()),png);
  assert.equal((await call(`/api/delivery-partner/deliveries/${assignment}/actions`,winner,{action:"PICKUP"})).status,200);
  assert.equal((await upload(path,winner)).status,409);
  assert.equal((await call(`/api/delivery-partner/deliveries/${assignment}/actions`,loser,{action:"START"})).status,403);
  assert.equal((await call(`/api/delivery-partner/deliveries/${assignment}/actions`,winner,{action:"START"})).status,200);
  assert.equal((await call(`/api/delivery-partner/deliveries/${assignment}/actions`,winner,{action:"DELIVER"})).status,200);
});
test("Asia/Kolkata ranges include the whole end day and correctly handle midnight and invalid dates",()=>{
  assert.deepEqual(dailyBounds("2026-10-14"),{start:new Date("2026-10-13T18:30:00Z"),end:new Date("2026-10-14T18:30:00Z")});
  assert.equal(orderDateBounds({dateFilter:"WEEK"},new Date("2026-10-14T12:00:00Z"))!.start.toISOString(),"2026-10-07T18:30:00.000Z");
  assert.throws(()=>dailyBounds("2026-02-31"));
  assert.throws(()=>orderDateBounds({dateFilter:"CUSTOM",startDate:"2026-10-15",endDate:"2026-10-14"}));
});
test("filtered PDFs use all authoritative rows, preserve totals and isolate Vendor/Admin access",async()=>{
  const own=await makeOrder(storeA,"DELIVERED","2026-10-13T18:30:00Z");
  const outside=await makeOrder(storeA,"DELIVERED","2026-10-14T18:30:00Z");
  const foreign=await makeOrder(storeB,"DELIVERED","2026-10-14T01:00:00Z");
  const query={dateFilter:"CUSTOM" as const,startDate:"2026-10-14",endDate:"2026-10-14"};
  const rows=await orderReportRows(query,storeA);
  assert.ok(rows.some(r=>r.id===own));assert.ok(!rows.some(r=>r.id===outside || r.id===foreign));
  assert.equal(rows.find(r=>r.id===own)!.total,"80.00");
  assert.equal((await call(`/api/vendor/orders/report.pdf?dateFilter=ALL&storeId=${storeB}`,vendorA)).status,400);
  const response=await call("/api/vendor/orders/report.pdf?dateFilter=CUSTOM&startDate=2026-10-14&endDate=2026-10-14",vendorA);
  assert.equal(response.status,200);
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),"%PDF-");
  const contents=await pdfText(bytes);assert.ok(contents.includes(own));assert.ok(!contents.includes(foreign));
  assert.ok(contents.includes("80.00"));assert.ok(contents.includes("kg"));assert.ok(!contents.includes(bank.accountNumber));
  assert.equal((await call(`/api/admin/orders/report.pdf?dateFilter=ALL&storeId=${storeB}`,admin)).status,200);
  assert.equal((await call("/api/admin/orders/report.pdf?dateFilter=ALL",vendorA)).status,403);
  assert.equal((await call("/api/vendor/orders/report.pdf?dateFilter=CUSTOM&startDate=2026-10-14",vendorA)).status,400);
});
test("PDF exports are unpaginated beyond 100 orders while Recent stays capped at 50",async()=>{
  for(let i=0;i<105;i++)await makeOrder(storeA,"PLACED","2026-10-20T06:00:00Z");
  const query={dateFilter:"CUSTOM" as const,startDate:"2026-10-20",endDate:"2026-10-20"};
  const rows=await orderReportRows(query,storeA);assert.equal(rows.length,105);
  const response=await call("/api/vendor/orders/report.pdf?dateFilter=CUSTOM&startDate=2026-10-20&endDate=2026-10-20&page=2&pageSize=1",vendorA);
  assert.equal(response.status,200);
  const text=await pdfText(Buffer.from(await response.arrayBuffer()));
  assert.ok(text.includes(String(rows[0].id)));assert.ok(text.includes(String(rows[104].id)));
  assert.equal((await orderReportRows({dateFilter:"RECENT"},storeA)).length,50);
  assert.ok((await orderReportRows({dateFilter:"ALL"},storeA)).length>=105);
});
test("daily reports use actual owned assignments, omit retry duplicates and enforce partner selectors on server",async()=>{
  const day=indiaDate(),rows=await dailyReportRows(day,winner);
  assert.equal(rows.filter(r=>r.orderId===readyOrder).length,1);
  assert.ok(rows.every(r=>r.partnerId===winner));
  assert.equal((await call(`/api/delivery-partner/reports/daily.pdf?date=${day}&partnerId=${loser}`,winner)).status,400);
  const response=await call(`/api/delivery-partner/reports/daily.pdf?date=${day}`,winner);assert.equal(response.status,200);
  const contents=await pdfText(Buffer.from(await response.arrayBuffer()));assert.ok(contents.includes(readyOrder));assert.ok(!contents.includes(bank.accountNumber));
  assert.equal((await call(`/api/admin/reports/deliveries/daily.pdf?date=${day}`,admin)).status,200);
  assert.equal((await call(`/api/admin/reports/deliveries/daily.pdf?date=${day}`,loser)).status,403);
  const history=await(await call(`/api/admin/orders/${readyOrder}/delivery`,admin)).json();assert.equal(history.assignments[0].id,assignment);
});
test("private relations deny authenticated direct reads and cross-assignment photo metadata",async()=>{
  const client=await pool.connect();
  try{
    await client.query("BEGIN");await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[vendorA]);
    assert.equal((await client.query("SELECT delivery_fee,handling_fee FROM stores WHERE id=$1",[storeA])).rowCount,0);
    await assert.rejects(client.query("SELECT * FROM vendor_bank_details"),(e:unknown)=>(e as {code:string}).code==="42501");
    await client.query("ROLLBACK");
  }finally{client.release();}
  await assert.rejects(pool.query(`INSERT INTO delivery_pickup_photos(assignment_id,order_id,partner_user_id,object_ref,mime_type,size_bytes,captured_at)
    VALUES($1,$2,$3,'/fixture/invalid','image/png',100,now())`,[oldAssignment,oldOrder,partnerB]),(e:unknown)=>(e as {code:string}).code==="23503");
});
test("manual Vendor assignment is denied, duplicate winning claims are idempotent and stale offers cannot be claimed",async()=>{
  const id=await makeOrder(storeA,"READY");
  const before=(await pool.query("SELECT count(*)::int AS n FROM delivery_assignments WHERE order_id=$1",[id])).rows[0].n;
  const denied=await call(`/api/vendor/orders/${id}/delivery`,vendorA,{partnerId:partnerA});
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).code,"AUTOMATIC_ASSIGNMENT_REQUIRED");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM delivery_assignments WHERE order_id=$1",[id])).rows[0].n,before);
  const claimed=await call(`/api/delivery-partner/orders/${id}/claim`,partnerA,{});
  assert.equal(claimed.status,200); const data=await claimed.json();
  const retry=await call(`/api/delivery-partner/orders/${id}/claim`,partnerA,{});
  assert.equal(retry.status,200); assert.equal((await retry.json()).assignment.id,data.assignment.id);
  assert.equal((await call(`/api/delivery-partner/orders/${id}/claim`,partnerB,{})).status,409);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM delivery_assignments WHERE order_id=$1",[id])).rows[0].n,1);
  const expired=await makeOrder(storeA,"READY");
  await pool.query(`UPDATE orders SET delivery_mode='SCHEDULED',scheduled_start_at=now()-interval '2 hours',
    scheduled_end_at=now()-interval '1 hour' WHERE id=$1`,[expired]);
  const available=await (await call("/api/delivery-partner/available-deliveries",partnerA)).json();
  assert.ok(!available.deliveries.some((d:{orderId:string})=>d.orderId===expired));
  assert.equal((await call(`/api/delivery-partner/orders/${expired}/claim`,partnerA,{})).status,409);
  await pool.query("UPDATE orders SET status='CANCELLED' WHERE id=$1",[expired]);
  assert.equal((await call(`/api/delivery-partner/orders/${expired}/claim`,partnerA,{})).status,409);
});
test("new-order notifications are committed once, rollback-safe, privately scoped and persist acknowledgements",async()=>{
  const id=await makeOrder(storeB);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM vendor_notifications WHERE order_id=$1",[id])).rows[0].n,1);
  const rolledBack=randomUUID(),client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO orders(id,customer_id,store_id,subtotal,delivery_fee_snapshot,total_amount,
      delivery_contact_name,delivery_contact_phone,delivery_address_snapshot)
      VALUES($1,$2,$3,5,0,5,'Fixture','9876543210','{}')`,[rolledBack,customer,storeB]);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM vendor_notifications WHERE order_id=$1",[rolledBack])).rows[0].n,1);
    await client.query("ROLLBACK");
  } finally { client.release(); }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM vendor_notifications WHERE order_id=$1",[rolledBack])).rows[0].n,0);
  const feed=await(await call("/api/vendor/notifications",vendorB)).json();
  const notice=feed.notifications.find((n:{orderId:string})=>n.orderId===id);
  assert.ok(notice);assert.equal(notice.readAt,null);assert.equal(feed.deliveryMode,"IN_APP_REALTIME_WITH_POLLING");
  const other=await(await call("/api/vendor/notifications",vendorA)).json();
  assert.ok(!other.notifications.some((n:{orderId:string})=>n.orderId===id));
  assert.equal((await call(`/api/vendor/notifications/${notice.id}/read`,vendorA)).status,404);
  assert.equal((await call(`/api/vendor/notifications/${notice.id}/read`,vendorB,{})).status,200);
  const readAt=(await pool.query("SELECT read_at FROM vendor_notifications WHERE id=$1",[notice.id])).rows[0].read_at;
  assert.equal((await call(`/api/vendor/notifications/${notice.id}/read`,vendorB,{})).status,200);
  assert.deepEqual((await pool.query("SELECT read_at FROM vendor_notifications WHERE id=$1",[notice.id])).rows[0].read_at,readAt);
  const adminFeed=await(await call(`/api/admin/vendors/${vendorB}/notifications`,admin)).json();
  assert.ok(adminFeed.notifications.find((n:{id:string,readAt:string})=>n.id===notice.id)?.readAt);
  assert.equal((await call(`/api/admin/vendors/${vendorB}/notifications`,vendorA)).status,403);
  assert.equal((await call("/api/vendor/notifications",customer)).status,403);
  const direct=await pool.connect();
  try {await direct.query("BEGIN");await direct.query("SET LOCAL ROLE authenticated");
    await assert.rejects(direct.query("SELECT * FROM vendor_notifications"),(e:unknown)=>(e as {code:string}).code==="42501");
    await direct.query("ROLLBACK");
  } finally {direct.release();}
});
test("authenticated foreground streams deliver committed new-order and Ready signals without exposing payload data",async()=>{
  assert.equal((await call("/api/vendor/events")).status,401);
  assert.equal((await call("/api/vendor/events",customer)).status,403);
  assert.equal((await call("/api/delivery-partner/events",vendorA)).status,403);
  const streams: Array<{controller:AbortController,reader:ReadableStreamDefaultReader<Uint8Array>}>=[];
  async function stream(path:string,actor:string) {
    const controller=new AbortController();
    const response=await originalFetch(`${base}${path}`,{headers:{Authorization:`Bearer fixture-${actor}`},signal:controller.signal});
    assert.equal(response.status,200);assert.match(response.headers.get("content-type") ?? "",/text\/event-stream/);
    const reader=response.body!.getReader();streams.push({controller,reader});
    async function refresh() {
      let text="";
      const timeout=setTimeout(()=>controller.abort(),5_000);
      try {
        while(!text.includes("event: refresh\ndata: {}\n\n")){
          const next=await reader.read();if(next.done)throw new Error("Live stream ended");
          text+=new TextDecoder().decode(next.value);
        }
        assert.ok(!text.includes("storeId"));assert.ok(!text.includes("recipient"));return text;
      }finally{clearTimeout(timeout);}
    }
    await refresh();return refresh;
  }
  try {
    const vendorRefresh=await stream("/api/vendor/events",vendorB);
    const partnerRefresh=await stream("/api/delivery-partner/events",partnerA);
    const vendorSignal=vendorRefresh();
    const id=await makeOrder(storeB);
    await vendorSignal;
    const partnerSignal=partnerRefresh();
    await pool.query("UPDATE orders SET status='READY' WHERE id=$1",[id]);
    await partnerSignal;
  } finally {
    for(const {controller,reader} of streams){controller.abort();await reader.cancel().catch(()=>undefined);}
  }
});
test("FSSAI date changes protect ownership/current version, invalidate review, and reject impossible dates",async()=>{
  const doc=(await pool.query("SELECT id FROM vendor_documents WHERE store_id=$1 AND document_type='fssai' AND is_current",[storeA])).rows[0];
  const path=`/api/vendor/documents/${doc.id}/expiry`;
  assert.equal((await call(path,vendorB,{expiryDate:"2098-12-31"},"PATCH")).status,404);
  for(const expiryDate of ["2026-02-30","2026-13-01","garbage","0000-01-01"])
    assert.equal((await call(path,vendorA,{expiryDate},"PATCH")).status,400);
  assert.equal((await call(path,customer,{expiryDate:"2098-12-31"},"PATCH")).status,403);
  const changed=await call(path,vendorA,{expiryDate:"2098-12-31"},"PATCH");
  assert.equal(changed.status,200);
  const status=await changed.json();assert.equal(status.verificationStatus,"DRAFT");assert.equal(status.canManageCatalog,false);
  assert.equal(status.fssai.status,"VALID");assert.equal(status.fssai.expiryDate,"2098-12-31");
  const submitted=await(await call("/api/vendor/documents/submit",vendorA,{})).json();
  assert.equal((await call(path,vendorA,{expiryDate:"2097-12-31"},"PATCH")).status,409);
  const adminPath=`/api/admin/vendors/${vendorA}/documents/${doc.id}/expiry`;
  assert.equal((await call(adminPath,admin,{expiryDate:"2097-12-31"},"PATCH")).status,200);
  assert.equal((await call(`/api/admin/vendors/${vendorA}/documents/approve`,admin,{submissionId:submitted.submissionId})).status,409);
  const resubmitted=await(await call("/api/vendor/documents/submit",vendorA,{})).json();
  assert.equal((await call(`/api/admin/vendors/${vendorA}/documents/approve`,admin,{submissionId:resubmitted.submissionId})).status,200);
  await pool.query("UPDATE vendor_documents SET expiry_date=NULL WHERE id=$1",[doc.id]);
  const unknown=await(await call("/api/vendor/documents",vendorA)).json();
  assert.equal(unknown.fssai.status,"DATE_REQUIRED");assert.equal(unknown.canManageCatalog,false);
  assert.equal((await call("/api/vendor/documents/submit",vendorA,{})).status,409);
  await pool.query("UPDATE vendor_documents SET expiry_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date WHERE id=$1",[doc.id]);
  const expired=await(await call("/api/vendor/documents",vendorA)).json();
  assert.equal(expired.fssai.status,"EXPIRED");assert.equal(expired.canManageCatalog,false);
  assert.equal((await call("/api/vendor/products",vendorA)).status,403);
  assert.equal((await call("/api/vendor/orders",vendorA)).status,200);
});
test("FSSAI milestone notifications are unique under simultaneous polling, catch up on sign-in and retain expired warning",async()=>{
  const doc=(await pool.query("SELECT id FROM vendor_documents WHERE store_id=$1 AND document_type='fssai' AND is_current",[storeA])).rows[0];
  for(const days of [30,7,0]){
    await pool.query(`UPDATE vendor_documents SET expiry_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date+$2::int WHERE id=$1`,[doc.id,days]);
    await Promise.all([call("/api/vendor/notifications",vendorA),call("/api/vendor/notifications",vendorA),call("/api/vendor/notifications",vendorA)]);
    const notices=(await pool.query("SELECT id,milestone FROM vendor_notifications WHERE document_id=$1 AND expiry_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date+$2::int",[doc.id,days])).rows;
    assert.equal(notices.length,1);assert.equal(notices[0].milestone,String(days));
    assert.equal((await call(`/api/vendor/notifications/${notices[0].id}/read`,vendorA,{})).status,200);
  }
  const status=await(await call("/api/vendor/documents",vendorA)).json();
  assert.equal(status.fssai.status,"EXPIRED");assert.ok(status.message.includes("expired"));
  await pool.query(`UPDATE vendor_documents SET expiry_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date+5 WHERE id=$1`,[doc.id]);
  const feed=await(await call("/api/vendor/notifications",vendorA)).json();
  const current=feed.notifications.filter((n:{documentId:string})=>n.documentId===doc.id);
  assert.equal(current.length,1);assert.equal(current[0].milestone,"7");
});
