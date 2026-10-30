# Scheme Knowledge Base: Review and Publish (S1, MERN stack)

Haqdarshak Software Engineer case study, option **S1**.

**Repository:** https://github.com/Nageshwar1997/Haqdarshak-Assignment

This app keeps scheme records safe while they change. **State reviewers** prepare drafts and **Central reviewers** approve them. The agent app keeps seeing the last approved version until a new one is approved. Every field change is logged with its source. A change to a shared eligibility rule never silently changes a published scheme.

**Stack:** MongoDB (Mongoose), Express, React (Vite), Node.js, all in TypeScript.

---

## 1. How to run

### What you need

- **Node.js 22.12 or newer** with npm. Check with `node --version`.
- **No Docker and no MongoDB install needed.** If you do not give a database address, the server starts a temporary MongoDB in memory by itself (using [`mongodb-memory-server`](https://github.com/typegoose/mongodb-memory-server)).
- Internet on the **first** run only. `mongodb-memory-server` downloads a MongoDB binary once (about 100 MB) and caches it.

### Steps

```bash
git clone https://github.com/Nageshwar1997/Haqdarshak-Assignment.git

if not in correct dir
cd Haqdarshak-Assignment
npm install
```

`npm install` installs both the `server/` and `client/` packages.

**1. Check every rule (about a minute):**

```bash
npm run demo
```

This starts a fresh in-memory MongoDB, loads the synthetic data and runs every S1 rule through the real HTTP API. Each check prints `PASS` or `FAIL`. The script exits with code 1 if any check fails. The last line should say `0 failed`.

**2. Open the app:**

```bash
npm start
```

This builds the React app and starts the server. Then open **http://localhost:3000**.

- Data is **reset every time the server restarts**, because it lives in the in-memory MongoDB. The **Reset demo data** button in the app also brings it back to the starting state.
- To change the port: `PORT=4000 npm start`.

**Optional: use your own MongoDB (for example MongoDB Atlas) so data is kept:**

1. Copy `server/.env.example` to `server/.env`.
2. Put your connection string in `server/.env`:
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/
   ```
   `server/.env` is in `.gitignore`, so your password never goes to GitHub.
3. In Atlas, allow your IP address under **Network Access**.
4. Run `npm start`. The server uses the `scheme_kb` database. It loads the synthetic data only if that database is empty.

The database must be a replica set, because publishing uses transactions. Atlas always is. `npm run demo` always uses its own in-memory MongoDB, so it never touches your database. **Reset demo data** in the app *does* wipe and reload the `scheme_kb` database you are connected to.

**Development mode with hot reload (optional), in two terminals:**

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Then open http://localhost:5173. Vite forwards `/api` calls to the server on port 3000.

### A 3-minute tour of the app

Use the **Acting as** menu at the top to switch user. Each user has a role:

| User | Role |
|---|---|
| Asha | State reviewer (MH) |
| Ravi | State reviewer (KA) |
| Meera | Central reviewer |
| Vikram | Central reviewer |
| Neha | Both roles. Used to show that nobody can approve their own draft. |

1. **Agent view:** open *Girl Child Education Grant*. The amount is ₹25,000 and every value shows its source.
2. **Acting as Asha → Schemes → SYN-MH-002 → Start new draft.** Change `benefit_amount` to 30000 with a source, then **Submit for review**.
3. Go back to the **Agent view**. It still shows ₹25,000, because the draft is not approved yet.
4. **Acting as Meera → Review queue.** Open the scheme. You see the before-and-after with sources. Click **Approve and publish**. The Agent view now shows ₹30,000, and the **History** shows who changed what, when, the old and new values, and the source.
5. **Acting as Meera → Shared rules → INCOME_BELOW_2_5L → Change rule** (for example, the value to 300000). Three schemes get flagged for review. Their published versions still use the old rule until each one is reviewed again.
6. **Acting as Neha:** create a scheme, submit it, then try to approve it. The server refuses, because she drafted it.

---

## 2. Project layout

```
server/                 Express + MongoDB API (TypeScript, run with tsx)
  src/db.ts             Connects to MONGODB_URI, or starts an in-memory MongoDB
  src/models.ts         Mongoose collections, indexes and data-layer guards
  src/service.ts        All the rules: workflow, versions, change log, shared rules
  src/app.ts            Express routes; also serves the built React app
  src/seed.ts           Synthetic users, 5 shared rules and 4 published schemes
  src/demo.ts           Runs every S1 rule through the HTTP API (npm run demo)
  src/index.ts          Starts the server
client/                 React app (Vite + TypeScript)
  src/api.ts            One function per API endpoint
  src/types.ts          The shared data shapes
  src/components/       Agent view, schemes workspace, review queue, shared rules
package.json            Root scripts: install, demo, start, dev
```

---

## 3. How it works

### Versions and statuses

Every scheme has a list of versions. Each version has one status:

```
             submit                 publish (by a different person)
   draft  ----------->  in_review  ---------------------------------->  published
     ^                     |                                                |
     |  send back          |                       a newer version is      |
     +---(comment needed)--+                       published                v
                                                                         superseded
   draft --(discard)--> discarded
```

- A scheme has **at most one open version** (`draft` or `in_review`) and **at most one `published` version**. MongoDB enforces both with partial unique indexes.
- **The read API (`GET /api/schemes`) only ever returns the `published` version.**
- Editing a live scheme copies the published version into a new `draft` (v2, v3 and so on). The published version is not touched.
- Once published, a version's content is **locked**. Only its status can change later, to `superseded`. The old version is kept for history.

### How each S1 rule is met

| S1 rule | How |
|---|---|
| 1. Two roles. The creator cannot approve. | Only State reviewers can create, edit, submit or discard. Only Central reviewers can send back, publish or change shared rules. Publishing is refused if the approver created **or edited** that version. |
| 2. Draft → in review → published, or sent back with a comment | Status checks on every action. Sending back needs a comment, which is logged. Edits are blocked while a version is in review. |
| 3. Publishing locks the version. The read API keeps serving it. | A new draft is a copy. Publishing runs in one MongoDB transaction: the old version becomes `superseded` and the new one becomes `published`. Model hooks refuse any content change to a non-draft version. |
| 4. Every field change is recorded | `field_changes` stores who, when, old value, new value and source for every field and rule change. Model hooks make it append-only: updates and deletes are refused. |
| 5. Shared rules flag schemes and never change them silently | Rules have versions. Each scheme version is tied to the exact rule version it was approved with. Changing a rule adds a new rule version plus a review flag for every scheme that uses it. Publishing is blocked until the draft moves to the new rule version, or a Central reviewer dismisses the flag with a reason. |
| 6. Synthetic schemes and checks | 4 seeded schemes plus more created in the demo. `npm run demo` checks every rule through the API. |

### Data model (MongoDB collections)

| Collection | Holds | Guard |
|---|---|---|
| `users` | Synthetic reviewers and their roles | |
| `schemes` | One document per scheme (`scheme_ref`) | unique `scheme_ref` |
| `scheme_versions` | Every version: status, fields, pinned rule versions, editors, revision | unique (`scheme_ref`, `version_no`); at most one published and one open per scheme; content changes only while `draft` |
| `rule_versions` | Every version of every shared rule | append-only |
| `field_changes` | The change log | append-only |
| `workflow_events` | created, submitted, sent back (with comment), published, superseded, discarded | append-only |
| `review_flags` | "Shared rule changed, please review this scheme" | |

### Field format

Every scheme field is stored in the format the brief asks for:

```json
{
  "scheme_ref": "SYN-MH-002",
  "field": "benefit_amount",
  "value": 25000,
  "evidence": {
    "text": "one-time grant of Rs. 25,000",
    "location": "Para 2",
    "source_ref": "synthetic: Maharashtra WCD Government Resolution 2025-06 (PDF)",
    "captured_at": "2026-10-01"
  },
  "confidence": 0.9,
  "status": "found",
  "note": null,
  "candidates": null
}
```

The principle "every fact points back to its source" is enforced by the server:

- `found`: needs a valid value, full evidence (text, location, source, date) and a confidence from 0 to 1.
- `not_found`: the value must be empty, and a `note` must say why.
- `conflict`: the value stays empty, and `candidates` keeps **every** value with its own evidence. A scheme with a conflict **cannot be published** until a reviewer picks one value.

Fields allowed: `name`, `benefit_amount` (INR), `benefit_frequency` (`one_time` / `monthly` / `yearly`), `instalments`, `deadline` (YYYY-MM-DD), `required_documents`, `application_steps`.

### API reference

Write requests need an `X-User-Id` header (`asha`, `ravi`, `meera`, `vikram` or `neha`). This stands in for a real login.

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/schemes` | anyone | Read API: all published schemes |
| `GET /api/schemes/:ref` | anyone | Read API: one published scheme, with each eligibility rule at the version it was approved with |
| `GET /api/staff/schemes` | reviewers | Every scheme with its published and open versions |
| `GET /api/schemes/:ref/versions` and `/versions/:no` | reviewers | All versions, including drafts |
| `GET /api/schemes/:ref/history` | reviewers | Field changes and workflow events |
| `GET /api/schemes/:ref/diff` | reviewers | Before-and-after of the open draft against the published version |
| `GET /api/schemes/:ref/flags` | reviewers | Rule-change flags for one scheme |
| `GET /api/review-queue` | reviewers | Versions in review and open flags |
| `GET /api/rules`, `/api/users`, `/api/meta` | reviewers | Shared rules, users, and the field catalogue |
| `POST /api/schemes` `{scheme_ref}` | State | Create a new scheme (v1 draft) |
| `POST /api/schemes/:ref/draft` | State | Start a new draft from the published version |
| `PUT /api/schemes/:ref/draft/fields` `{field record}` | State | Set one field |
| `PUT` or `DELETE /api/schemes/:ref/draft/rules/:code` | State | Attach a shared rule (latest version), or remove it |
| `POST /api/schemes/:ref/draft/submit` | State | Send for review |
| `DELETE /api/schemes/:ref/draft` | State | Discard the draft |
| `POST /api/schemes/:ref/draft/send-back` `{comment}` | Central | Send back with a comment |
| `POST /api/schemes/:ref/draft/publish` `{revision}` | Central | Approve and publish the revision you reviewed |
| `POST /api/rules`, `POST /api/rules/:code/versions` | Central | Create a rule, or change one (this flags the schemes that use it) |
| `POST /api/flags/:id/dismiss` `{note}` | Central | Keep the old rule version for one scheme, with a reason |
| `POST /api/reset` | anyone (off in production) | Reset to the synthetic demo data |

Errors come back as `{ "error": "...", "message": "..." }`. The status codes are `403` not allowed, `404` not found, `409` wrong state (for example "in review, cannot edit"), `422` invalid input and `400` bad JSON. The messages are written so the reviewer can read them in the UI.

---

## 4. Key decisions, and the options I decided against

1. **MongoDB instead of PostgreSQL.** The brief prefers PostgreSQL. I work with the MERN stack and can explain and change MongoDB code myself, which the brief asks for. *Gave up:* PostgreSQL's stronger built-in constraints (foreign keys, triggers). I make up for it with partial unique indexes, transactions, conditional updates and model hooks. The same design maps directly to PostgreSQL tables.
2. **Versions as separate documents, not one big document per scheme.** Keeping all versions and history inside one scheme document would make every update atomic without transactions. But history grows forever, and MongoDB documents have a 16 MB limit. *Gave up:* simplicity. Publishing needs a multi-document transaction.
3. **An in-memory MongoDB when no database address is given.** Reviewers can run the app without Docker or a MongoDB install. *Gave up:* data does not survive a restart unless `MONGODB_URI` is set.
4. **One open draft per scheme, not several drafts in parallel.** Parallel drafts would need someone to merge two corrections, which is easy to get wrong. *Gave up:* two people cannot correct the same scheme at the same moment.
5. **Schemes are tied to a rule version, and a rule change only creates flags.** I decided against updating every scheme automatically when a shared rule changes. That would change what agents see without a review, which the brief rules out. *Gave up:* someone has to review each flagged scheme. That is on purpose.
6. **Approval is tied to a revision number.** The reviewer approves the revision they looked at. If the draft was sent back, edited and resubmitted in between, publishing is refused. The same check stops two reviewers publishing at the same time: only one succeeds.
7. **Four-eyes covers editors too.** The brief says the creator cannot approve. I also block anyone who **edited** the version, because a person with both roles could otherwise edit someone else's draft and approve their own change.
8. **Conflicts block publishing.** I decided against picking one of the two values automatically. A person has to choose.

---

## 5. Assumptions

- **Users and login:** login is out of scope. The user comes from an `X-User-Id` header, and the UI has an "Acting as" menu. A real system would use proper login (for example SSO or JWT).
- **One person can hold both roles.** The brief does not rule this out, and it is the case where the "cannot approve your own draft" rule matters most.
- **State reviewers can edit any scheme.** I did not limit a Maharashtra reviewer to Maharashtra schemes. The brief does not say how central schemes are assigned.
- **Only Central reviewers change shared rules,** because one change affects schemes in many states. A rule change does not need its own approval step, because no scheme shows it until that scheme is reviewed and approved again.
- **A scheme's eligibility is a list of shared rules, and all of them must hold (AND).** OR logic and parsing messy rule text belong to S2.
- **Each shared rule is one condition** (concept, operator, value). For example `annual_family_income < 250000`.
- **Amounts are in INR,** and confidence is a number from 0 to 1.
- **Dismissing a flag** means "this scheme keeps the old rule version on purpose". Long term, such a scheme should get its own rule.
- **All schemes, amounts, documents and sources are synthetic.** Sources use placeholder names instead of links, as the brief allows.

---

## 6. What I left out on purpose

- Real login and per-state permissions.
- A separate test framework. `npm run demo` checks every rule through the real API and exits with code 1 if any check fails.
- Pagination, search and rate limits on the read API.
- Any AI model. This backend receives drafts. It does not create them.
- Deployment setup (hosting, environment configs, monitoring).

## 7. Where it falls short, and how you would notice

- **No real security.** Anyone can send any `X-User-Id`. A security review would catch this straight away.
- **In-memory data by default.** It resets on restart. Set `MONGODB_URI` to keep it.
- **Guards live in the app, not the database.** MongoDB has no triggers like PostgreSQL. The locks are model hooks and conditional updates, so someone with direct database access could still change a published version. A database audit would show it. A fix is to give the app a database user with limited write rights, plus a scheduled check that compares published versions with their logged history.
- **A rule change can create a huge review queue.** At scale, the review queue would show hundreds of open flags and Central reviewers would fall behind. See section 8.
- **Field values are only checked for type,** not plausibility. A typo like ₹2,50,000 instead of ₹25,000 would pass if it has a source. The reviewer would only notice in the diff.
- **Confidence is stored and shown, but not used.** A low-confidence value can still be published.

---

## 8. Walkthrough notes

**Explaining versioning to a non-technical programme head:**
Think of a notice board at the panchayat office. The notice on the board is what everyone reads, and that is the published version. When the amount changes, a researcher writes a new notice at their desk, which is the draft. The old notice stays on the board until a second person checks the new one and signs it. Only then is it swapped. The old notice goes into a file, so we can always see what was on the board on any date and who changed it.

**What I expect to break first at 5,000 schemes:**
1. **The review queue after a shared-rule change.** A rule like "income below ₹2.5 lakh" may be used by hundreds of schemes. One change floods Central reviewers with flags. The fix: bulk review of identical changes, plus a queue sorted by impact (for example, schemes with near deadlines first).
2. **Rule-change scanning.** Finding the schemes that use a rule needs an index on the pinned rules. Without it, every rule change scans all versions.
3. **The read API.** It returns everything with no pagination or caching. The agent app would need paging, and caching of published versions (they never change, so they cache well).
4. **One draft per scheme.** It becomes a bottleneck when a state issues many corrections at once.

---

## 9. Use of AI tools

- I built this with **Claude Code (Claude Opus 5.5)** as a coding assistant. I used it to read and summarise the brief, discuss the design, write the code and README, and run the checks. I first built an in-memory version, then moved it to the MERN stack.
- I made the main choices myself: which problem to pick (S1), the stack (MERN in TypeScript), and no separate test framework.
- **The app itself uses no AI model, so the AI cost per scheme is ₹0.**
