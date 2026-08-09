# Publication Notes — What Was Published, and What Was Redacted

This document records exactly what was pushed to the public GitHub repository for the
Park Avenue Bot project, what was withheld, and the reasoning behind each decision. It exists
so the published repository can be audited against a written record, and so the redaction
process itself can be described in academic write-ups.

Prepared 8 August 2026.

---

## 1. Summary

The bot is working production software: it records real customer payments against a real
company's QuickBooks Online books. Publishing it therefore required separating three
different categories of information:

| Category | Example | Decision |
|---|---|---|
| **Credentials** | OAuth tokens, API secrets, passwords | Never published |
| **Business-identifying operational data** | Bank account number, internal account IDs | Moved to configuration |
| **Project information** | Architecture, design rationale, source code | Published in full |

The guiding rule: **publish the engineering, withhold the operations.** A reader should be
able to understand, audit, and reproduce the system without learning anything that helps them
reach the company's accounts.

Critically, no functionality was removed to achieve this. Redaction was performed by moving
values out of source code and into an untracked configuration file, not by deleting or
disabling code. The published repository and the version the business runs are the *same
code*; they differ only in the contents of a `.env` file that was never published.

---

## 2. What was published

The public repository contains 29 files: the Slack bot, both API client modules, diagnostic
and test scripts, reporting scripts, the Slack app manifest, a dependency manifest, and
documentation.

Notable inclusions, and why they were judged safe:

- **`slack-bot.js`** — the complete bot, including its authorization model, confirmation
  state machine, and demo mode. Publishing security-relevant logic is deliberate: the design
  depends on secrets held in configuration, not on the logic being hidden.
- **`qbo.js`** — the QuickBooks client, including the OAuth refresh flow. It reads all
  credentials from environment variables and contains none.
- **`slack-app-manifest.yaml`** — the Slack app's requested permissions. Publishing this
  documents exactly what access the bot asks for, which is a transparency benefit.
- **`test-demo-flow.js`** — the test proving demo mode performs no writes.
- **`.env.example`** — the full list of required configuration keys with placeholder values,
  so the project can be reproduced without any real credential ever being exposed.

---

## 3. What was redacted, and how

### 3.1 Credentials — excluded entirely

Never committed at any point. These were excluded via `.gitignore` before the first commit,
so they do not exist in the repository's history either.

| Item | Location | Why |
|---|---|---|
| QuickBooks client ID and secret | `.env` | Grant API access to the company's books |
| QuickBooks access and refresh tokens | `.env` | Live session credentials |
| Fishbowl admin username and password | `.env` | Full inventory system access |
| Slack bot and app tokens | `.env` | Would allow impersonating the bot in the workspace |

Two additional files were found during the audit to contain live credentials and were
excluded:

- **`QBO-SETUP-PROMPT.html`** — contained a live QuickBooks refresh token, access token, and
  client secret in plain text. It had been generated earlier as a way to transfer setup
  instructions between machines.
- **`auth-out.txt`** — captured console output containing the QuickBooks client ID.

These are worth noting in any write-up: the credentials most at risk of accidental publication
were not in the obvious place (`.env`, which everyone knows to exclude) but in incidental
files created during debugging. An audit that only checks `.env` would have leaked them.

### 3.2 Business-identifying data — moved to configuration

These values were originally hardcoded in source. They are not credentials — none of them
grant access to anything — but each identifies the business's internal financial structure.
Each was replaced with an environment variable read from the untracked `.env`.

