import { permanentRedirect } from "next/navigation";

/** The account page moved into settings. */
export default function AccountPage() {
  permanentRedirect("/dashboard/settings/profile");
}
