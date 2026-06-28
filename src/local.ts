import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, opendir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeTemplateCode } from "./template.js";

export type LocalInventoryOptions = {
  roots?: string[];
  useEnvRoots?: boolean;
  maxDepth?: number;
  maxEntries?: number;
  includeHeaderHashes?: boolean;
  redactPaths?: boolean;
};

export type LocalFindingType = "vmware_bundle" | "vmware_config" | "virtual_disk" | "gw_executable" | "gw_data_archive" | "template_file" | "templates_directory";

export type LocalFinding = {
  type: LocalFindingType;
  rootId: string;
  path: string;
  pathHash: string;
  size?: number;
  modifiedAt?: string;
  note?: string;
  sha256Header?: string;
  templateCodes?: Array<{
    code: string;
    plausible: boolean;
    kind: string;
  }>;
};

export type LocalInventory = {
  enabled: boolean;
  message?: string;
  rootsScanned: number;
  findings: LocalFinding[];
  warnings: string[];
};

const TEMPLATE_CODE_PATTERN = /\b[OP][A-Za-z0-9+/_=-]{7,}\b/g;

function parseEnvRoots(): string[] {
  const raw = process.env.GW1_LOCAL_ROOTS;
  if (!raw) {
    return [];
  }
  const splitter = process.platform === "win32" ? /[;,]/ : /[:;,]/;
  return raw
    .split(splitter)
    .map((value) => value.trim())
    .filter(Boolean);
}

function redactPath(relativePath: string, redact: boolean): string {
  if (!redact) {
    return relativePath;
  }
  const basename = path.basename(relativePath);
  if (["Gw.exe", "Gw.dat"].includes(basename) || basename.endsWith(".vmwarevm") || basename.endsWith(".vmx") || basename.endsWith(".vmdk")) {
    return basename;
  }
  if (/templates?/i.test(relativePath)) {
    return path.join("Templates", basename);
  }
  return "[redacted]";
}

function hashPath(root: string, relativePath: string): string {
  return createHash("sha256").update(`${root}\0${relativePath}`).digest("hex").slice(0, 16);
}

async function hashHeader(filePath: string, maxBytes: number): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { start: 0, end: Math.max(0, maxBytes - 1) });
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function classifyPath(name: string, isDirectory: boolean): LocalFindingType | undefined {
  const lower = name.toLowerCase();
  if (isDirectory && lower.endsWith(".vmwarevm")) {
    return "vmware_bundle";
  }
  if (isDirectory && lower === "templates") {
    return "templates_directory";
  }
  if (!isDirectory && lower.endsWith(".vmx")) {
    return "vmware_config";
  }
  if (!isDirectory && lower.endsWith(".vmdk")) {
    return "virtual_disk";
  }
  if (!isDirectory && lower === "gw.exe") {
    return "gw_executable";
  }
  if (!isDirectory && lower === "gw.dat") {
    return "gw_data_archive";
  }
  if (!isDirectory && lower.endsWith(".txt")) {
    return "template_file";
  }
  return undefined;
}

async function extractTemplateCodes(filePath: string): Promise<Array<{ code: string; plausible: boolean; kind: string }>> {
  const fileStat = await stat(filePath);
  if (fileStat.size > 128 * 1024) {
    return [];
  }
  const text = await readFile(filePath, "utf8").catch(() => "");
  const codes = [...new Set(text.match(TEMPLATE_CODE_PATTERN) ?? [])].slice(0, 20);
  return codes.map((code) => {
    const analysis = analyzeTemplateCode(code);
    return {
      code: analysis.code,
      plausible: analysis.plausible,
      kind: analysis.kind
    };
  });
}

