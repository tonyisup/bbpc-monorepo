import { ConvexAddExtraPage } from "./ConvexAddExtraPage";

interface AddExtraPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AddExtraPage({ params }: AddExtraPageProps) {
  const { slug } = await params;
  return <ConvexAddExtraPage slug={slug} />;
}
