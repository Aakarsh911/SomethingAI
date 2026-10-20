import { SignIn } from "@clerk/nextjs";
import { AuthChrome } from "@/components/auth-chrome";

export default function SignInPage() {
  return (
    <AuthChrome>
      <SignIn />
    </AuthChrome>
  );
}
