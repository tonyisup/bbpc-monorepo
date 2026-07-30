import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const packet = fs.readFileSync(
  path.join(root, "PRODUCTION_PREFLIGHT_PACKET_2026-07-28.md"),
  "utf8",
);
const runbook = fs.readFileSync(
  path.join(root, "CONSUMER_CUTOVER_RUNBOOK.md"),
  "utf8",
);
const goNoGo = fs.readFileSync(
  path.join(root, "CUTOVER_GO_NO_GO.md"),
  "utf8",
);

const cutoverNames = [
  "NEXT_PUBLIC_BBPC_BACKEND",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
];

function between(document, startMarker, endMarker) {
  const startIndex = document.indexOf(startMarker);
  assert.ok(startIndex >= 0, `Missing start marker: ${startMarker}`);
  const contentStart = startIndex + startMarker.length;
  const endIndex = document.indexOf(endMarker, contentStart);
  assert.ok(endIndex > contentStart, `Missing end marker: ${endMarker}`);
  return document.slice(contentStart, endIndex);
}

function environmentNames(document) {
  return [
    ...document.matchAll(/`([A-Z][A-Z0-9_]*)(?:=[^`]*)?`/gu),
  ].map((match) => match[1]);
}

function asUniqueSet(names, label) {
  const result = new Set(names);
  assert.equal(
    result.size,
    names.length,
    `${label} contains duplicate environment names.`,
  );
  return result;
}

function assertCompleteDisposition({
  observedNames,
  retainedNames,
  removedNames,
  project,
}) {
  for (const name of retainedNames) {
    assert.ok(
      !removedNames.has(name),
      `${project} classifies ${name} as both retained and removed.`,
    );
  }
  for (const name of observedNames) {
    assert.ok(
      retainedNames.has(name) || removedNames.has(name),
      `${project} Production name ${name} has no S4 disposition.`,
    );
  }
  for (const name of cutoverNames) {
    assert.ok(
      retainedNames.has(name),
      `${project} must retain cutover name ${name}.`,
    );
  }
}

test("every observed Vercel Production name has an explicit S4 disposition", () => {
  const publicObserved = asUniqueSet(
    environmentNames(
      between(
        packet,
        "Observed `bbpc` Production names, sorted:",
        "Observed `bbpc-admin` Production names, sorted:",
      ),
    ),
    "bbpc Production census",
  );
  const adminObserved = asUniqueSet(
    environmentNames(
      between(
        packet,
        "Observed `bbpc-admin` Production names, sorted:",
        "Source reconciliation found",
      ),
    ),
    "bbpc-admin Production census",
  );

  assert.equal(publicObserved.size, 18);
  assert.equal(adminObserved.size, 22);

  const publicRetained = asUniqueSet(
    environmentNames(
      between(
        runbook,
        "### `bbpc` variables retained in S4",
        "### `bbpc` variables removed in S4",
      ),
    ),
    "bbpc retained inventory",
  );
  const publicRemoved = asUniqueSet(
    environmentNames(
      between(
        runbook,
        "### `bbpc` variables removed in S4",
        "### `bbpc-admin` variables retained in S4",
      ),
    ),
    "bbpc removed inventory",
  );
  const adminRetained = asUniqueSet(
    environmentNames(
      between(
        runbook,
        "### `bbpc-admin` variables retained in S4",
        "### `bbpc-admin` variables removed in S4",
      ),
    ),
    "bbpc-admin retained inventory",
  );
  const adminRemoved = asUniqueSet(
    environmentNames(
      between(
        runbook,
        "### `bbpc-admin` variables removed in S4",
        "## Recording consumer handoff",
      ),
    ),
    "bbpc-admin removed inventory",
  );

  assertCompleteDisposition({
    observedNames: publicObserved,
    retainedNames: publicRetained,
    removedNames: publicRemoved,
    project: "bbpc",
  });
  assertCompleteDisposition({
    observedNames: adminObserved,
    retainedNames: adminRetained,
    removedNames: adminRemoved,
    project: "bbpc-admin",
  });
});

test("owner decisions stay aligned across production operator records", () => {
  const packetOperatorRows = [
    ...packet.matchAll(
      /^\| [^|\n]+ \| Tony \| Tony \| 2026-07-30 08:40 PDT \|$/gmu,
    ),
  ];
  const goNoGoOperatorRows = [
    ...goNoGo.matchAll(
      /^\| [^|\n]+ \| Tony \| Tony \| 2026-07-30 08:40 PDT \|$/gmu,
    ),
  ];

  assert.equal(packetOperatorRows.length, 8);
  assert.equal(goNoGoOperatorRows.length, 7);
  for (const document of [packet, goNoGo]) {
    assert.match(
      document,
      new RegExp(
        `Tony[\\s\\S]{0,100}2026-07-30 08:40 PDT`,
        "u",
      ),
    );
    assert.match(document, /provides no\s+personnel redundancy/u);
    assert.match(document, /unavailab[\s\S]{0,200}no-go/u);
  }
  assert.match(
    packet,
    /2026-08-01 12:00 PDT \(America\/Los_Angeles\)/u,
  );
  assert.match(
    packet,
    /Audience\/channel: `this Codex task[\s\S]{0,160}existing in-app read-only/u,
  );
  assert.match(
    packet,
    /Backup retention owner and deadline: `Tony; delete 30 days after successful S4`/u,
  );
  assert.match(
    packet,
    /SQL archive retention owner and deadline:[\s\S]{0,80}`Tony; retain immutable for 90 days after successful S4`/u,
  );
  assert.match(
    packet,
    /Production administrator smoke identity: `selected privately/u,
  );
  assert.match(
    packet,
    /Production ordinary-member smoke identity: `selected privately/u,
  );
  assert.equal(
    [
      ...packet.matchAll(
        /(?:Start|Abort\/rollback|Completion) message: `approved 2026-07-30`/gu,
      ),
    ].length,
    3,
  );
  assert.match(
    goNoGo,
    /Scheduled start: `2026-08-01 12:00 PDT \(America\/Los_Angeles\)`/u,
  );
  assert.match(
    goNoGo,
    /Portable-backup owner\/deadline:[\s\S]{0,80}delete 30 days after successful S4/u,
  );
  assert.match(
    goNoGo,
    /Immutable SQL-archive owner\/deadline:[\s\S]{0,80}retain 90 days after successful S4/u,
  );
  assert.doesNotMatch(
    between(
      packet,
      "## Maintenance and identity inputs",
      "## Remaining preflight gates",
    ),
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  );
});
