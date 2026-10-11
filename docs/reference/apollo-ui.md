# Apollo UI reference (for AnhourLeads parity)

A page-by-page record of Apollo's web app (app.apollo.io), observed in a signed-in Free-plan account on 2026-10-11, used as the functional and layout reference for AnhourLeads. It lists **what each screen does and how it is laid out**, in our own words, with the AnhourLeads equivalent and the gap. We match functionality, information hierarchy and filter sets; we do **not** copy Apollo's logo, icons, illustrations, colours or copy. AnhourLeads screens always follow [BRANDING.md](../../BRANDING.md). AnhourLeads is not affiliated with Apollo.io.

Screenshots of the observed screens are in `.playwright-mcp/apollo/` (gitignored, local only).

Status legend: **Have**: AnhourLeads already does this. **Partial**: exists but missing parts. **Gap**: not built.

---

## 0. App shell

Observed:

- **Left sidebar** (collapsible, "Close sidebar" chevron at the top), grouped and collapsible sections:
  - Home (with a phone / dialer shortcut icon beside it)
  - **Prospect and enrich**: People, Companies, Lists, Data enrichment
  - **Engage**: Calls (Sequences, Emails, Tasks appear on paid plans)
  - **Win deals**: Meetings, Conversations
  - **Tools and automation**: Analytics (Workflows on paid plans)
  - **Inbound**: (forms, website visitors, routers)
  - **Saved records**: People, Companies
  - Footer: Onboarding hub card with % complete and a dismiss "x", "Email setup and health", "Admin Settings" (opens a menu: Team & Workspace setup with % completed, System activity, Security, Plan overview, Integrations, All settings)
- **Top bar**: a centred global search "Search or ask a question" with a ⌘K hint (search + AI assistant in one box), a **credits** counter button, an "Activity & notifications" bell, the user avatar (initials).
- Floating help "?" button bottom-right.
- Typography: large display headings, neutral off-white surfaces, one accent colour for primary actions.

