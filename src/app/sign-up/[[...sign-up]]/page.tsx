import { SignUp } from "@clerk/nextjs";
import { AuthChrome } from "@/components/auth-chrome";

export default function SignUpPage() {
  return (
    <AuthChrome>
      <SignUp />
    </AuthChrome>
  );
}
