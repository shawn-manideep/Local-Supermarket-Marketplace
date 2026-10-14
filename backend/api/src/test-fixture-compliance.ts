// Test-only approvals, never imported by application routes.
import type pg from "pg";
import { randomUUID } from "node:crypto";

function localOnly(pool: pg.Pool) {
  if (!["127.0.0.1","localhost"].includes(pool.options.host ?? "")) {
    throw new Error("Fixture approvals are restricted to disposable local PostgreSQL.");
  }
}
export async function approvedFixtureBank(pool: pg.Pool, storeId: string, adminId: string) {
  localOnly(pool);
  await pool.query(`INSERT INTO vendor_bank_details(store_id,account_holder_name,account_number,ifsc,
    bank_name,bank_branch,vendor_mobile_number,status,reviewed_at,reviewed_by)
    VALUES($1,'Synthetic Fixture','001234567890','TEST0123456','Fixture Bank','Fixture Branch',
      '+919876543210','APPROVED',now(),$2)`,[storeId,adminId]);
}
export async function approvedFixtureDocuments(pool: pg.Pool, storeId: string, adminId: string) {
  localOnly(pool);
  const submission = randomUUID();
  await pool.query(`UPDATE stores SET documents_required=true,document_verification_status='APPROVED',
    document_submission_id=$2,documents_submitted_at=now(),documents_reviewed_at=now(),documents_reviewed_by=$3
    WHERE id=$1`,[storeId,submission,adminId]);
  for(const type of ["fssai","aadhaar","pan","labour_license"]) {
    await pool.query(`INSERT INTO vendor_documents(store_id,document_type,file_name,mime_type,size_bytes,
      object_ref,version,is_current,verification_status,submission_id)
      VALUES($1,$2,'fixture.pdf','application/pdf',64,$3,1,true,'APPROVED',$4)`,
      [storeId,type,`/fixture/documents/${storeId}/${type}`,submission]);
    // Older isolated lifecycle fixtures deliberately run only earlier migrations.
    const column = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='vendor_documents' AND column_name='expiry_date'");
    if (type === "fssai" && column.rowCount)
      await pool.query("UPDATE vendor_documents SET expiry_date='2099-12-31' WHERE store_id=$1 AND document_type='fssai' AND is_current",[storeId]);
  }
}
