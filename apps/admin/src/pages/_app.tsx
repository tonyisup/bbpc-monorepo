import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ClerkBbpcAdminAuthProvider } from "@/components/auth/BbpcAdminAuthContext";
import { AdminAppFrame } from "@/components/providers/AdminAppFrame";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type AppType } from "next/app";

import "../styles/globals.css";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convexClient =
  convexUrl === undefined ? null : new ConvexReactClient(convexUrl);

const App: AppType = ({
  Component,
  pageProps,
}) => {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (publishableKey === undefined || convexClient === null) {
    throw new Error(
      "BBPC Admin requires NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_CONVEX_URL."
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <ConvexProviderWithClerk client={convexClient} useAuth={useAuth}>
        <ClerkBbpcAdminAuthProvider>
          <AdminAppFrame>
            <Component {...pageProps} />
          </AdminAppFrame>
        </ClerkBbpcAdminAuthProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};

export default App;
