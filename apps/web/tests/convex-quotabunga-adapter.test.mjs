import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/** @param {string} path */
const read = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [participation, component, adapter] = await Promise.all([
  read("src/components/GameParticipation.tsx"),
  read("src/components/ConvexQuotabungaSubmission.tsx"),
  read("src/convex/quotabunga.ts"),
]);

test("Convex Quotabunga uses authenticated owner-derived functions", () => {
  for (const name of [
    "games/quotes:currentForMe",
    "games/quotes:submitMine",
    "games/quotes:withdrawMine",
  ]) {
    assert.match(adapter, new RegExp(name.replace("/", "\\/"), "u"));
  }
  assert.doesNotMatch(adapter, /userId/u);
  assert.match(adapter, /BBPC_CLIENT_API_VERSION/u);
  assert.match(adapter, /currentQuoteSubmissionSchema\.parse/u);
  assert.match(adapter, /quoteSubmissionSchema\.parse/u);
  assert.match(adapter, /getPacificTodayPlainDate/u);
});

test("Convex Quotabunga does not depend on the SQL auth or transport stack", () => {
  assert.doesNotMatch(component, /next-auth|trpc|prisma|server\/db/u);
  assert.match(component, /submission\.scored/u);
  assert.match(component, /current\?\.isOpen/u);
  assert.match(component, /getConvexDomainErrorCode/u);
});

test("game participation exposes quote writes only after canonical identity resolution", () => {
  assert.match(participation, /accountStatus !== "ready"/u);
  assert.match(participation, /user\.appUserId === null/u);
  assert.match(
    participation,
    /<ConvexQuotabungaSubmission/u
  );
  assert.match(participation, /<ConvexPredictionGame/u);
  assert.doesNotMatch(participation, /backend|<PredictionGame|<QuotabungaSubmission \/>/u);
});
