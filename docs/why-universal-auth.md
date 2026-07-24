# Universal Auth — what it is and why

The short version: **one login for all our internal tools.** You sign in with your FieldPulse Google account, and you get into whichever internal apps you're supposed to have. That's it.

This is the plain-language version. If you're building against it, [`architecture.md`](architecture.md) is the technical one.

## The problem today

Every internal tool we've built handles its own login. Most have Google sign-in wired up separately, app by app. A few sit behind a single username and password that gets shared around.

That causes four real problems:

**We can't remove one person's access.** A shared password can't be revoked for an individual — the only way is changing it for everyone, which in practice means it never gets changed. So the passwords we're sharing today are the passwords we were sharing a year ago.

**Offboarding depends on memory.** When someone leaves, taking away their access means going into every app one at a time and remembering which ones exist. Miss one and it stays open indefinitely.

**Every new project rebuilds login from scratch.** It's a day of work each time, done slightly differently each time, and it's the least interesting day of building any tool.

**Nobody can answer "who has access to what."** There's no list. The answer lives across a handful of dashboards and a few people's heads.

## What we're building

One Supabase project whose only job is answering "who is this person, and what are they allowed to use."

Every internal app asks it instead of handling logins itself. Behind it is a single table listing who can use which app, and at what level — regular access or admin.

That gives us:

- **Granting access is one row.** Someone needs the Comp Intel dashboard? Add a line. They have it.
- **Offboarding is one action.** Disable the person once, and every app stops letting them in. Nothing to remember, nothing to go hunting for.
- **New projects get auth in about half an hour.** Install one package, set two settings, done. This matters more as more of us start building our own tools.
- **There's finally a list.** One place that answers who can access what.

No passwords anywhere. Everything goes through your FieldPulse Google account, and only `@fieldpulse.com` accounts can sign in at all — Google itself rejects anyone else before the request reaches us.

## Why it gets its own Supabase project

This is the question worth answering directly, because "just put it in one of our existing projects" sounds simpler.

**Blast radius.** The moment app data lives next to the login data, a bad migration or a misconfigured permission on some dashboard's tables can take down sign-in for *every* internal tool at once. Keeping the auth project empty of app data means it's boring: nothing routine ever needs to change in there, so nothing routine can break it.

**It's shared infrastructure, not one team's tool.** If it lived inside the Comp Intel project, then Comp Intel would somehow own everyone's login. Its own project makes it clear this belongs to all of us.

**Your app's data doesn't move.** Worth being clear about — each app keeps its own Supabase project and its own tables. Nothing gets migrated or consolidated. The only thing changing is where apps go to ask who you are.

We're staying on Supabase rather than bringing in something like Clerk or Auth0 because we already know Supabase well, it costs effectively nothing at our size, and it sits right next to the projects our data already lives in. The alternatives are priced per person and would mean learning and maintaining a new vendor for a problem we can solve with tools we already use.

## How it connects together

```
        You sign in with Google
                  │
                  ▼
      ┌─────────────────────────┐
      │   fieldpulse-auth       │   ← the one place that knows
      │   who you are + what    │      who you are and what
      │   you're allowed to use │      you can use
      └───────────┬─────────────┘
                  │
      ┌───────────┼───────────┬──────────────┐
      ▼           ▼           ▼              ▼
  Comp Intel  Juju admin  Email agent   whatever we
  dashboard               dashboard     build next
```

Each app gets a signed pass proving who you are and what you're allowed to do. Apps can check that pass is genuine on their own, without calling home — which is why adding a new app is cheap and why one app being slow never affects another.

## What changes for you

**Right now, nothing.** Every tool you use today keeps working exactly as it does.

As we migrate each app, the only difference you'll notice is that its login screen becomes "Sign in with Google" — and if you're already signed in elsewhere, usually you won't see a login screen at all.

The first app to move is the **Comp Intel Dashboard**. After that we'll prioritize the tools currently behind shared passwords, since those are the ones with a real security gap. Everything else migrates whenever someone happens to be working in it. There's no deadline and no scramble — old logins keep working until each app is actually moved.

If you're **starting a new internal tool**, use this from day one and skip building login entirely. Ask and we'll point you at it.

## What's not affected

- **Customer-facing products.** Relay and the onboarding app are for customers, not employees. They're out of scope entirely and won't be touched.
- **Bots and agents.** Juju and the email agent sign in as *services*, not as people. They keep their own credentials. This system is for humans in browsers.

## One honest caveat

When we disable someone, they stop being able to get a new pass immediately — but a pass they're already holding stays valid until it expires, up to an hour. So "access removed" means "within the hour" rather than "this instant."

That's a deliberate trade: it's what lets apps verify passes on their own without a constant round trip, which is what makes the whole thing fast and cheap to add. For internal tools it's the right call, and it's still an enormous improvement over a shared password that never changes. If we ever have a tool that needs instant cutoff, we can turn that on for just that tool.

## Following along

Scoped out in Linear under **Internal AI → [Universal Auth](https://linear.app/fieldpulse/project/universal-auth-2ac2b97ce2dd)**. Code and docs live in [`Universal_auth`](https://github.com/hamza-saraswat-fp/Universal_auth).
