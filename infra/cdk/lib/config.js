import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../../../");
const topologyFile = resolve(repoRoot, "config/topology.json");

export const sourceRoot = resolve(repoRoot, "src");

export function loadTopology() {
  const raw = readFileSync(topologyFile, "utf8");
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("config/topology.json must be a JSON object.");
  }

  if (!parsed.central || typeof parsed.central !== "object") {
    throw new Error("config/topology.json must include a central object.");
  }

  const accountId = parsed.central.accountId;
  const eventBusName = parsed.central.eventBusName;
  const region = parsed.central.region;
  const allowedSourceAccounts = parsed.central.allowedSourceAccounts;

  if (typeof accountId !== "string" || accountId.length === 0) {
    throw new Error("config/topology.json central.accountId must be a non-empty string.");
  }

  if (typeof eventBusName !== "string" || eventBusName.length === 0) {
    throw new Error("config/topology.json central.eventBusName must be a non-empty string.");
  }

  if (typeof region !== "string" || region.length === 0) {
    throw new Error("config/topology.json central.region must be a non-empty string.");
  }

  if (!Array.isArray(allowedSourceAccounts) || allowedSourceAccounts.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("config/topology.json central.allowedSourceAccounts must be an array of non-empty strings.");
  }

  const sourceDefaults = parsed.sourceDefaults ?? {};

  return {
    central: {
      accountId,
      eventBusName,
      region,
      allowedSourceAccounts
    },
    sourceDefaults: {
      functionName: typeof sourceDefaults.functionName === "string" && sourceDefaults.functionName.length > 0
        ? sourceDefaults.functionName
        : "ec2_instance_dns_enricher",
      roleNamePrefix: typeof sourceDefaults.roleNamePrefix === "string" && sourceDefaults.roleNamePrefix.length > 0
        ? sourceDefaults.roleNamePrefix
        : "lambda-ec2-dns-enricher",
      ruleName: typeof sourceDefaults.ruleName === "string" && sourceDefaults.ruleName.length > 0
        ? sourceDefaults.ruleName
        : "ec2-instance-status-change",
      states: Array.isArray(sourceDefaults.states) && sourceDefaults.states.length > 0
        ? sourceDefaults.states
        : ["running", "stopped"]
    }
  };
}
