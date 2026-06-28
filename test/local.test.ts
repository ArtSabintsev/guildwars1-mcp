import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inventoryLocal } from "../src/local.js";

describe("local inventory", () => {
  it("is disabled without explicit roots", async () => {
    const inventory = await inventoryLocal({ useEnvRoots: false });

    expect(inventory.enabled).toBe(false);
    expect(inventory.findings).toEqual([]);
  });

  it("detects Guild Wars files and plausible template codes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gw1-mcp-test-"));
    await mkdir(path.join(root, "Guild Wars", "Templates"), { recursive: true });
    await writeFile(path.join(root, "Guild Wars", "Gw.exe"), "exe");
    await writeFile(path.join(root, "Guild Wars", "Gw.dat"), "dat");
    await writeFile(path.join(root, "Guild Wars", "Templates", "build.txt"), "OApjYwp4qSaXPXBYZXmXf1bhqiA\n");

    const inventory = await inventoryLocal({ roots: [root], maxDepth: 4, includeHeaderHashes: true });

    expect(inventory.enabled).toBe(true);
    expect(inventory.findings.map((finding) => finding.type)).toEqual(expect.arrayContaining(["gw_executable", "gw_data_archive", "template_file"]));
    expect(inventory.findings.find((finding) => finding.type === "gw_data_archive")?.note).toContain("metadata only");
    expect(inventory.findings.find((finding) => finding.type === "template_file")?.templateCodes?.[0]?.plausible).toBe(true);
    expect(inventory.findings.every((finding) => !finding.path.includes(root))).toBe(true);
  });

  it("detects VMware bundle metadata without parsing virtual disks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "gw1-mcp-test-"));
    const bundle = path.join(root, "Windows.vmwarevm");
    await mkdir(bundle, { recursive: true });
    await writeFile(path.join(bundle, "Windows.vmx"), "displayName = \"Windows\"\n");
    await writeFile(path.join(bundle, "disk.vmdk"), "disk");

    const inventory = await inventoryLocal({ roots: [root], maxDepth: 2 });

    expect(inventory.findings.map((finding) => finding.type)).toEqual(expect.arrayContaining(["vmware_bundle", "vmware_config", "virtual_disk"]));
    expect(inventory.findings.find((finding) => finding.type === "virtual_disk")?.note).toContain("not mounted");
  });
});
