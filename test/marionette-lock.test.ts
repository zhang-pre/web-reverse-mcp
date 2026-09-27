import { it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarionetteLock } from "../src/bridge/marionetteLock.js";

it("never steals a live, expired, malformed or dead-owner file; normal release permits transfer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "frx-lock-"));
  const path = join(dir,"owner.lock");
  const owner = {pid:process.pid, ppid:process.ppid, host:"127.0.0.1",port:2828};
  try {
    for(let i=0;i<30;i++) {
      const a=new MarionetteLock(path,owner), b=new MarionetteLock(path,owner);
      expect(await a.acquire(0)).toBe(true);
      expect(await b.acquire(0)).toBe(false);
      const info=JSON.parse(readFileSync(path,"utf8"));
      writeFileSync(path,JSON.stringify({...info,ts:0}));
      expect(await b.acquire(0)).toBe(false);
      a.release(); expect(await b.acquire(0)).toBe(true); b.release();
    }
    for(const text of ["", "{broken", JSON.stringify({...owner,pid:2147483000,ts:0})]) {
      writeFileSync(path,text);
      expect(await new MarionetteLock(path,owner).acquire(0)).toBe(false);
      expect(readFileSync(path,"utf8")).toBe(text);
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