| Redacted value | Was in | Replaced with | Why it matters |
|---|---|---|---|
| A checking-account label naming the bank and the last four digits of the account | `bank-deposit.js` | `QBO_CHECKING_ACCOUNT_NAME` | Identifies the company's bank and operating account |
| The checking account's numeric ID | `bank-deposit.js` | `QBO_CHECKING_ACCOUNT_ID` | Internal chart-of-accounts identifier |
| The Undeposited Funds account's numeric ID | `bank-deposit.js`, `slack-bot.js` | `QBO_UNDEPOSITED_FUNDS_ID` | Internal chart-of-accounts identifier |
| `C:/Users/<user>/OneDrive/Documents/InvQtys.csv` | 3 reporting scripts | `INVENTORY_CSV_PATH` | Exposed an operating-system username and local directory structure |
| A named customer used in help text | `slack-bot.js`, `README.md` | Generic `<customer>` | Revealed a specific commercial relationship |

The bank account line was the single most sensitive non-credential item found. A bank name
combined with masked account digits is a standard input to social-engineering attacks against
a business's accounts payable, and it had been sitting in source purely as a convenience label.

### 3.3 Internal documentation — excluded

- **`CLAUDE.md`** — the project's internal working notes. Excluded because it contains the
  company's QuickBooks realm identifiers, the Fishbowl server hostname and admin username,
  local filesystem paths, and notes on unresolved accounting discrepancies. None of this is a
  credential, but collectively it maps the company's systems.

### 3.4 Generated business data — excluded

- Sales reports (`*.pdf`), inventory exports (`*.csv`), and one-off scratch scripts
  (`_tmp_*.js`, `_process_road_ranger.js`) written during a June 2026 invoice-processing
  session. These contain real customer names, invoice numbers, and dollar amounts.

### 3.5 Deliberately *not* redacted

- **The company name and general business description.** Park Avenue Wholesale is identified
  in the repository. This is a real, attributable project, and the company's existence and
  line of business are already public. Anonymising it would have weakened the work's
  credibility without protecting anything.
- **Chart-of-accounts *concepts*.** That payments post to an "Undeposited Funds" account is
  standard double-entry bookkeeping and is documented publicly by Intuit. Only the specific
  numeric IDs were removed.

A note on this document itself: an early draft quoted the exact bank-account label it was
documenting as redacted, which would have republished the very string being withheld. It was
caught by re-running the same automated scan against the finished documentation. Redaction
notes are themselves a disclosure surface, and describing a withheld value is safe only when
the description does not reconstruct it.

---

## 4. Verification performed

Redaction was verified rather than assumed. Before the first commit, and again after the
redaction pass, every staged file was scanned for:

- Slack token prefixes (`xoxb-`, `xapp-`)
- QuickBooks refresh-token and JWT access-token patterns
- The literal client ID and bot token values read from the live `.env`
- Both QuickBooks company (realm) identifiers
- Bank name strings, masked account digits, and local user paths

Two matches in the final scan were investigated and confirmed to be false positives: a
base64 dependency-integrity hash in `package-lock.json` that coincidentally matched the client
ID pattern, and the placeholder values inside `.env.example` itself.

The distributed archive was produced with `git archive` directly from the committed tree,
guaranteeing that the reviewed archive and the published repository are identical rather than
merely similar.

After redaction, the bot was re-tested end to end to confirm that moving values into
configuration had not altered behaviour, and the running process was restarted so that it
would load the new configuration — a step that would otherwise have left it running with
blank account identifiers.

---

## 5. Limitations

Honesty about what this process does not guarantee:

- **Git history is permanent.** The credentials found in `QBO-SETUP-PROMPT.html` were excluded
  before the first commit, so they never entered history. Had they been committed and later
  removed, deleting them would not have been sufficient — the tokens would have needed to be
  revoked and reissued.
- **Redaction is only as good as the audit.** The scan used known patterns. A credential in an
  unanticipated format could pass it.
- **Public means permanent.** Once published, the repository should be assumed to be
  permanently public regardless of later deletion, because of forks, caches, and archiving
  services.
- **The bot's security rests on configuration, not obscurity.** Anyone reading the published
  source knows exactly how authorization works. This is intentional and is the correct model,
  but it means the allowlist and the secrecy of `.env` are doing the real work.
