import type { MovieYearQueryAnalysis } from "./index";

export type MovieYearConformanceFixture = {
  name: string;
  input: string;
  frontend: MovieYearQueryAnalysis & { shouldRequest: boolean };
  backend:
    | { kind: "success"; query: string | null; year: number | null }
    | { kind: "validation-error" };
};

const maxAppendableTitle = "a".repeat(197);
const appendOverflowTitle = "a".repeat(198);

export const movieYearConformanceFixtures: readonly MovieYearConformanceFixture[] = [
  {
    name: "plain title",
    input: "  Imposter  ",
    frontend: {
      normalizedQuery: "Imposter",
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: true,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter", year: null },
  },
  {
    name: "valid release-year modifier",
    input: "Imposter y:2001",
    frontend: {
      normalizedQuery: "Imposter y:2001",
      syntax: "searchable",
      hasValidModifier: true,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter", year: 2001 },
  },
  {
    name: "case-insensitive repeated release-year modifier",
    input: "Imposter Y:2001 y:2001",
    frontend: {
      normalizedQuery: "Imposter Y:2001 y:2001",
      syntax: "searchable",
      hasValidModifier: true,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter", year: 2001 },
  },
  {
    name: "unicode-normalized modifier",
    input: "Ｉｍｐｏｓｔｅｒ ｙ：２００１",
    frontend: {
      normalizedQuery: "Imposter y:2001",
      syntax: "searchable",
      hasValidModifier: true,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter", year: 2001 },
  },
  {
    name: "bare release year",
    input: "Imposter 2001",
    frontend: {
      normalizedQuery: "Imposter 2001",
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: 2001,
      canAppendModifier: true,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter 2001", year: null },
  },
  {
    name: "parenthesized release year",
    input: "Imposter (2001)",
    frontend: {
      normalizedQuery: "Imposter (2001)",
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: 2001,
      canAppendModifier: true,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter (2001)", year: null },
  },
  {
    name: "out-of-range bare release year",
    input: "Imposter (0001)",
    frontend: {
      normalizedQuery: "Imposter (0001)",
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: true,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter (0001)", year: null },
  },
  {
    name: "numeric title is not a bare release year",
    input: "1917",
    frontend: {
      normalizedQuery: "1917",
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: true,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "1917", year: null },
  },
  ...["y:", "y:2", "y:20", "y:200"].map(
    (suffix): MovieYearConformanceFixture => ({
      name: `incomplete modifier ${suffix}`,
      input: `Imposter ${suffix}`,
      frontend: {
        normalizedQuery: `Imposter ${suffix}`,
        syntax: "incomplete",
        hasValidModifier: false,
        releaseYearCandidate: null,
        canAppendModifier: false,
        shouldRequest: false,
      },
      backend: { kind: "success", query: `Imposter ${suffix}`, year: null },
    }),
  ),
  {
    name: "malformed alphabetic modifier",
    input: "Imposter y:abcd",
    frontend: {
      normalizedQuery: "Imposter y:abcd",
      syntax: "invalid",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter y:abcd", year: null },
  },
  {
    name: "malformed five-digit modifier",
    input: "Imposter y:20010",
    frontend: {
      normalizedQuery: "Imposter y:20010",
      syntax: "invalid",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "success", query: "Imposter y:20010", year: null },
  },
  {
    name: "out-of-range complete modifier",
    input: "Imposter y:0001",
    frontend: {
      normalizedQuery: "Imposter y:0001",
      syntax: "invalid",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "validation-error" },
  },
  {
    name: "conflicting complete modifiers",
    input: "Imposter y:2001 y:2002",
    frontend: {
      normalizedQuery: "Imposter y:2001 y:2002",
      syntax: "invalid",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "validation-error" },
  },
  {
    name: "maximum appendable title",
    input: maxAppendableTitle,
    frontend: {
      normalizedQuery: maxAppendableTitle,
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: true,
      shouldRequest: true,
    },
    backend: { kind: "success", query: maxAppendableTitle, year: null },
  },
  {
    name: "append would exceed maximum length",
    input: appendOverflowTitle,
    frontend: {
      normalizedQuery: appendOverflowTitle,
      syntax: "searchable",
      hasValidModifier: false,
      releaseYearCandidate: null,
      canAppendModifier: false,
      shouldRequest: true,
    },
    backend: { kind: "success", query: appendOverflowTitle, year: null },
  },
];
