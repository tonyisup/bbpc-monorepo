import { useBbpcAdminAuth } from "@/components/auth/BbpcAdminAuthContext";
import { ConvexAdminDashboard } from "@/components/Dashboard/ConvexAdminDashboard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Head from "next/head";

export default function Home() {
  const { signOut, user } = useBbpcAdminAuth();

  // Layout renders the sign-in and account-issue cards for every route.
  if (!user) {
    return null;
  }
  if (!user.isAdmin) {
    return (
      <>
        <Head>
          <title>BBPC Admin - Access Required</title>
        </Head>
        <Card className="mx-auto mt-12 max-w-xl">
          <CardHeader>
            <CardTitle>Administrator access required</CardTitle>
            <CardDescription>
              This account does not have administrator access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={signOut}>
              Sign out
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }
  return (
    <>
      <Head>
        <title>BBPC Admin - Dashboard</title>
      </Head>
      <ConvexAdminDashboard userName={user.name} />
    </>
  );
}