async function scanRoot(root: string, rootId: string, options: Required<Pick<LocalInventoryOptions, "maxDepth" | "maxEntries" | "includeHeaderHashes" | "redactPaths">>): Promise<{ findings: LocalFinding[]; warnings: string[] }> {
  const findings: LocalFinding[] = [];
  const warnings: string[] = [];
  const rootRealPath = await realpath(root);
  const rootStat = await lstat(rootRealPath);
  let virtualDiskFindings = 0;

  if (!rootStat.isDirectory()) {
    warnings.push(`Root ${rootId} is not a directory.`);
    return { findings, warnings };
  }

  const rootType = classifyPath(path.basename(rootRealPath), true);
  if (rootType === "vmware_bundle") {
    findings.push({
      type: "vmware_bundle",
      rootId,
      path: redactPath(path.basename(rootRealPath), options.redactPaths),
      pathHash: hashPath(rootRealPath, "."),
      modifiedAt: rootStat.mtime.toISOString()
    });
  }

  async function visit(directory: string, depth: number): Promise<void> {
    if (findings.length >= options.maxEntries) {
      return;
    }
    if (depth > options.maxDepth) {
      return;
    }

    let dir;
    try {
      dir = await opendir(directory);
    } catch (error) {
      warnings.push(`Could not read a directory under ${rootId}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    for await (const entry of dir) {
      if (findings.length >= options.maxEntries) {
        warnings.push(`Stopped after maxEntries=${options.maxEntries}.`);
        return;
      }

      const absolutePath = path.join(directory, entry.name);
      let entryStat;
      try {
        entryStat = await lstat(absolutePath);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) {
        continue;
      }

      const relativePath = path.relative(rootRealPath, absolutePath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        continue;
      }

      const type = classifyPath(entry.name, entryStat.isDirectory());
      if (type) {
        if (type === "virtual_disk") {
          virtualDiskFindings += 1;
          if (virtualDiskFindings > 5) {
            continue;
          }
        }
        const finding: LocalFinding = {
          type,
          rootId,
          path: redactPath(relativePath, options.redactPaths),
          pathHash: hashPath(rootRealPath, relativePath),
          size: entryStat.isFile() ? entryStat.size : undefined,
          modifiedAt: entryStat.mtime.toISOString()
        };

        if (type === "gw_data_archive") {
          finding.note = "metadata only; Gw.dat content is not parsed";
        }
        if (type === "virtual_disk") {
          finding.note = "metadata only; virtual disks are not mounted or parsed";
          if (virtualDiskFindings === 5) {
            warnings.push(`Additional virtual disk shards under ${rootId} were omitted.`);
          }
        }
        if (options.includeHeaderHashes && entryStat.isFile() && ["gw_executable", "gw_data_archive"].includes(type)) {
          finding.sha256Header = await hashHeader(absolutePath, 4096);
        }
        if (type === "template_file") {
          const templateCodes = await extractTemplateCodes(absolutePath);
          if (templateCodes.length === 0) {
            continue;
          }
          finding.templateCodes = templateCodes;
        }

        findings.push(finding);
      }

      if (entryStat.isDirectory()) {
        await visit(absolutePath, depth + 1);
      }
    }
  }

  await visit(rootRealPath, 0);
  return { findings, warnings };
}

export async function inventoryLocal(options: LocalInventoryOptions = {}): Promise<LocalInventory> {
  const roots = options.roots?.length ? options.roots : options.useEnvRoots === false ? [] : parseEnvRoots();
  if (roots.length === 0) {
    return {
      enabled: false,
      message: "Local inventory is disabled. Set GW1_LOCAL_ROOTS or pass explicit roots to scan.",
      rootsScanned: 0,
      findings: [],
      warnings: []
    };
  }

  const normalizedOptions = {
    maxDepth: Math.min(Math.max(options.maxDepth ?? 6, 0), 12),
    maxEntries: Math.min(Math.max(options.maxEntries ?? 500, 1), 5000),
    includeHeaderHashes: options.includeHeaderHashes ?? false,
    redactPaths: options.redactPaths ?? true
  };

  const findings: LocalFinding[] = [];
  const warnings: string[] = [];
  let rootsScanned = 0;

  for (const [index, root] of roots.entries()) {
    const rootId = `root-${index + 1}`;
    try {
      const result = await scanRoot(root, rootId, normalizedOptions);
      findings.push(...result.findings);
      warnings.push(...result.warnings);
      rootsScanned += 1;
    } catch (error) {
      warnings.push(`${rootId} could not be scanned: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    enabled: true,
    rootsScanned,
    findings,
    warnings
  };
}
