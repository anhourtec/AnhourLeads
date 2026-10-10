# AnhourLeads

AnhourLeads is an open-source, self-hosted alternative to Apollo.io. Find and enrich B2B contacts, verify emails, build targeted lists, and run multi-step outreach sequences from your own inboxes, with AI-assisted research, personalization and reply handling. Your data lives on your infrastructure, with compliance built in and no per-seat fees.

> **Status: early development.** This README describes what we are setting out to build. Most of it does not exist yet. See the [roadmap](#roadmap) for what comes first.

---

## Why AnhourLeads

Outbound sales comes down to two things: knowing who to talk to, and reaching them well. Many teams rent both from closed platforms. Their prospect lists, enrichment spend, email history and reply data sit on a vendor's servers, often priced per seat and metered by credits. It is rarely clear where a job title or email address came from, or how old it is. Deliverability and compliance happen out of sight, until a domain gets burned or an unsubscribe gets missed.

AnhourLeads gives teams the same core workflow as software they own and run themselves:

```
Find  →  Enrich  →  Verify  →  Engage  →  Respond  →  Learn
```

## How it's different

| | Typical closed platform | AnhourLeads |
|---|---|---|
| Where your data lives | The vendor's servers | Infrastructure you control |
| Pricing | Per seat, often with credit limits | No seat fees. You pay only the data providers you choose to use |
| Contact data | Large pre-built database | Your own imports plus the sources you connect. No pre-loaded database |
| Data provenance | Usually hidden | Every field shows its source and when it was last checked |
| Exports | Often metered or restricted | Export anything, any time |
| Customization | Limited to the vendor's roadmap | Open source. Extend it, automate it, integrate it |

## What we want to achieve

Our goal is to make high-quality B2B prospecting and outreach something any team can own and run, without giving up control of its data, its costs or its sender reputation. Concretely, that means the capabilities below.

### 1. Find the right companies and people

- Discover companies that match your ideal customer profile from the sources you connect.
- Search companies by industry, headcount, location, growth, the technologies they use, hiring activity and keywords.
- Search people by job title, seniority, department, location and the attributes of the company they work at.
- Save searches and get notified when new companies or people match them.
- Build static lists you curate by hand and dynamic lists that update as your data changes.
- Tag, annotate and add custom fields to any company or contact.
- See every contact, conversation and open task at an account in one place.
- Import from CSV or a plain list of company domains, and export anything at any time with no export credits.

### 2. Enrich records with transparent, verifiable data

- Start from whatever you have (a domain, a company name, or a person's name and company) and fill in the rest.
- Waterfall enrichment: query the data providers you have configured in the order you choose, cheapest or most accurate first, and stop as soon as the answer is found.
- Research the public web, including company websites, team pages, press releases and job postings, while respecting robots.txt and each site's terms.
- Provenance on every field: where it came from, when it was retrieved, and how confident we are in it.
- Scheduled re-verification, so job changes and stale data are caught before you send.
- Never pay twice for the same lookup. Results are cached and reused across your workspace.
- Automatic de-duplication and merging of companies and contacts.
- Clear costs: see what enrichment costs per contact, per list and per provider.

### 3. Find and verify email addresses

- Detect each company's email format and generate likely addresses.
- Check whether an address can receive mail without sending a message, and label it valid, invalid, catch-all or unknown.
- Flag role-based addresses (such as info@ or sales@) and disposable domains.
- Feed real bounces back so every contact's status stays accurate on its own.
- Block sending to addresses that failed verification unless someone deliberately overrides it.

### 4. Engage with multi-step sequences

- Build sequences that mix automated emails, manual emails, call tasks and other to-dos, with wait steps in between.
- Branch on what happens next: replied, clicked, bounced or no response.
- Send from your own connected Google Workspace and Microsoft 365 mailboxes, so replies land where your team already works.
- Keep follow-ups threaded under the original message.
- Send within working hours in each recipient's time zone, paced naturally rather than in bursts.
- Spread volume across several mailboxes and sending domains, with a daily limit for each mailbox.
- Stop automatically when someone replies, bounces or unsubscribes. Pause on out-of-office replies and resume after the return date.
- Templates, snippets, personalization fields and A/B tests for subject lines and copy.

### 5. Protect deliverability

- Domain health checks for SPF, DKIM, DMARC and custom tracking domains, with plain-language instructions to fix problems.
- Gradual ramp-up schedules for new mailboxes and domains.
- Monitor bounce rates and spam complaints, and automatically pause a mailbox or sequence when they cross safe thresholds.
- Open and click tracking is optional and can be turned off per sequence.
- Guardrails that favor fewer, better emails over raw volume.

### 6. Research and personalize with AI, with a human in the loop

- One-page account briefs covering what a company does, recent news, hiring trends and likely priorities.
- Personalized opening lines and full drafts grounded in researched facts, with links to the sources so reps can check them.
- No invented personalization. If the facts aren't there, the draft says so instead of making something up.
- Review modes: approve every message, approve only the first step, or let trusted sequences run within limits you set.
- Reply classification (interested, not now, referral, wrong person, out of office, unsubscribe) with suggested next steps and draft responses.
- AI is optional and provider-agnostic. Choose your own provider, or run AnhourLeads without AI at all.

### 7. Manage replies, tasks and pipeline

- A unified inbox for sequence replies across every connected mailbox.
- A daily task queue for each rep: calls to make, manual emails to send, follow-ups due.
- A lightweight CRM with accounts, contacts, deals and a full activity timeline on every record.
- Two-way sync with popular CRMs for teams that already have one.
- Book meetings directly from replies.

### 8. Measure what works

- Sequence performance per step and per variant: delivered, bounced, replied, positive replies and meetings booked.
- Deliverability health per mailbox and per domain over time.
- Data quality: verification rates, enrichment coverage and cost per verified contact.
- Activity reporting for reps and teams.

### 9. Work as a team and build on top

- Multiple users with roles and permissions.
- Separate workspaces for different brands or clients, so agencies and in-house teams are both covered.
- An audit log of who imported, exported, changed or sent what.
- A public API and webhooks for everything you can do in the interface.
- Single sign-on for organizations that need it.

### 10. Compliance and privacy by design

- A global do-not-contact list, honored across every list, sequence and workspace.
- One-click unsubscribe and sender identification (business name and postal address) in every message by default.
- Record where each contact came from and the basis for contacting them, such as implied consent under CASL or legitimate interest under GDPR.
- Region-aware rules for CASL (Canada), CAN-SPAM (United States) and GDPR/PECR (EU and UK).
- Handle access and deletion requests: find, export or erase everything held about a person, and keep a minimal suppression record so they aren't re-imported later.
- Configurable retention that automatically deletes records that haven't been verified or engaged within a set period.

## Design principles

- **You own your data.** Everything is exportable and nothing is locked in.
- **Self-hosted first.** AnhourLeads runs on infrastructure you control. Prospect data leaves it only when you send it to a provider you configured.
- **Transparent by default.** Every data point shows its source and its age.
- **Safe defaults.** Unsubscribe links, suppression lists and sending limits are on from day one. Turning a protection off is a deliberate choice.
- **Deliverability over volume.** The product steers you toward fewer, more relevant emails.
- **AI that assists.** Grounded in real facts, reviewable before it sends, and optional.
- **Pay for what you use.** No seat fees. Bring your own data providers and keys.
- **Modular.** Use the whole platform or just the parts you need, such as enrichment and verification on their own.

## Who it's for

- Founders and small teams doing their own outbound.
- Sales and SDR teams that want control over cost, data and deliverability.
- Agencies running outbound for several clients.
- Organizations whose data-residency or security requirements rule out third-party sales platforms.
- Developers who want a programmable prospecting and outreach engine.

## What AnhourLeads is not

- **Not a data broker.** It doesn't ship with a pre-built database of people, and it won't build one by pooling users' data.
- **Not a bulk-email blaster.** We won't build features meant to deceive recipients, disguise the sender or get around spam filters.
- **Not a scraper for walled gardens.** No features that collect data from behind logins or in breach of a site's terms.
- **Not an enterprise CRM.** Pipeline features stay deliberately light. Deep CRM work belongs in a CRM, and AnhourLeads syncs with them.

## Roadmap

### Phase 1: Foundation

- Import companies and contacts from CSV or a list of domains
- Enrichment through configured providers, plus email verification
- Search, filters and saved lists
- Connected mailboxes and simple email sequences with sending windows and daily limits
- Reply detection with automatic pause, plus AI reply classification
- Unsubscribe handling and a global do-not-contact list

### Phase 2: Intelligence and deliverability

- Waterfall enrichment, provenance and scheduled re-verification
- AI account briefs and grounded personalization
- Branching, A/B tests and multi-mailbox sending
- Deliverability dashboard and domain health checks
- Sequence and data-quality analytics

### Phase 3: Teams and ecosystem

- Roles, permissions and multiple workspaces
- CRM sync, public API and webhooks
- Meeting booking and single sign-on
- Buying signals (hiring, funding, leadership and technology changes) and lookalike company search

### Exploring

- Phone enrichment and calling, with do-not-call compliance
- A browser extension for saving companies and contacts from sites that allow it
- Intent signals

## Getting started

Installation instructions will be published with the first release. Star or watch this repository to follow progress.

## Contributing

AnhourLeads is being built in the open, and ideas, feedback, bug reports and code are all welcome. Please open an issue to discuss a feature or larger change before starting work on it.

## License

To be announced before the first release.

## Disclaimer

AnhourLeads is an independent project. It is not affiliated with, endorsed by or sponsored by Apollo.io. All trademarks belong to their respective owners.

AnhourLeads is a tool. You are responsible for making sure your outreach follows the laws and platform terms that apply to you. Nothing in this project is legal advice.

---

An Anhourtec project.
