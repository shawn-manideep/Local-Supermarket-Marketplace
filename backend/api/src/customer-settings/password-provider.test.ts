import test from "node:test";
import assert from "node:assert/strict";
import { changeVerifiedPassword, changePasswordInput, maskEmail } from "./routes.js";
test("password policy and confirmation reject short, mismatched and protected inputs", () => {
  const input={currentPassword:"synthetic-current",newPassword:"new-valid-password",confirmPassword:"new-valid-password"};
  assert.equal(changePasswordInput.safeParse(input).success,true);
  for (const value of [{...input,newPassword:"short"},{...input,confirmPassword:"different"},{...input,userId:"forged"}]) {
    assert.equal(changePasswordInput.safeParse(value).success,false);
  }
  assert.equal(maskEmail("person@example.invalid"),"pe***@example.invalid");
  assert.equal(maskEmail(null),null);
});
test("existing Supabase auth verifies current password before update and ends only its temporary session",async () => {
  const calls:string[]=[];
  const auth={
    async signInWithPassword(input:{email:string;password:string}) {
      assert.deepEqual(input,{email:"synthetic@example.invalid",password:"current"}); calls.push("verify");
      return {data:{user:{id:"self"},session:{}},error:null};
    },
    async updateUser(input:{password:string}) {assert.equal(input.password,"new-password"); calls.push("update"); return {error:null};},
    async signOut(input:{scope:"local"}) {assert.equal(input.scope,"local");calls.push("local-signout");},
  };
  await changeVerifiedPassword(auth,"self","synthetic@example.invalid","current","new-password");
  assert.deepEqual(calls,["verify","update","local-signout"]);
});
test("bad current password never updates; wrong verified identity never updates and cleans up session",async () => {
  let updates=0,signouts=0;
  const auth={
    async signInWithPassword(){return {data:{user:{id:"other"},session:{}},error:null as {code:string}|null};},
    async updateUser(){updates++;return {error:null};},
    async signOut(){signouts++;},
  };
  await assert.rejects(changeVerifiedPassword(auth,"self","synthetic@example.invalid","current","new-password"),{statusCode:403});
  assert.equal(updates,0);assert.equal(signouts,1);
  auth.signInWithPassword=async()=>({data:{user:{id:"self"},session:{}},error:{code:"invalid_credentials"}});
  await assert.rejects(changeVerifiedPassword(auth,"self","synthetic@example.invalid","wrong","new-password"),{statusCode:400});
  assert.equal(updates,0);
});
test("provider verification outage and rejected new password return structured failures",async () => {
  const auth={
    async signInWithPassword(){return {data:{user:{id:"self"},session:{}},error:{code:"provider_unavailable"} as {code:string}|null};},
    async updateUser(){return {error:{code:"weak_password"}};},
    async signOut(){},
  };
  await assert.rejects(changeVerifiedPassword(auth,"self","synthetic@example.invalid","current","new-password"),{statusCode:503});
  auth.signInWithPassword=async()=>({data:{user:{id:"self"},session:{}},error:null});
  await assert.rejects(changeVerifiedPassword(auth,"self","synthetic@example.invalid","current","new-password"),{statusCode:400});
});
