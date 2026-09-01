#!/usr/bin/env python3
"""Extract configuration records from a Forward Tech Solutions PDF export."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

LEFT_FIELDS = [
    "Configuration Type",
    "Warranty Expiration",
    "Installation Date",
    "Purchase Date",
    "Installed By",
    "Serial Number",
    "Model Number",
    "Tag Number",
    "Manufacturer",
    "Default Gateway",
    "Local Hard Drives",
    "Last Login Name",
    "Physical Memory",
    "CPU Speed",
    "IP Address",
    "Vendor Notes",
    "Vendor",
    "Name",
    "Notes",
]

RIGHT_FIELDS = [
    "Bill Customer?",
    "MAC Address",
    "Device ID",
    "OS Type",
    "OS Info",
    "Status",
    "Company",
    "Contact",
    "Address",
    "Country",
    "Location",
    "Department",
]

ALL_FIELDS = sorted(set(LEFT_FIELDS + RIGHT_FIELDS), key=len, reverse=True)
LABEL_RE = re.compile(
    r"(?P<label>" + "|".join(re.escape(name) for name in ALL_FIELDS) + r"):"
)
HEADER_RE = re.compile(
    r"^(Forward Tech Solutions|Configuration Report|Configuration Details|Device Details)\s*$",
    re.I,
)
FOOTER_RE = re.compile(r"Confidential\s+Page\s+\d+\s+of\s+\d+", re.I)
PAGE_RE = re.compile(r"Page\s+(\d+)\s+of\s+(\d+)", re.I)
CITY_STATE_RE = re.compile(r"^[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$")


def collapse(value: str) -> str:
    return re.sub(r"[ \t]+", " ", (value or "").replace("\xa0", " ")).strip()


def split_gapped(value: str) -> tuple[str, str]:
    raw = value.replace("\xa0", " ").rstrip()
    if not raw.strip():
        return "", ""
    leading = len(raw) - len(raw.lstrip(" "))
    stripped = raw.strip()
    if leading >= 40:
        return "", collapse(stripped)
    parts = [p.strip() for p in re.split(r" {6,}", stripped) if p.strip()]
    if len(parts) >= 2:
        return collapse(parts[0]), collapse(" ".join(parts[1:]))
    return collapse(stripped), ""


def take_bill_customer(value: str) -> tuple[str, str | None]:
    text = collapse(value)
    match = re.search(r"\bBill Customer\??\s*(.*)$", text, re.I)
    if not match:
        return text, None
    before = collapse(text[: match.start()])
    after = collapse(match.group(1))
    return before, after


def page_text(page) -> str:
    return page.extract_text(extraction_mode="layout") or ""


def strip_chrome(text: str) -> str:
    lines = []
    for raw in text.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            lines.append("")
            continue
        if HEADER_RE.match(stripped):
            continue
        if FOOTER_RE.search(stripped):
            continue
        lines.append(line)
    return "\n".join(lines).strip()


def body_for_notes(text: str) -> str:
    cleaned = strip_chrome(text)
    cleaned = re.sub(r"(?im)^Configuration Questions\s*$", "", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned


def parse_labeled_block(text: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    last_key = ""
    last_left_key = ""

    def append(key: str, value: str) -> None:
        value = collapse(value)
        if not key or not value:
            return
        if key in fields and fields[key]:
            if key == "Address" and CITY_STATE_RE.match(value):
                fields[key] = f"{fields[key]}, {value}"
            else:
                fields[key] = collapse(f"{fields[key]} {value}")
        else:
            fields[key] = value

    for raw in text.splitlines():
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            continue
        if HEADER_RE.match(stripped) or FOOTER_RE.search(stripped):
            continue
        if stripped == "Configuration Questions":
            break

        matches = list(LABEL_RE.finditer(line))
        leading = len(line) - len(line.lstrip(" "))
        if not matches or matches[0].start() > 8:
            wrap_key = last_left_key if leading < 55 and last_left_key else last_key
            if wrap_key in ("Notes", "Vendor Notes"):
                append(wrap_key, stripped)
            elif wrap_key:
                leftover_left, leftover_right = split_gapped(stripped)
                leftover_left, bill = take_bill_customer(leftover_left)
                if bill is not None:
                    append("Bill Customer?", bill)
                if wrap_key == "Serial Number" and leftover_right:
                    append("Address", leftover_right)
                    append(wrap_key, leftover_left)
                else:
                    append(wrap_key, leftover_left)
                    if leftover_right and leftover_right.lower() != "bill customer?":
                        leftover_right, bill = take_bill_customer(leftover_right)
                        if bill is not None:
                            append("Bill Customer?", bill)
                        if leftover_right:
                            append("Address", leftover_right)
            continue

        for index, match in enumerate(matches):
            label = match.group("label")
            start = match.end()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
            value = line[start:end]
            left, right = split_gapped(value)
            left, bill = take_bill_customer(left)
            if bill is not None:
                append("Bill Customer?", bill)
            if right:
                right, bill = take_bill_customer(right)
                if bill is not None:
                    append("Bill Customer?", bill)
            if label == "Serial Number":
                if left and CITY_STATE_RE.match(left) and not right:
                    append("Address", left)
                else:
                    append(label, left)
                    if right:
                        append("Address", right)
            elif label == "Address":
                append(label, left or right)
            else:
                append(label, left)
                if right and label not in RIGHT_FIELDS:
                    if CITY_STATE_RE.match(right) or label in LEFT_FIELDS:
                        append("Address", right)
            last_key = label
            if label in LEFT_FIELDS:
                last_left_key = label

    return fields


def parse_record_page(text: str) -> dict[str, str] | None:
    if "Configuration Type:" not in text and not re.search(
        r"(?m)^Name:\s+\S", text
    ):
        return None
    block = text
    if "Configuration Details" in block:
        block = block.split("Configuration Details", 1)[1]
    if "Configuration Questions" in block:
        block = block.split("Configuration Questions", 1)[0]
    fields = parse_labeled_block(block)
    if not fields.get("Name") and not fields.get("Configuration Type"):
        return None
    return fields


def normalize_record(fields: dict[str, str], extra_notes: list[str]) -> dict:
    vendor_notes = fields.pop("Vendor Notes", "")
    notes = fields.pop("Notes", "")
    extra_parts = [part for part in extra_notes if part]
    notes_parts = [part for part in (notes, *extra_parts) if part]
    serial = fields.get("Serial Number", "")
    if serial and CITY_STATE_RE.match(serial):
        address = fields.get("Address", "")
        fields["Address"] = f"{address}, {serial}".strip(", ") if address else serial
        serial = ""
        fields["Serial Number"] = ""
    for key in ("Installed By", "Address", "Vendor", "Contact"):
        value = fields.get(key, "")
        cleaned, bill = take_bill_customer(value)
        if bill is not None:
            fields[key] = cleaned
            if bill and not fields.get("Bill Customer?"):
                fields["Bill Customer?"] = bill
    return {
        "configurationType": fields.get("Configuration Type", ""),
        "status": fields.get("Status", ""),
        "name": fields.get("Name", ""),
        "company": fields.get("Company", ""),
        "vendor": fields.get("Vendor", ""),
        "contact": fields.get("Contact", ""),
        "manufacturer": fields.get("Manufacturer", ""),
        "address": fields.get("Address", ""),
        "modelNumber": fields.get("Model Number", ""),
        "serialNumber": serial,
        "tagNumber": fields.get("Tag Number", ""),
        "country": fields.get("Country", ""),
        "purchaseDate": fields.get("Purchase Date", ""),
        "location": fields.get("Location", ""),
        "installationDate": fields.get("Installation Date", ""),
        "department": fields.get("Department", ""),
        "warrantyExpiration": fields.get("Warranty Expiration", ""),
        "installedBy": fields.get("Installed By", ""),
        "billCustomer": fields.get("Bill Customer?", ""),
        "ipAddress": fields.get("IP Address", ""),
        "deviceId": fields.get("Device ID", ""),
        "defaultGateway": fields.get("Default Gateway", ""),
        "macAddress": fields.get("MAC Address", ""),
        "cpuSpeed": fields.get("CPU Speed", ""),
        "osType": fields.get("OS Type", ""),
        "physicalMemory": fields.get("Physical Memory", ""),
        "osInfo": fields.get("OS Info", ""),
        "localHardDrives": fields.get("Local Hard Drives", ""),
        "lastLoginName": fields.get("Last Login Name", ""),
        "vendorNotes": vendor_notes,
        "notes": "\n\n".join(notes_parts).strip(),
    }


def parse_pdf(path: Path) -> list[dict]:
    reader = PdfReader(str(path))
    records: list[dict] = []
    current: dict[str, str] | None = None
    extra_notes: list[str] = []

    def flush() -> None:
        nonlocal current, extra_notes
        if current:
            records.append(normalize_record(current, extra_notes))
        current = None
        extra_notes = []

    for page in reader.pages:
        text = page_text(page)
        parsed = parse_record_page(text)
        if parsed:
            flush()
            current = parsed
            leftover = body_for_notes(text)
            # Keep only the Notes / Vendor Notes already captured; continuation
            # pages without a new record header are appended below.
            continue
        continuation = body_for_notes(text)
        if continuation and current is not None:
            extra_notes.append(continuation)

    flush()
    return records


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: parse-import-pdf.py <file.pdf>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1]).expanduser()
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 1
    records = parse_pdf(path)
    json.dump(records, sys.stdout, indent=2, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
