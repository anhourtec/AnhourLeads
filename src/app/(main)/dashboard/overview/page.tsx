import { permanentRedirect } from "next/navigation";

/** The overview became Home (layouts: getting started, generate pipeline, win & close). */
export default function OverviewPage() {
  permanentRedirect("/dashboard/home");
}
