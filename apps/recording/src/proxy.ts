import { clerkMiddleware } from '@clerk/nextjs/server';

// A preview is reached by its unique deployment URL and by its branch alias
// (bbpc-recording-git-<branch>-…vercel.app); accept sessions from both.
const vercelPreviewOrigins = [
  process.env.VERCEL_URL,
  process.env.VERCEL_BRANCH_URL,
]
  .filter((host): host is string => Boolean(host))
  .map((host) => `https://${host}`);
const authorizedParties =
  process.env.NODE_ENV === 'production'
    ? ['https://record.badboyspodcast.com', ...vercelPreviewOrigins]
    : ['http://localhost:3000'];

export default clerkMiddleware({ authorizedParties });

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
