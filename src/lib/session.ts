import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireApiSession() {
  const session = await getSession();
  return session ?? Response.json({ error: "Unauthorized" }, { status: 401 });
}
