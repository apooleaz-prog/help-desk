#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureReady,
  findAssetByNumber,
  findAssetTypeByName,
  findManufacturerByName,
  insertAsset,
  insertAssetType,
  insertLocation,
  insertManufacturer,
  listCompanyLocations,
  listManufacturers,
  readDb,
  updateAssetRecord,
} from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PDF = path.join(os.homedir(), "Downloads", "import.pdf");
const PARSER = path.join(__dirname, "parse-import-pdf.py");
const PYTHON_CANDIDATES = [
  "/tmp/pdfvenv/bin/python",
  process.env.PYTHON,
  "python3",
].filter(Boolean);

const PLACEHOLDER_SERIAL = /^(n\/?a|none|no serial|need serial|emailing later today|unreadable.*)$/i;
const CITY_RE = /([A-Za-z .'-]+),\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?/;
const ADDRESS_LOCATION_OVERRIDES = [
  { match: /17\s+lone\s+spur/i, name: "Vail" },
];

function parsePdf(pdfPath) {
  let lastError = "";
  for (const python of PYTHON_CANDIDATES) {
    const result = spawnSync(python, [PARSER, pdfPath], {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return JSON.parse(result.stdout);
    }
    lastError = result.stderr || result.error?.message || `exit ${result.status}`;
  }
  throw new Error(
    `Could not parse PDF. Install pypdf (python3 -m pip install pypdf). Last error: ${lastError}`
  );
}

function cityFromAddress(address) {
  const match = String(address || "").match(CITY_RE);
  return match ? match[1].trim() : "";
}

function locationNameFromAddress(address) {
  const text = String(address || "");
  const override = ADDRESS_LOCATION_OVERRIDES.find((row) => row.match.test(text));
  if (override) return override.name;
  return cityFromAddress(text);
}

function chooseAssetNumber(record, used) {
  let base = String(record.serialNumber || "").trim();
  if (!base || PLACEHOLDER_SERIAL.test(base)) {
    base = String(record.name || "").trim();
  }
  if (!base) base = "Imported asset";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

async function resolveManufacturer(name, now) {
  const trimmed = String(name || "").trim();
  const label = trimmed || "Unknown";
  const exact = await findManufacturerByName(label);
  if (exact) return exact;
  const all = await listManufacturers();
  const lower = label.toLowerCase();
  const fuzzy = all.find((row) => {
    const current = row.name.toLowerCase();
    return current === lower || current.startsWith(lower) || lower.startsWith(current);
  });
  if (fuzzy) return fuzzy;
  return insertManufacturer({
    id: randomUUID(),
    name: label,
    details: "",
    image: "",
    createdAt: now,
    updatedAt: now,
  });
}

async function resolveAssetType(name, now) {
  const trimmed = String(name || "").trim() || "Unknown";
  const exact = await findAssetTypeByName(trimmed);
  if (exact) return exact;
  return insertAssetType({
    id: randomUUID(),
    name: trimmed,
    details: "",
    image: "",
    createdAt: now,
    updatedAt: now,
  });
}

async function resolveLocation(companyId, address, cache, now) {
  const name = locationNameFromAddress(address);
  if (!name) return "";
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  const existing = (await listCompanyLocations(companyId)).find(
    (row) => row.name.toLowerCase() === key
  );
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }
  const created = await insertLocation({
    id: randomUUID(),
    companyId,
    name,
    address: address || "",
    details: "",
    createdAt: now,
    updatedAt: now,
  });
  cache.set(key, created.id);
  return created.id;
}

function matchPerson(people, contact) {
  const needle = String(contact || "").trim().toLowerCase();
  if (!needle) return "";
  const hit = people.find((person) => person.name.toLowerCase() === needle);
  return hit?.id || "";
}

async function main() {
  const pdfPath = path.resolve(process.argv[2] || DEFAULT_PDF);
  const companyName = process.argv[3] || "159 A&D";
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF not found: ${pdfPath}`);
  }

  await ensureReady();
  const db = await readDb();
  const company = (db.companies || []).find(
    (row) => row.name.toLowerCase() === companyName.toLowerCase()
  );
  if (!company) {
    throw new Error(`Company not found: ${companyName}`);
  }

  const records = parsePdf(pdfPath);
  const now = new Date().toISOString();
  const people = company.people || [];
  const locationCache = new Map(
    (await listCompanyLocations(company.id)).map((row) => [row.name.toLowerCase(), row.id])
  );
  const usedNumbers = new Set();

  let created = 0;
  let updated = 0;
  for (const record of records) {
    const manufacturer = await resolveManufacturer(record.manufacturer, now);
    const assetType = await resolveAssetType(record.configurationType, now);
    const locationId = await resolveLocation(
      company.id,
      record.address,
      locationCache,
      now
    );
    const personId = matchPerson(people, record.contact);
    const assetNumber = chooseAssetNumber(record, usedNumbers);
    const existing = await findAssetByNumber(company.id, assetNumber);
    const payload = {
      name: record.name,
      assetNumber,
      manufacturerId: manufacturer.id,
      assetTypeId: assetType.id,
      image: "",
      personId,
      locationId,
      status: record.status || "",
      notes: record.notes || "",
      vendor: record.vendor || "",
      contactName: record.contact || "",
      address: record.address || "",
      modelNumber: record.modelNumber || "",
      tagNumber: record.tagNumber || "",
      country: record.country || "",
      purchaseDate: record.purchaseDate || "",
      installationDate: record.installationDate || "",
      department: record.department || "",
      warrantyExpiration: record.warrantyExpiration || "",
      installedBy: record.installedBy || "",
      billCustomer: record.billCustomer || "",
      ipAddress: record.ipAddress || "",
      deviceId: record.deviceId || "",
      defaultGateway: record.defaultGateway || "",
      macAddress: record.macAddress || "",
      cpuSpeed: record.cpuSpeed || "",
      osType: record.osType || "",
      physicalMemory: record.physicalMemory || "",
      osInfo: record.osInfo || "",
      localHardDrives: record.localHardDrives || "",
      lastLoginName: record.lastLoginName || "",
      vendorNotes: record.vendorNotes || "",
    };

    if (existing) {
      await updateAssetRecord(company.id, existing.id, payload);
      updated += 1;
      continue;
    }

    await insertAsset({
      id: randomUUID(),
      companyId: company.id,
      createdAt: now,
      updatedAt: now,
      ...payload,
    });
    created += 1;
  }

  console.log(
    JSON.stringify(
      {
        company: company.name,
        records: records.length,
        created,
        updated,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
