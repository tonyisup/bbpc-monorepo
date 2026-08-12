import { ConvexAssignmentPage } from "./ConvexAssignmentPage";

interface AssignmentPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function AssignmentPage({ params }: AssignmentPageProps) {
  const { slug } = await params;
  return <ConvexAssignmentPage slug={slug} />;
}
