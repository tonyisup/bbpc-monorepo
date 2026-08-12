# BBPC (Bad Boys Podcast)

https://badboyspodcast.com/

A modern web application built with the T3 Stack, combining powerful technologies for a robust full-stack experience.

## ��� Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) with TypeScript
- **Authentication**: NextAuth.js for the current SQL path; Clerk is pinned for the Convex cutover
- **Database**: Prisma/SQL for the current path; Convex adapters are being migrated domain by domain
- **API**: [tRPC](https://trpc.io) for end-to-end typesafe APIs
- **Styling**: [Tailwind CSS](https://tailwindcss.com) with additional utilities:
  - Headless UI components
  - Radix UI primitives
  - Class Variance Authority
  - Tailwind Merge
  - Tailwind Animate
- **UI Components**:
  - Pure React Carousel
  - React Card Flip
  - React Icons
  - React Responsive
- **File Uploads**: Uploadthing integration
- **Form Validation**: Zod
- **Security**: Google ReCAPTCHA integration

## 🛠️ Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your environment variables
4. Initialize the database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```
5. Start the development server:
   ```bash
   npm run dev
   ```

## 📦 Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run postinstall` - Generate Prisma client

## 🔒 Environment Variables

Required environment variables can be found in `.env.example`. Make sure to set these up before running the application.

### Convex migration mode

`NEXT_PUBLIC_BBPC_BACKEND` defaults to `sql`. The existing NextAuth, Prisma, and tRPC
path remains active while compatibility adapters are migrated and verified. Setting the
value to `convex` activates Clerk middleware plus the Clerk-authenticated Convex React
provider. Convex mode fails immediately unless both Clerk keys and
`NEXT_PUBLIC_CONVEX_URL` are configured; it never silently falls back to SQL.

The first compatibility slices route the public `episode.next`, `episode.search`,
`episode.history`, and legacy-ID lookup tRPC procedures to Convex. The server-rendered
`/next` and `/episodes` pages and the sitemap use the same adapter in Convex mode. Every
result is runtime-validated against a storage-neutral presentation contract. History
pagination fails closed at 1,000 episodes or if a cursor does not advance; search is
capped at 20 results. The SQL implementations remain the default until the complete
consumer acceptance gate is signed off.

Episode detail routes resolve both canonical slugs and transitional SQL UUIDs through
Convex mode. Their results section consumes a separate 50-row-bounded public winner
contract that omits emails, notes, losing wagers, and incorrect guesses. SQL mode maps
its existing read into that same result shape through a runtime-validated adapter.

The shared `@tonyisup/bbpc-convex-api` package is not yet published. Until it is
available to CI and Vercel, this app keeps its narrow function reference and runtime
schema locally so a sibling checkout is not a deployment dependency.

## 📱 Features

- Full-stack TypeScript integration
- End-to-end type safety with tRPC
- Secure authentication with NextAuth.js
- Database management with Prisma
- Responsive design with Tailwind CSS
- Modern UI components and animations
- File upload capabilities
- Form validation and security measures

## 📝 License

MIT License

Copyright (c) 2024 BBPC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
