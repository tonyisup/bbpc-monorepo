import type { Metadata } from "next";

import { ConvexSeasonPage } from "./ConvexSeasonPage";

export const metadata: Metadata = {
  title: "Your season | BBPC",
};

export default async function ProfileSeasonPage({
  params,
}: {
  params: Promise<{ seasonId: string }>;
}) {
  const { seasonId } = await params;
  return <ConvexSeasonPage seasonId={seasonId} />;
}
