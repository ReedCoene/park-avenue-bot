# How We Built This — Process & Lessons

A plain-English walkthrough of what this bot is, how we ended up building it the way
we did, and the walls we hit along the way. Deliberately kept high-level — it's meant
to give you (and your Claude) the *shape* of the thing before you dig into the code.

---

## What it is (in one breath)

A single AI assistant that lives in **Slack**. People at a business talk to it like a
coworker — "how many size-L vests do we have?", "who's overdue?" — or they drop a photo
of an invoice into the chat and it reads every line and drafts the entry. It's wired into
the company's **inventory system (Fishbowl)** and **accounting (QuickBooks)** so it can
actually look things up and, once a human clicks **Approve**, write things back.

It replaced a real, boring, painful job: staff retyping stacks of paper invoices by hand.

---

## How we got here (the process, roughly)

**1. We started with the wrong product.**
The first attempt put an AI tool directly on each employee's computer. It technically
worked. Almost nobody used it. The lesson landed hard: *the fanciest setup is worthless
if people won't touch it.* Non-technical staff don't want a new app or a terminal — they
want to talk to something in a place they already live.

**2. The pivot: meet people where they already are.**
So we threw out "one tool per computer" and built **one central bot in Slack**. Everyone
already understands chat. No installs, no logins, no training. That single decision is the
reason it actually gets used, and it's the biggest thing we'd tell anyone copying this.

**3. One bot, one set of company connections.**
Instead of every machine connecting to the company's systems, the bot connects **once**,
centrally, over the internet, and everyone reaches it through Slack from any device —
phone or desktop. Think of it as a coworker who happens to have all the logins, rather
than software you install.

**4. Read first, let a human approve any write.**
The bot is allowed to *look at* anything, but anything that changes the books gets drafted
and shown as a card with an **Approve** button. A person clicks before money-side data
moves. This kept it trustworthy and made it an easy "yes" for the people who own the
numbers. We'd never let it post financial records unattended.

**5. Lock down the sensitive stuff by *who*, not by *where*.**
Everyone can use the inventory/lookup features. Only a couple of trusted people can pull
financials or post to accounting. That's enforced in software (an allowlist), not by which
computer it runs on.

**6. Put it in the cloud so it never sleeps.**
For a quick demo it can run on any always-on PC. For real use we moved it to a cheap
cloud host so it runs 24/7, survives reboots, and isn't tied to anyone's laptop — with all
the passwords stored as encrypted settings, not sitting in a file on a desk.

---

## The walls we hit (and what they taught us)

- **Adoption was the hard part, not the tech.** The very first version worked and still
  failed, purely because it was in a place people wouldn't go. Almost every real lesson
  traces back to this.

- **Two systems, two completely different personalities.** The accounting side connected
  cleanly and even heals itself when its access expires. The inventory side was the
  opposite — poorly documented, quirky, and we had to *figure out how to talk to it by
  experiment*, poking at it until we understood what it wanted. Expect one integration to
  be smooth and another to fight you; budget time for the stubborn one.

- **Some doors are simply locked.** We learned the hard way that certain things we wanted
  the bot to do just aren't possible through the connection the system exposes — the door
  is read-only no matter how you knock. When you hit one of those, stop pushing and design
  *around* it (hand the human a ready-to-import file instead of forcing a write). Don't
  burn days trying to pick a lock the vendor welded shut.

- **The inventory system only allows so many people logged in at once.** The bot takes up
  one of those slots and holds it. Early on, us testing over and over kept knocking the
  live bot offline by eating all the slots. Fixes: give the bot its *own* dedicated login,
  have it hold a single connection open instead of reconnecting constantly, and back off
  politely instead of hammering when something fails. If a system has a seat limit, treat
  those seats as precious.

- **A dumb one-line bug cost us two deploys.** At one point the bot was finding the right
  answer and then throwing it away because of a leftover placeholder line that overwrote
  every real reply. We wasted time *guessing* where the problem was. The lesson: when
  something misbehaves, trace what's actually happening step by step instead of assuming —
  the real cause is often boring and upstream of where it looks.

- **Never let secrets touch a chat window.** Passwords and keys get typed straight into
  the settings file, rotated if they were ever exposed, and stored encrypted in the cloud
  host — never pasted into a conversation, never committed anywhere.

---

## The philosophy, if you keep one thing

Make it **boring to use and safe to trust.** Put the AI where people already are, let it
read freely but ask permission before it changes anything important, connect once in the
center instead of everywhere, and design gracefully around the things you're not allowed
to do. The clever model is the easy part — everything above is what made it actually stick.

---

## What's in this folder & how to start

This is the real, working bot, minus the live passwords (those were stripped out on
purpose). To bring it up on your machine:

1. Read **`README.md`** — the setup-once, ~10-minute guide (create the Slack app, run it).
2. Copy **`.env.example`** to a new file named **`.env`** and fill in your own keys —
   your Slack app tokens, an Anthropic API key, and your own QuickBooks/Fishbowl logins.
3. **`CONNECT-CHECKLIST.md`** walks through wiring up QuickBooks and Fishbowl step by step.
4. Run `npm install` then `npm start`.

Everything here is generic — none of it is tied to the original client except the example
values you'll replace with your own. Hand this whole folder to your Claude and it can take
it from here.

> ⚠️ You will need your own accounts to make it live: a Slack workspace, an Anthropic API
> key, and login/API access to whatever QuickBooks + Fishbowl (or similar) systems you're
> connecting. The code is the easy 90%; the accounts and permissions are the other 90%.
