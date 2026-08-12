'use client'

import NavMenu from "@/components/NavMenu";

export default async function LayoutMain({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavMenu />
      {children}
    </>
  );
}