AnhourLeads: shell with grouped sidebar and header exists (**Partial**). Gaps: collapsible groups, onboarding progress card, setup-progress menu, ⌘K command palette that searches records (ours is the template's search dialog), notifications bell, usage counter.

## 1. Onboarding (first sign-in)

### 1a. "How do you want to start using Apollo today?" (Question 2 of 2)

- Full-page step with a back arrow and "Question N of M".
- Title + one-line helper ("Pick as many as you want. You'll still have access to everything; this just helps guide your experience").
- **Four multi-select cards** in a row (stack on narrow screens), each with a small coloured icon tile, an uppercase category label, a bold one-line outcome and a short description, and a full-width toggle button at the bottom ("Select" → "✓ Selected", tinted when selected):
  - **Outbound**: find and connect with new leads; reach the right leads, scale outreach, track results.
  - **Inbound**: turn website visitors into leads; capture visitor details.
  - **Enrichment**: keep the CRM clean and accurate; update records automatically with verified data.
  - **Deal execution**: manage deals and conversations; deal visibility with context and coaching.
- Primary "Continue" button bottom-left. Decorative illustration bottom-right.
- Question 1 of 2 (not captured) is presumably about the person's role / team.

### 1b. "Connect your email to get started"

- Title + helper ("instant access to automated outreach tools, deliverability support, meeting scheduling, and more").
- "Choose your email provider:" three provider cards: **Google** (Gmail / Google Workspace), **Outlook** (Hotmail, Live, MSN / Microsoft 365), **Other** (any provider, IMAP; locked on the Free plan with a padlock).
- **Consent checkbox** (required before connecting): the user agrees to comply with the terms when sending, not to send spam or unsolicited / harassing email, and acknowledges how business contact data from the mailbox may be used (with a "learn more about data sharing" link).
- Buttons: primary **Connect email** (disabled until a provider is chosen and the box ticked) and secondary **Skip for now**.

AnhourLeads: **Gap.** We have sign-up → workspace → dashboard with no onboarding. To build:

- Onboarding flow after sign-up / first sign-in: step 1 role and team size, step 2 goals (Outbound, Inbound, Enrichment, Deal execution, multi-select) stored on the user / workspace and used to order the overview's "getting started" checklist.
- Step 3 connect a mailbox: Google (OAuth), Microsoft (OAuth), **Other (SMTP/IMAP; never locked in AnhourLeads)**, with the anti-spam acknowledgement checkbox (stored with timestamp as consent evidence) and Skip for now.
- An onboarding hub: checklist with % complete (connect mailbox, import contacts, verify a domain, create a sequence, invite teammates), dismissible card in the sidebar footer.

## 2. Plans and credits (`#/settings/plans/upgrade`)

Observed: three-step checkout (Select plan → Add-ons → Review), seat stepper, annual/monthly toggle, four plan cards (Free / Basic / Professional / Organization) with feature lists, a summary panel, and a "What are credits?" explainer: email 1 credit, phone number 8 credits, enrichment 1–8 credits, AI research 1 credit per run, dialer 1 credit per 30 s.

AnhourLeads: **not applicable**. No seats, no credits (README: no seat fees, pay only the data providers you configure). Equivalent we do want: a **usage page** showing per-provider lookups and costs (enrichment, verification, crawler runs) per workspace and per user, with optional monthly caps. **Gap.**

---

## Typography and shell metrics (observed)

| Use | Apollo | AnhourLeads (open-licence equivalent) |
| --- | --- | --- |
| Body, nav, tables, forms | Inter (variable) | **Inter** (OFL, identical) |
| Page and section headings, large display numbers | Founders Grotesk (commercial) | **Hanken Grotesk** (OFL, closest free grotesk) |
| Small caps labels, column headers, counts, ids | Founders Grotesk Mono (commercial) | **Roboto Mono** (Apache 2.0; Apollo also loads it) |

- Page title ("Find people", "Sequences"): heading font, ~22–28 px, weight 400, no bold.
- Table column headers: mono, uppercase, ~11 px, muted, letter-spaced.
- Sidebar items: Inter ~14 px, group headers with an icon and a chevron; active item on a light grey pill.
- Top bar height ~48 px; sidebar width ~240 px; content padding ~12–16 px; cards with 1 px borders and ~8 px radius; neutral off-white page background with white cards.
- Primary buttons are filled with the brand accent (Apollo: lime); secondary are white with a border; destructive confirmations in modals.

## 3. Home (`#/home`)

Layout switcher (top right, "Getting started ▾"): tabs **System / Your layouts / Starred**, layouts **Getting started**, **Generate Pipeline**, **Win & Close**, plus **Create new** (custom layout) and **Edit layout** (widget editor). Greeting "Welcome, <first name>" on dashboard layouts.

- **Getting started:** title, line "complete these tasks in your first 14 days…", progress bar, and collapsible checklist cards each with "N of M completed" and a reward chip:
  1. Start reaching the right prospects: save a contact, save a mobile number, create a list, save target companies, save your search and get alerts, install the browser extension.
  2. Get your inbox ready to send: connect your email, warm up your inbox, review your company profile (for writing recommendations).
  3. Scale your outreach: build a sequence with AI, add leads to the sequence, launch the sequence.
  4. Turn activity into meetings: set up a booking page, set up call recording.
  Each row: checkbox, bold action + description, and a right-aligned action button (primary on the first incomplete one).
  Footer "More resources": academy, webinars, help docs cards.
- **Generate Pipeline:** "Suggested leads" widget with People / Companies toggle; empty state asks to create a scoring model ("Create people score").
- **Win & Close:** widgets: **Your email stats** (this month: sent, delivered, opened, replied, interested, bounced %, each with "from <date>"), **Recent replies** (counts by category: willing to meet, follow-up question, referred to other person, out of office, not the right person, not interested, unsubscribed, uncategorized), **Latest recordings** (my calls / company), **Your tasks** (all, call, email, LinkedIn, overdue counts + table view), **Deals for follow-up**, **Mailbox** status.

AnhourLeads: overview with KPIs (**Partial**). Gaps: layout switcher + custom widget layouts, getting-started checklist (no credits; just progress), suggested leads (needs scoring), reply categories widget, email stats this month.

## 4. Find people (`#/people`)

**Header:** title "Find people", **Import ▾** (CSV etc.) top right.

**Toolbar:** "Default view ▾" (saved searches: tabs All searches / Your searches / Starred / Assigned to you / Shared; "Create saved search"), "Hide filters" (shows active filter count), search box "Search people", **Research with AI ▾**, **Create workflow ▾**, **Save as new search**, **Sort ▾** (sort-by field + ascending/descending + Apply; default Relevance), **Search settings** (gear).

**Left filter rail (~290 px):** segmented counts **Total / Net New / Saved** (e.g. 248.3M / 248.3M / 0). Accordion filters (pinned set): Job Titles, People Lookalikes (locked), Company, Location, Industry & Keywords. Footer: "Clear all" + "View 60+ Filters".

- **Job Titles** filter: Simple / Advanced toggle; Include (typeahead, "use quotation marks for exact matches"), checkbox "Include people with similar titles", Exclude, "Past job titles ▾"; nested **Management Level** checkboxes with live counts (Owner, Founder, C suite, Partner, VP, Head, Director, Manager, Senior, Entry, Intern); **Departments & Job Function** (search + checkbox list: C-Suite, Product, Engineering & Technical, Design, Education, Finance, Human Resources, Information Technology, Legal, Marketing, Medical & Health, Operations, Sales, Consulting; each expandable "+" into sub-functions); "Create new persona" / "What's a persona?".
- **All filters modal** ("Filters", search filters, "Type: All ▾", live "N records found", Apply Filters). Four columns:
  - *Pinned filters* (drag to reorder, pin/unpin).
  - *Person info:* Persona, Email Status, Name, Education, Awards & Certifications (beta), Work URLs, Time Zone, Total Years of Experience, Job Change, Time in Current Role, Territories, Person Deleted.
  - *Company info:* Company Lookalikes, # Employees, Market Segments, SIC and NAICS, Buying Intent, Technologies, # Employees by Dept., Headcount Growth, Revenue, Funding, Founded Year, Languages, Job Postings, News, Website Visitors.
  - *Engagement activity:* Sequence, Workflows, Email Opened, Last Activity, Email Sent, Email Clicked, Email Replied, Email Meeting Set, Email Bounced, Email Unsubscribed, Email Spamblocked, Email Auto Responder, Call Restrictions, Conversation, Conversation Recording, Conversation Tracker Keywords.
  - *Created source:* Source, Contact CSV Import, Contact Data Request, Contact Created Date.
  - *Misc.:* Phone Status/Confidence, Parent Companies, Lists, Qualification Status, AI Filters, Scores, Owner, Stage, Custom Fields, Signals.
- **Empty state (no filters):** "Use AI to find the right prospects" natural-language prompt box with an example, and a **Quick filters** card (Locations chips, Job Titles chips, Email Status chips Verified/Unverified/Unavailable, Industry chips) and an "unlock advanced filters" strip.

**Results table:** columns NAME (sticky, underlined link), JOB TITLE, COMPANY (logo + name), EMAILS ("Access email" button), PHONE NUMBERS, QUALIFY CONTACT, COMPANY · QUALIFY ACCOUNT, ACTIONS, LINKS, SCORE, LOCATION, COMPANY · NUMBER OF EMPLOYEES, COMPANY · INDUSTRIES, COMPANY · KEYWORDS, **+ Add column**. Mono uppercase headers. Row actions: copy, access email, access mobile, add to list, manage sequences, more. Pager: ‹ page select › and "1 - 30 of 2.386M".
- **Select-all popover:** "Select number of people [25]" + "Max people per company [1]", "Select this page (30)", "Select all (n)", Cancel / Apply.
- **Bulk action bar** (replaces toolbar when rows are selected): "Clear N selected", **Save**, email, add to sequence ▾, workflow ▾, add to list, export (download), research with AI ▾, push to CRM ▾, more (View companies…).

**Person page** (`#/people/:id`): breadcrumb People › Name; header avatar initials, name, LinkedIn icon, "title at Company" (company link), location; actions **Add to list**, **Access email**. Left card **Contact information** (masked email + Access email, mobile + Access mobile, business phone, Scores with "Create score", a "Do Not Call not enabled" notice). Right: **Company insights** tabs (Overview, News, Technologies n, Funding, Job postings, Employee trends n, Website visitors) with relevant jobs / technology / funding; company card (About, keywords, founded year, revenue, industries, employees, SIC, NAICS, stage, location, labels/lists, phone + "Add phone"); **Similar people** table (beta) with pager.

**Company drawer** (from a company link): breadcrumb Companies › Name, logo, name, LinkedIn, industry · location; Add to list, Save company, expand, close. Left **Company details** (description with show more, industries, keywords with "show all n", founding year, employees, SIC, NAICS, links). Right tabs **Overview / People / Locations**; **Company insights** (Overview, News, Technologies, Funding, More ▾) with score; **Suggested leads** (All / CXO / Director+ tabs, filters, search, table NAME / REASON).

AnhourLeads: People list with filters, detail, import/export (**Partial**). Gaps: Total / Net New / Saved split, accordion filter rail with pinning and facet counts, all-filters modal, quick filters + natural-language search box, saved searches with tabs, column chooser, select-N popover, bulk bar actions (sequence, list, export, CRM), company drawer, insights tabs, similar people, personas, scores.

## 5. Find companies (`#/companies`)

Same shell as people: toolbar (Default view, Hide filters, Search companies, Research with AI, Create workflow, Save as new search, Sort, Search settings), Total / Net New / Saved counts (26.9M).

- Pinned filters: Lists, Company, Lookalikes, Account Location, Qualification Status, # Employees, Industry & Keywords, Market Segments, SIC and NAICS, AI Filters, Buying Intent, Website Visitors, Technologies, Revenue, Funding, Job Postings, Scores, Signals, Owner, Stage, Account Custom Fields. Company info: # Employees by Dept., Headcount Growth, Job Titles, Founded Year, Languages, News, Work URLs. Engagement: Last Activity, Sequence, Workflows. Created source: Source, Account CSV Import, Account Created Date. Misc.: Parent Companies, Territories. "View 30+ Filters".
- **# Employees**: predefined ranges with counts (1-10, 11-20, 21-50, 51-100, 101-200, 201-500, 501-1000, 1001-2000, 2001-5000, 5001-10000, 10001+), custom range, "# of employees is unknown".
- Quick filters: Locations, Employee count chips, Industry chips.
- Table columns: NAME, ACTIONS, LINKS, NUMBER OF EMPLOYEES, QUALIFY ACCOUNT, INDUSTRIES, KEYWORDS, LOCATION, + Add column.

## 6. Lists (`#/lists`, grouped by type, sorted by last updated)

- Empty state: illustration, "Welcome to your lists", buttons **Create a people list** / **Create a company list**, "Learn more about lists".
- **New List drawer** (right side): list name, list target (People / Companies), "Add records from": **Filters** ("Select filters", builds a dynamic list) or **CSV** ("Upload CSV"); Cancel / Create.
- **List page:** breadcrumb Lists › name, name + type badge ("People"), "N records", toolbar (Default view, Show filters, Search, Research with AI, Create workflow…), empty state with three action cards: **Find people** (search prospects to add), **Import by CSV**, **Create workflow** (auto-add saved people).
- Creating a list shows a success toast and an onboarding progress toast.

## 7. Sequences (`#/sequences`)

- Header "Sequences" + primary **Create sequence**. Tabs: **All Sequences / Analytics / Diagnostics**.
- Info banner (dismissible): automatic pause of sequences with unusually high bounce rates ("bounce guard"), configurable in Email setup and health › Sending policies. Warning bar when no mailbox is linked, with "Link mailbox".
- Empty state hero: "Create your first sequence", **Create with AI**, **Create manually ▾** (more options); three explainer cards (built step by step / sends on your schedule / pauses when they reply); link to a guide.
- **Anti-spam agreement modal** on first create ("I will comply" / "I decline").
- **New Sequence modal:** name, description, **Schedule** select (e.g. "Normal Business Hours" Mon–Fri 8 AM–5 PM shown alongside), link to edit/create schedules; Back / Create.
- **Sequence page:** breadcrumb, name + star, actions **Optimize** (AI), **Share**, **Workflows n ▾**, **Add Contacts ▾**, **Activate** toggle, "⋯". Tabs **Editor / Contacts / Activity / Health / Report / Settings**.
  - Editor empty state: "Your sequence is empty", **Add a step**, or **Select a template** / **AI-assisted sequence**.
  - **Step types:** Automatic email, Manual email, Phone call, Action item, LinkedIn – send connection request, LinkedIn – send message, LinkedIn – view profile, LinkedIn – interact with post.
  - **Step card:** connector pill "Send email in 30 minutes ✎" (wait editor), header toggle (step on/off), "Step 1: Automatic email / Test A", timing, "⋯", collapse. A/B tests: "Test A · Active", "+ Add test"; "Send me a test mail" / "Check email", preview (eye), settings (gear). Modes **Assisted / Prompt / Template**:
    - Assisted: email type (Outreach / Follow-up / Last pitch), personalize with AI research chips (recent company news, relevant job postings, executive persona research, strategic company research, messaging angle, + add), tone (Default, Direct, Formal, Casual, Creative, Custom), AI context.
    - Template: Subject, Type (**New thread / reply in thread**), body editor, "Write with AI", "Personalize with AI" (Opener, P.S. line).
    - Right pane: "Generate preview for contact" (choose contact, filter, refresh, desktop/mobile toggle).
  - Toolbar: "N steps »" (outline), Collapse steps, **Save changes**; leaving with unsaved changes asks "Are you sure?".
  - **Settings tab:** Sequence settings (name, description, tags, owner); Scheduling (schedule select with week preview, Edit schedule, Create new schedule); **Ruleset**:
    - Triggers: when another reply arrives within the same account → do nothing / …; create a phone call task if an active contact opens an email at least N times.
    - Contact triggers: mark finished when the contact clicks a link (needs click tracking); mark unresponsive if no reply or meeting N days after the last step.
    - Email triggers: mark emails "Not sent" when the contact stage is any of [Bad data, Do not contact, …] or the account stage is any of [Current client, Active opportunity, …].
    - Default triggers (locked "for your protection"): finish on reply; pause on out-of-office; finish when a meeting is booked; finish on unsubscribe; fail on bounce or spam rejection.
    - Other settings: max emails per 24 h rolling period, CC all, BCC all, ignore bounce protection (with a warning).

AnhourLeads: sequences with steps, enrollment, review modes, sending engine (**Partial**). Gaps: tabs (Activity, Health, Report), A/B tests per step, step on/off, LinkedIn manual steps, Assisted/Prompt AI modes, preview for a contact, reply-in-thread, schedules as reusable objects, ruleset triggers (open-count call task, click → finish, unresponsive after N days, stage-based not-sent, account-level reply handling), CC/BCC, per-sequence 24 h cap, star/share/tags/owner, templates, consent modal.

## 8. Emails (`#/emails`)

- Header "Emails", actions **Manage mailboxes**, **Deliverability stats**. Tabs **All emails / Templates / Analytics**.
- Warning bar when no mailbox is linked. Toolbar: mailbox filter "All inboxes ▾", status chips (scheduled, delivered, replied, bounced…), Show filters, **Save as new view**, View options; saved views menu (All views / Your views / Starred / Shared / Create new view).
- Empty state: "No emails yet" + advice to check domain health ("View domains").

## 9. Tasks (`#/tasks`)

- Header "Tasks" with **Start call session** (dialer) and primary **Create task**.
- Tabs with counts: **All tasks n · Call tasks n · Email tasks n · LinkedIn tasks n · Overdue tasks n**, then a saved-view selector ("All your tasks"), **Views ▾**, Show filters (n), Sort (n), View options.
- Empty state: "You have no assigned tasks", **View all team tasks**, **New task**.
- **New task modal:** Associated with* (contact/account search), Type (Call, Manual email, Action item, LinkedIn: send connection request, send message, view profile, interact with post), Title*, Description (+ **Add snippet**), Due date, Due time (30-min slots), Priority (low/medium/high), Assignee; Cancel / Create task.

## 10. Calls (`#/phone-calls`)

Dialer is a paid feature: page explains calling from the app (book more meetings) with an upgrade prompt. AnhourLeads: log calls manually (call task completion with outcome + notes); a real dialer is out of scope for now (needs a telephony provider). **Gap (later).**

## 11. Deals (`#/deals`)

- First visit modal "Deal management made easy" (use as CRM or sync with HubSpot/Salesforce) → **Begin setup** / Maybe later.
- Setup: "How would you like to start?" **Import from CRM** or **Use as your CRM**; then "Add your pipeline details": pipeline name, stages table (stage name + type): Lead, Sales Qualified, Meeting Booked, Negotiation, Contract Sent (Open), Closed Won (Closed/Won, fixed), Closed Lost (Closed/Lost, fixed). Only admins can edit pipelines afterwards. Success modal "You're all set up!" → Create deal.
- Page: "Deals", **Import CSV**, **Create deal**; tabs **Overview / Analytics (new)**; toolbar: **All pipelines ▾**, view (All deals), Show filters, Save as new view, sort "Created date ▾", View options; kanban (`viewMode=kanban`) or table.
- **Create deal modal:** "Customize deal form" link; Deal name, Company (+ create account), Pipeline, Stage, Estimated close date, Owner, Amount ($), "Show custom fields (n)"; Save / Save and create another / Cancel.

## 12. Workflows (`#/workflows`)

- Header with **Outbound Copilot** (AI) and **Create workflow**. Tabs **Workflows / Templates**. Template cards (linear / multi-branch, tags "Generate pipeline", "AI") such as: convert ideal customers with AI sequences; target website visitors; engage companies researching your category; target new hires in their first 90 days; engage fast-growing companies; target competitor customers; companies reducing expenses. Each "Preview template".
- **Builder** (`#/workflows/new`): breadcrumb, editable name "New workflow – <date>", status pill **Draft**, primary **Launch workflow ▾**, tabs **Workflow / Settings / Enrollment**. First screen: "What can I help automate?" AI prompt with example, three templates, "Explore all templates" or **Start from scratch**.
- Canvas: "When this happens" trigger card → blocks → Exit; bottom toolbar Outline / Detail, tips, undo/redo, zoom, fit. Right **Build** palette ("click or drag to add block"):
  - Rules: True/false branch, Multi-split branch, Traffic branch (percent split), Delay, Exit.
  - Agents: Research with AI, Qualify records.
  - Actions: Integrations, Manage sequences, Manage lists, Manage deals, Enrich data, Assign manual tasks, Update contact/account, Send notifications, Send webhook.
- **Trigger dialog:** run "based on a date or schedule" or "based on a trigger event"; target **People / Companies / Deals**; events: call logged, contact added to list, added to sequence, finished sequence, finished step N, contact saved or created, contact updated, conversation recorded / invitees didn't attend, email bounced / clicked / not sent / opened / replied / sent / unsubscribed, form abandoned / submitted, meeting booked / incomplete / cancelled / declined / rescheduled, website visited. **Enrollment criteria:** filters ("saved people matching these attributes…", live pre-qualified count).

## 13. Analytics (`#/analytics`)

Tabs **Overview / Dashboards / Reports / Goals**; **Create ▾** (dashboard, report, goal). Recent dashboards; system dashboards: Data enrichment & quality, Call engagement performance, Meetings metrics, Sales manager command center. Example widgets: emails sent by rep (scheduled, sent, calls logged), calls made by rep. Paid on Apollo; AnhourLeads ships it.

## 14. Data enrichment (`#/enrichment-status/...`)

Header **View scheduled jobs n**, **Automate enrichment**. Tabs: **Data health center**, **CRM**, **CSV**, **Job change alerts**, **Form enrichment**. Health center empty state: save contacts or connect CRM; benefits: discover enrichable data (job changes, missing emails, fields), detect and merge duplicates, track enrichment activities and usage. CSV enrichment: upload up to 100K rows, fill missing fields, preview table of enriched rows.

## 15. Inbound: Website visitors, Forms; Meetings; Conversations

- Website visitors: "Turn website visitors into pipeline", **Add website** (tracking script, identify companies browsing). AnhourLeads: **Gap (later)**, needs a tracking script and IP-to-company data.
- Forms: Form enrichment (enrich existing forms) and Form builder (drag and drop with branding). **Gap (later)**.
- Meetings: connect calendar, booking links, AI prep, link meetings to records. **Gap (later)**.
- Conversations: call/meeting recording and analysis. **Gap (later)**.

## 16. Saved contact page (`#/contacts/:id`)

Header: breadcrumb, initials avatar, name + LinkedIn, "title at Company", location; icon actions (more, call, **send email**, **create task**, meeting), **Add to list**, primary **Add to sequence**, **Edit layout ▾** (cards are draggable/configurable).
Left column cards (drag handles, collapsible, per-card settings): **Contact information** (email with Primary badge, "Business · Source: <source> · <status>", request phone, scores, local time, social links, Do-Not-Call notice), **Record details** (stage pill, lists, last activity date, AI qualify "click to run", "see all fields n"), **Account** (company, website, stage, owner), **Deals** (add deal), **Notes** (new; filter; add note), **Tasks** (add task).
Right column tabs **Prospect / Activities / Sequences / Conversations / All fields**; company insights (overview, news, technologies, funding, job postings, employee trends, website visitors), company card (about, new prospects, existing contacts, keywords, founded, revenue, industries, employees, SIC/NAICS, stage, location, engagement "0 inbound · 0 outbound" + graph, labels, phone, qualify account), similar people.
Revealing an email ("Access email") costs a credit, shows the address inline in the table with a verification icon, and turns the person into a saved contact.

## 17. Import (`Import ▾` → Single contact / CSV; `#/contacts/import`)

- Two cards: **Import contacts** and **Import accounts** (up to 100,000 rows; recommended identifying columns; data-use acknowledgement; **Select CSV file**; **Download sample template**), FAQ links.
- **Column mappings** page: "N rows included"; banner to create a custom field; "N columns detected · N recognized", "Hide recognised columns"; one card per CSV column (header + ✓, mapped-field select with clear, sample values), horizontal scroll.
- Settings tab: **Use stage from CSV** (or a fixed stage), **If contacts already exist** (update the existing record / skip it), **Auto-assign accounts?** (assign or create the account from website / email domain), **Add to a list?**. Data enrichment tab: choose fields to enrich during import. Footer: file chip with delete, Cancel, **Import**.

## 18. Command palette (⌘K) and top bar

- ⌘K opens a floating panel over the search bar: with no query, **AI suggestions** (build your target audience, build your TAM, craft an outbound sequence); with a query, grouped results: **People** (initials avatar, name · title @ company, stage pill), "View all people", **Companies** (name · employee count · industry, stage pill), **Settings** pages (name · section). Footer hints ↑↓ navigate, esc close, ↵ select.
- **AI Assistant** button (top bar) and page: left pane (Start new chat, Channels, Context center, Memory, Chats list); centre greeting, prompt box with context toggle and mic, presets (Prospecting: build TAM, target audience, recently changed contacts, score accounts; Research; Sequencing; Analytics; More).
- **Notifications bell** → panel with **Activities / Notifications** tabs.

## 19. Settings (`#/settings/overview`)

Settings replace the app sidebar with a settings sidebar: **Back**, "Search settings", Settings overview, collapsible groups. Overview is a two-column grid of cards, each with icon, title, one-line description and links:

- **Personal:** Profile, Conversations, Notification settings, Browser extension.
- **Plan & billing** (n/a for AnhourLeads; replaced by **Usage**).
- **Credits & activity:** credit usage, data requests, AI word usage → AnhourLeads **Usage & activity** (provider lookups, AI usage, data requests).
- **Users & teams:** Users (tabs current / suggested / user fields / pending; columns user, permission profile, credit limit; New user → invite with permission profile Admin / Non-admin; export CSV), Teams, Permission profiles, Territories, License settings, Workspace details, Team sharing & defaults, System activity log, Support access.
- **Integrations:** all integrations, MCP, API keys.
- **Outbound:** Overview, Domains, Mailboxes, Sending protection, Sequences, Tracking, Dialer, Prospecting configuration, Snippets.
- **Data management:** Contact fields & stages, Account fields & stages, Deal fields & stages, Global picklists, Goals, Imports & exports, Removal requests.
- **Ideal customer profile:** Personas, Buying intent, Website visitors, Signals, Scoring, AI context center.
- **Meetings & conversations:** recording configuration, team permissions, trackers, scorecards, custom field prompts, team meetings.

**Contact fields & stages** (`#/settings/contacts`): tabs Stages / Contact roles / Triggers / Fields. Default stages: Cold, Approaching, Replied, Interested*, Not interested*, Unresponsive, Do not contact*, Bad data, Changed job* (* = "do not override with event triggers if set manually"). **Triggers:** prospect created → Cold, email delivered → Approaching, email bounced → Bad data, spam blocked → (choose), unsubscribed → Do not contact, replied → Replied, appointment or marked interested → Interested, unresponsive N days after last step → Unresponsive; option "only mark Interested for meetings booked through our meeting links".

**Email setup and health** (`#/settings/deliverability-suite`): tabs Overview / Domains / Mailboxes / Sending protection; tip to invite a teammate who owns DNS; mailbox performance (emails sent successfully %, delivered, bounced; open rate, opened, clicked; reply rate, replies, positive replies; each vs last month); "Emails deliverability and activity" chart (last 7 days; deliverability / activity); top performing sequences table; recommendations (active / completed).

**Sending protection:** summary (risky sends held back, sequences auto-paused, contacts screened, view bounce logs) and policy groups with on/off and counts:
- Domain protection: automatic sending adjustments (pause on critical authentication issues).
- Who gets emailed: restrict unverified emails; restrict catch-all domains (on by default); require email signatures; one-click unsubscribe (always on).
- Sending safeguards: gradual sending increase (ramp-up for new domains/mailboxes); bounce guard (pause sequences/workflows over a bounce threshold, on by default); workspace sending limit.

---

## Build plan (AnhourLeads parity)

Everything above is implemented with our own components, BRANDING.md tokens (only the colours differ from the reference) and the fonts in the typography table, gated by roles (docs/roles.md) and tested in the API and UI harnesses. Features that need third-party infrastructure (telephony dialer, call recording, website-visitor identification, calendar booking, CRM sync, a hosted contact database) are scaffolded with honest empty states and recorded as gaps; they are not faked.

Data notes for a self-hosted product without a pre-built database: in search, **Total** = all records in the workspace, **Net new** = records not yet in any list, sequence or deal, **Saved** = records owned by you. "Access email" = find + verify the email with our own enrichment (no credits; usage is logged per workspace).

| Work package | Scope |
| --- | --- |
| WP-A Shell & onboarding | Fonts, sidebar groups and footer, top bar (⌘K record search, AI assistant button, notifications panel, avatar menu), settings shell + overview grid, onboarding flow (goals, connect mailbox, anti-spam consent), onboarding hub, Home layouts (getting started, generate pipeline, win & close), honest empty states for Calls, Meetings, Conversations, Website visitors, Forms |
| WP-B Search & records | People/Companies search parity (filter rail, counts, all-filters modal, chips, quick filters, natural-language search, saved searches, columns, select-N, bulk bar), list pages, company drawer, contact/account pages with cards and tabs, notes, activity timeline, custom fields, import wizard with mapping and settings |
| WP-C Engage | Sequences parity (tabs, step types incl. manual LinkedIn steps, A/B variants, step toggle, preview, thread mode, schedules, ruleset, CC/BCC, caps, templates, snippets, consent), Emails page (all emails, templates, analytics), Tasks parity (tab counts, views, create modal) |
| WP-D Deals, stages & workflows | Pipelines with typed stages + setup flow, kanban/table, deal form; contact/account stages and stage triggers; workflow engine (event/schedule triggers, enrollment filters, rules, actions) and builder |
| WP-E Data, deliverability, analytics, AI | Data health center, CSV enrichment jobs, duplicates; email setup & health (domain DNS checks, mailbox performance, sending protection policies enforced in the engine); analytics dashboards/reports; AI assistant (optional, provider-agnostic) and AI context center |
