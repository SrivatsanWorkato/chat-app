import type { Metadata } from "next";
import { AuthForm } from "@/app/_components/auth-form";

export const metadata: Metadata = {
  title: "Sign in · Chat UI",
  description: "Sign in to your Chat UI workspace.",
};

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
