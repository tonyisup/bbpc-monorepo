import { clerkMiddleware } from '@clerk/nextjs/server';

const vercelDeploymentOrigin = process.env.VERCEL_URL
  ? [`https://${process.env.VERCEL_URL}`]
  : [];
const authorizedParties =
  process.env.NODE_ENV === 'production'
    ? ['https://record.badboyspodcast.com', ...vercelDeploymentOrigin]
    : ['http://localhost:3000'];

export default clerkMiddleware({ authorizedParties });

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
