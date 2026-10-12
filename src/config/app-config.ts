import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "AnhourLeads",
  version: packageJson.version,
  copyright: `© ${currentYear} AnhourLeads`,
  meta: {
    title: "AnhourLeads",
    description: "Open-source, self-hosted B2B prospecting and outreach.",
  },
};
