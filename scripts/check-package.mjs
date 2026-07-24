import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "bbpc-convex-package-"),
);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

try {
  const packJson = run("npm", [
    "pack",
    "--dry-run",
    "--json",
    "--offline",
    "--cache",
    path.join(temporaryRoot, "npm-cache"),
  ]);
  const packResults = JSON.parse(packJson);
  const normalizedPackResults = Array.isArray(packResults)
    ? packResults
    : Object.values(packResults);
  if (normalizedPackResults.length !== 1) {
    throw new Error("npm pack returned an unexpected result");
  }
  const [packResult] = normalizedPackResults;
  const packedFiles = new Set(
    packResult.files.map((file) => file.path),
  );
  const requiredFiles = [
    "contracts/index.d.ts",
    "contracts/index.js",
    "contracts/generated/convexApi.d.ts",
    "contracts/generated/convexApi.js",
  ];
  const missingFiles = requiredFiles.filter(
    (file) => !packedFiles.has(file),
  );
  if (missingFiles.length > 0) {
    throw new Error(
      `Package is missing required files: ${missingFiles.join(", ")}`,
    );
  }

  const forbiddenFiles = [...packedFiles].filter(
    (file) =>
      file.includes(".env") ||
      file.endsWith(".test.ts") ||
      file.includes("/_generated/") ||
      file.startsWith("convex/") ||
      file === "contracts/convexApi.ts",
  );
  if (forbiddenFiles.length > 0) {
    throw new Error(
      `Package contains forbidden files: ${forbiddenFiles.join(", ")}`,
    );
  }

  const consumerRoot = path.join(temporaryRoot, "consumer");
  const packageScope = path.join(
    consumerRoot,
    "node_modules",
    "@tonyisup",
  );
  fs.mkdirSync(packageScope, { recursive: true });
  fs.symlinkSync(
    root,
    path.join(packageScope, "bbpc-convex-api"),
    "dir",
  );
  for (const dependency of ["convex", "convex-helpers"]) {
    fs.symlinkSync(
      path.join(root, "node_modules", dependency),
      path.join(consumerRoot, "node_modules", dependency),
      "dir",
    );
  }
  fs.writeFileSync(
    path.join(consumerRoot, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  fs.writeFileSync(
    path.join(consumerRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      include: ["consumer.ts"],
    }),
  );
  fs.writeFileSync(
    path.join(consumerRoot, "consumer.ts"),
    [
      'import { api } from "@tonyisup/bbpc-convex-api";',
      "import {",
      "  BBPC_API_VERSION,",
      "  type DomainErrorData,",
      '} from "@tonyisup/bbpc-convex-api/contracts";',
      "import type {",
      "  FunctionArgs,",
      "  FunctionReturnType,",
      '} from "convex/server";',
      "",
      "type UpdateNameArgs = FunctionArgs<",
      "  typeof api.identity.profile.updateMyName",
      ">;",
      "const updateNameArgs: UpdateNameArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      '  name: "Package Consumer",',
      "};",
      "type LatestEpisodeArgs = FunctionArgs<",
      "  typeof api.episodes.public.latestPublished",
      ">;",
      "type LatestEpisode = FunctionReturnType<",
      "  typeof api.episodes.public.latestPublished",
      ">;",
      "const latestEpisodeArgs: LatestEpisodeArgs = {",
      '  onOrBefore: "2026-07-24",',
      "};",
      "const latestEpisode: LatestEpisode = null;",
      "type SearchEpisodesArgs = FunctionArgs<",
      "  typeof api.episodes.public.search",
      ">;",
      "const searchEpisodesArgs: SearchEpisodesArgs = {",
      '  query: "matrix",',
      "  limit: 10,",
      "};",
      "type ListAudioArgs = FunctionArgs<",
      "  typeof api.episodes.audio.listMine",
      ">;",
      "declare const episodeId: ListAudioArgs['episodeId'];",
      "const listAudioArgs: ListAudioArgs = {",
      "  episodeId,",
      "  paginationOpts: { cursor: null, numItems: 20 },",
      "};",
      "type UpdateAudioArgs = FunctionArgs<",
      "  typeof api.episodes.audio.updateMine",
      ">;",
      "declare const audioMessageId: UpdateAudioArgs['id'];",
      "const updateAudioArgs: UpdateAudioArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      "  id: audioMessageId,",
      "  episodeId,",
      '  fileKey: "audio/message.webm",',
      "};",
      "type CreateAdminEpisodeArgs = FunctionArgs<",
      "  typeof api.episodes.admin.createEpisode",
      ">;",
      "const createAdminEpisodeArgs: CreateAdminEpisodeArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      "  number: 999,",
      '  title: "Package Contract",',
      "};",
      "type UpdateAdminEpisodeArgs = FunctionArgs<",
      "  typeof api.episodes.admin.updateEpisode",
      ">;",
      "const updateAdminEpisodeArgs: UpdateAdminEpisodeArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      "  id: episodeId,",
      '  status: "recording",',
      "};",
      "type AddEpisodeLinkArgs = FunctionArgs<",
      "  typeof api.episodes.admin.addLink",
      ">;",
      "const addEpisodeLinkArgs: AddEpisodeLinkArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      "  episodeId,",
      '  url: "https://example.test/episode",',
      '  text: "Episode notes",',
      "};",
      "type ListAdminAudioArgs = FunctionArgs<",
      "  typeof api.episodes.admin.listAudioMessages",
      ">;",
      "const listAdminAudioArgs: ListAdminAudioArgs = {",
      "  episodeId,",
      "  paginationOpts: { cursor: null, numItems: 20 },",
      "};",
      "type SearchMoviesArgs = FunctionArgs<",
      "  typeof api.catalog.public.searchMovies",
      ">;",
      "const searchMoviesArgs: SearchMoviesArgs = {",
      '  query: "matrix",',
      "  limit: 10,",
      "};",
      "type ListAdminUsersArgs = FunctionArgs<",
      "  typeof api.identity.admin.listUsersPage",
      ">;",
      "const listAdminUsersArgs: ListAdminUsersArgs = {",
      "  paginationOpts: { cursor: null, numItems: 20 },",
      "};",
      "type GetAdminUserArgs = FunctionArgs<",
      "  typeof api.identity.admin.getUser",
      ">;",
      "declare const adminUserId: GetAdminUserArgs['id'];",
      "const getAdminUserArgs: GetAdminUserArgs = { id: adminUserId };",
      "type MyRoles = FunctionReturnType<",
      "  typeof api.identity.roles.mine",
      ">;",
      "const myRoles: MyRoles = [];",
      "type CreateAdminUserArgs = FunctionArgs<",
      "  typeof api.identity.admin.createUser",
      ">;",
      "const createAdminUserArgs: CreateAdminUserArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      '  name: "Package Consumer",',
      '  email: "consumer@example.test",',
      "};",
      "type SetAdminUserStatusArgs = FunctionArgs<",
      "  typeof api.identity.admin.setUserStatus",
      ">;",
      "const setAdminUserStatusArgs: SetAdminUserStatusArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      "  id: adminUserId,",
      '  status: "disabled",',
      "};",
      "type CreateRoleArgs = FunctionArgs<",
      "  typeof api.identity.admin.createRole",
      ">;",
      "const createRoleArgs: CreateRoleArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      '  name: "Producer",',
      '  description: "Produces episodes",',
      "  admin: false,",
      "};",
      "type AssignRoleArgs = FunctionArgs<",
      "  typeof api.identity.admin.assignRole",
      ">;",
      "declare const roleId: AssignRoleArgs['roleId'];",
      "const assignRoleArgs: AssignRoleArgs = {",
      "  clientApiVersion: BBPC_API_VERSION,",
      "  userId: adminUserId,",
      "  roleId,",
      "};",
      "const error: DomainErrorData = {",
      '  code: "WRITE_DISABLED",',
      '  message: "read only",',
      "  retryable: true,",
      "};",
      "void updateNameArgs;",
      "void latestEpisodeArgs;",
      "void latestEpisode;",
      "void searchEpisodesArgs;",
      "void listAudioArgs;",
      "void updateAudioArgs;",
      "void createAdminEpisodeArgs;",
      "void updateAdminEpisodeArgs;",
      "void addEpisodeLinkArgs;",
      "void listAdminAudioArgs;",
      "void searchMoviesArgs;",
      "void listAdminUsersArgs;",
      "void getAdminUserArgs;",
      "void myRoles;",
      "void createAdminUserArgs;",
      "void setAdminUserStatusArgs;",
      "void createRoleArgs;",
      "void assignRoleArgs;",
      "void error;",
      "",
    ].join("\n"),
  );

  run(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "--project",
      consumerRoot,
    ],
    { cwd: consumerRoot },
  );

  process.stdout.write(
    `Package contract passed. files=${packedFiles.size} consumerTypecheck=passed\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
