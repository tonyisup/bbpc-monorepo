import Head from "next/head";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { useBbpcAdminAuth } from "./BbpcAdminAuthContext";

export function AdminSignInCard() {
  const { signIn } = useBbpcAdminAuth();

  return (
    <>
      <Head>
        <title>BBPC Admin - Login</title>
      </Head>
      <Card className="w-[350px] shadow-lg">
        <CardHeader className="text-center">
          <CardTitle>BBPC Admin</CardTitle>
          <CardDescription>Sign in to manage the podcast</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center pb-8">
          <Button onClick={signIn} size="lg">
            Sign In with Provider
          </Button>
        </CardContent>
      </Card>
    </>
  );
}

export function AdminAccountIssueCard() {
  const { accountIssue, refreshAccount, signOut } = useBbpcAdminAuth();
  const message =
    accountIssue === "account-disabled"
      ? "This account is disabled."
      : accountIssue === "identity-conflict"
        ? "This sign-in is already linked to another BBPC account."
        : accountIssue === "linking-disabled"
          ? "Account linking is paused in this environment."
          : accountIssue === "stale-client"
            ? "This admin client is out of date."
            : "The BBPC account could not be resolved.";

  return (
    <Card className="w-[420px] max-w-[calc(100vw-2rem)] shadow-lg">
      <CardHeader>
        <CardTitle>Admin account needs attention</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Button onClick={refreshAccount}>Try again</Button>
        <Button variant="outline" onClick={signOut}>
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}
