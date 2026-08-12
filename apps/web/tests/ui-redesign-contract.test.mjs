import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (/** @type {string} */ path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the retired Tags feature has no UI or API surface and legacy URLs redirect", () => {
  assert.equal(existsSync(new URL("../src/app/tags", import.meta.url)), false);
  assert.equal(
    existsSync(
      new URL("../src/server/api/routers/tagRouter.ts", import.meta.url)
    ),
    false
  );
  assert.equal(
    existsSync(
      new URL("../src/components/TagSelectorPopover.tsx", import.meta.url)
    ),
    false
  );
  assert.equal(
    existsSync(
      new URL("../src/components/MovieSearchCard.tsx", import.meta.url)
    ),
    false
  );

  const nav = read("src/components/NavMenu.tsx");
  assert.doesNotMatch(nav, /href:\s*["']\/tags/);

  assert.equal(
    existsSync(new URL("../src/server/api", import.meta.url)),
    false
  );

  const nextConfig = read("next.config.mjs");
  assert.match(nextConfig, /source:\s*"\/tags"/);
  assert.match(nextConfig, /source:\s*"\/tags\/:path\*"/);
  assert.match(nextConfig, /destination:\s*["']\/history["']/);
});

test("the global shell uses the shared BBPC header and semantic visual tokens", () => {
  const layout = read("src/app/layout.tsx");
  const nav = read("src/components/NavMenu.tsx");
  assert.match(layout, /<SiteHeader\s*\/?>/);
  assert.doesNotMatch(
    layout,
    /<section className="py-2 flex flex-col items-center">/
  );
  assert.doesNotMatch(layout, /maximumScale/);
  assert.match(layout, /<main className="[^"]*min-w-0/);
  assert.match(
    nav,
    /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/
  );
  assert.doesNotMatch(nav, />Login<|>Logout</);
  assert.match(nav, /xl:flex/);
  assert.match(nav, /xl:hidden/);
  assert.match(nav, /aria-label="Open navigation menu"/);

  const styles = read("src/styles/globals.css");
  assert.match(styles, /--bbpc-accent:/);
  assert.match(styles, /--bbpc-surface:/);
  assert.match(styles, /\.bbpc-panel/);
  assert.doesNotMatch(styles, /overflow-x:\s*(hidden|clip)/);
  assert.doesNotMatch(styles, /min-width:\s*320px/);
});

test("home and game prioritize participation without duplicate retired behavior", () => {
  const home = read("src/app/page.tsx");
  assert.match(home, /Latest episode/);
  assert.match(home, /Up next/);

  const moviePreview = read("src/components/MovieInlinePreview.tsx");
  const latestEpisode = read("src/components/LatestEpisode.tsx");
  const episode = read("src/components/Episode.tsx");
  const episodeSkeleton = read("src/components/EpisodeSkeleton.tsx");
  const gameParticipation = read("src/components/GameParticipation.tsx");
  const standings = read("src/components/SeasonStandingsDisclosure.tsx");
  assert.match(moviePreview, /priority\?: boolean/);
  assert.match(latestEpisode, /priority=\{index === 0\}/);
  assert.match(episode, /<GameParticipation/);
  assert.match(episodeSkeleton, /min-w-0/);
  assert.doesNotMatch(episodeSkeleton, /h-\[216px\] w-\[144px\]/);
  assert.equal((gameParticipation.match(/Sign in to play/g) ?? []).length, 1);
  assert.match(standings, /isOpen\s*&&\s*\(/);
  assert.match(standings, /<GamePerformanceTracking/);

  const game = read("src/app/game/page.tsx");
  const nextEpisodeIndex = game.indexOf("<Episode");
  const standingsIndex = game.indexOf("<SeasonStandingsDisclosure");
  assert.notEqual(nextEpisodeIndex, -1);
  assert.notEqual(standingsIndex, -1);
  assert.ok(nextEpisodeIndex < standingsIndex);
  assert.doesNotMatch(game, /<NextEpisode/);
  assert.match(game, /getNextScheduledEpisode\(\)/);
  assert.match(game, /getConvexCurrentPerformance\(today\)/);
  assert.doesNotMatch(game, /vote on movie tags/i);
  assert.match(game, /<details/);
  assert.match(game, /1x multiplier/i);
  assert.match(game, /2x multiplier/i);
  assert.match(game, /3x multiplier/i);
  assert.match(game, /Bonus Harley/i);
  assert.doesNotMatch(game, /<Suspense/);
  assert.doesNotMatch(game, /<CurrentRoundErrorBoundary/);
  assert.match(game, /role="status"/);

});

test("deferred analytics and above-fold images avoid runtime console noise", () => {
  const year = read("src/app/year/ConvexYearPageClient.tsx");
  const moviePreview = read("src/components/MovieInlinePreview.tsx");
  const about = read("src/app/about/page.tsx");

  assert.match(year, /status === "authenticated"/);
  assert.match(year, /priority=\{index === 0\}/);
  assert.doesNotMatch(year, /type ViewMode = "grid" \| "table"/);
  assert.match(year, /router\.replace/);
  assert.match(year, /role="group"\s+aria-label="View"/);
  assert.match(year, /review\.rating\.name/);
  assert.match(moviePreview, /priority\?: boolean/);
  assert.match(about, /priority/);
});

test("history, about, and footer implement the approved content and accessibility guidance", () => {
  const history = read("src/app/history/HistoryPageClient.tsx");
  assert.match(history, /Match close spellings/);
  assert.match(history, /Browse all episodes/);
  assert.match(history, /flex-col[^"\n]*sm:flex-row/);
  const emptyStateIndex = history.indexOf("if (!query)");
  const loadingStateIndex = history.indexOf("if (isLoading)");
  assert.notEqual(emptyStateIndex, -1);
  assert.notEqual(loadingStateIndex, -1);
  assert.ok(emptyStateIndex < loadingStateIndex);
  assert.match(history, /return \(\s*<ul/);
  assert.match(history, /router\.push\([\s\S]*?\{ scroll: false \}\)/);
  assert.doesNotMatch(history, /role="status"/);
  assert.match(history, /Search by episode title or movie name\./);
  assert.doesNotMatch(history, /movie name, or number/);

  const about = read("src/app/about/page.tsx");
  assert.doesNotMatch(about, /Generated by AI/i);
  assert.doesNotMatch(about, /the the woods/i);
  assert.match(about, /bad-ghibli-boys\.png/);

  const footer = read("src/components/ListenHere.tsx");
  assert.match(footer, /grid grid-cols-2/);
  assert.match(footer, /SiSpotify/);
  assert.doesNotMatch(footer, /<svg/);
});

test("game participation keeps Quotabunga available without prediction assignments", () => {
  const episode = read("src/components/Episode.tsx");
  const participation = read("src/components/GameParticipation.tsx");

  assert.doesNotMatch(
    episode,
    /showGames\s*&&\s*predictionAssignments\.length\s*>\s*0/
  );
  assert.match(participation, /assignments\.length\s*>\s*0\s*\?/);
  assert.ok(
    participation.indexOf("assignments.length > 0") <
      participation.indexOf("<ConvexQuotabungaSubmission")
  );
});

test("voice messages use the Convex recorder without a SQL fallback", () => {
  const leaveMessage = read("src/components/LeaveMessage.tsx");
  const recorder = read("src/components/ConvexVoiceMailRecorder.tsx");

  assert.match(leaveMessage, /aria-label="Log in to leave a message"/);
  assert.match(leaveMessage, /aria-label="Leave a message"/);
  assert.match(leaveMessage, /<ConvexVoiceMailRecorder enabled=\{isModalOpen\}/);
  assert.doesNotMatch(leaveMessage, /SqlMessageContent|voice-mail-recorder|trpc/);
  assert.match(recorder, /episodes\/public:nextScheduled/);
  assert.match(recorder, /No upcoming episode/i);
});

test("latest movie previews declare their rendered responsive sizes", () => {
  const moviePreview = read("src/components/MovieInlinePreview.tsx");
  const latestEpisode = read("src/components/LatestEpisode.tsx");

  assert.match(moviePreview, /sizes\?: string/);
  assert.match(moviePreview, /sizes=\{imageSizes\}/);
  assert.match(moviePreview, /\? "\(max-width: 640px\) 48px, 144px"/);
  assert.match(moviePreview, /: "\(max-width: 640px\) 96px, 144px"/);
  assert.equal(
    (latestEpisode.match(/sizes="\(max-width: 639px\) 72px, 108px"/g) ?? [])
      .length,
    2
  );
});

test("authenticated mobile navigation mirrors active route semantics", () => {
  const nav = read("src/components/NavMenu.tsx");
  const mobileDropdownStart = nav.indexOf("Mobile dropdown");
  assert.notEqual(mobileDropdownStart, -1);
  const mobileAuthStart = nav.indexOf("{authNavItems", mobileDropdownStart);
  const mobileAuthEnd = nav.indexOf("{isLoggedIn ?", mobileAuthStart);
  assert.notEqual(mobileAuthStart, -1);
  assert.notEqual(mobileAuthEnd, -1);
  const mobileAuthNav = nav.slice(mobileAuthStart, mobileAuthEnd);

  assert.match(
    mobileAuthNav,
    /aria-current=\{isActive\(item\.href\) \? "page" : undefined\}/
  );
  assert.match(mobileAuthNav, /bg-red-500\/10 text-red-300/);
});

test("year ranking candidates are movie-grouped, labelled, and submit once", () => {
  const year = read("src/app/year/ConvexYearPageClient.tsx");

  assert.match(year, /const selectedYear = getSelectedYear\(searchParams\.get\("y"\)/);
  assert.match(year, /getInitialViewMode\(searchParams\.get\("view"\)\)/);
  assert.match(year, /const sortDesc = searchParams\.get\("sort"\) !== "asc"/);
  assert.doesNotMatch(year, /lastSyncedSearchParams/);
  assert.match(
    year,
    /replaceControls\(\{ year: Number\(event\.target\.value\) \}\)/
  );
  assert.match(year, /replaceControls\(\{ descending: !sortDesc \}\)/);
  assert.match(year, /replaceControls\(\{ view: "grid" \}\)/);
  assert.match(year, /replaceControls\(\{ view: "list" \}\)/);
  assert.match(year, /const groupedMovies = useMemo/);
  assert.match(year, /groupedMovies\.map\(\(group\)/);
  assert.match(year, /htmlFor="ranked-list-selector"/);
  assert.match(year, /id="ranked-list-selector"/);
  assert.match(year, /htmlFor=\{`rank-select-\$\{group\.movie\.id\}`\}/);
  assert.match(year, /id=\{`rank-select-\$\{group\.movie\.id\}`\}/);
  assert.match(year, /value=\{selectedRank\}/);
  assert.match(year, /setRankSelections/);
  assert.match(year, /Number\.parseInt\(selectedRank/);
  assert.doesNotMatch(year, /previousElementSibling/);
  assert.match(year, /const existingItem = selectedList\?\.items\.find/);
  assert.doesNotMatch(
    year,
    /<select[\s\S]{0,500}onChange=\{[\s\S]{0,300}upsertConvexMovieRankingItem/
  );
  assert.match(year, /await upsertConvexMovieRankingItem/);
  assert.match(year, /await reorderConvexMovieRankingItems/);
  assert.match(year, /await removeConvexMovieRankingItem/);
});
