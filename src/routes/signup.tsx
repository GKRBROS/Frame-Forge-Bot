import { createFileRoute, redirect } from "@tanstack/react-router";

// Public sign-up is disabled — only the designated admin can sign in.
export const Route = createFileRoute("/signup")({
  beforeLoad: () => { throw redirect({ to: "/" }); },
  component: () => null,
});
