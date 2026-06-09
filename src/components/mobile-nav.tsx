"use client";

import { createContext, useContext, useState } from "react";

type MobileNavCtx = { open: boolean; setOpen: (v: boolean) => void };

const Ctx = createContext<MobileNavCtx>({ open: false, setOpen: () => {} });

export function MobileNavProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

export function useMobileNav() {
  return useContext(Ctx);
}
