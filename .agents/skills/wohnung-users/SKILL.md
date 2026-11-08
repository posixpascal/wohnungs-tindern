---
name: wohnung-users
description: Manages the logins of the swipe app — add a user, list users, reset a password, remove a user — locally or on the deployed server. Use when the user says "benutzer anlegen", "user hinzufügen", "neuer login", "passwort vergessen", "passwort zurücksetzen", "user löschen", "wer hat einen account", "add user", "reset password", "remove user" or runs /wohnung-users.
---

# Wohnung Users

Run everything from the repository root. One account per person; a listing becomes a
**match** when every user has liked it.

## Hard rule: you never see or choose passwords

Never ask for, suggest, generate, type, pipe or echo a password. Every command that takes a
password (`user add`, `user passwd`) is run **by the human in their own terminal**, where the
CLI shows a hidden double prompt (≥ 12 characters):
- Claude Code: tell them to type `! <command>` in the prompt (the `!` prefix runs it directly,
  outside of you). If the hidden prompt doesn't accept input there, they run it in a separate
  terminal in the repo.
- Other agents: tell them to run it in their own terminal in the repo.

Then wait for them to say it's done and verify with the list command. Listing and removing
take no app password, so you may run those yourself — except on the server when `sudo` asks
for a password: never ask for it, hand the command to the human like above.

## 1. Pick the target

- **Local** (default): the app started with `bun run dev`, DB from the root `.env`.
- **Server**: when the user says so ("auf dem Server", "live", "online", "für die echte App")
  or the app is deployed (`deploy.mk` has `DEPLOY_HOST`) and they clearly mean the app they use
  on their phones. If unclear, ask once: "Lokal oder auf dem Server?"

| Action | Local | Server |
|---|---|---|
| List | `bun run users` | `make remote-cli ARGS="user list"` |
| Add (human runs it) | `bun run user <name>` | `make remote-cli ARGS="user add <name>"` |
| New password (human runs it) | `bun run passwd <name>` | `make remote-cli ARGS="user passwd <name>"` |
| Remove | `bun run user-remove <name>` | `make remote-cli ARGS="user remove <name>"` |

`make remote-cli` runs `ssh -t <DEPLOY_USER>@<DEPLOY_HOST> 'sudo wohnung-cli …'` (values from
`deploy.mk`; no `sudo` as `root`); the hidden password prompt works through it. If `DEPLOY_HOST` is missing, point
the user to the `wohnung-deploy` skill.

The list shows id, name, created, number of swipes and number of active sessions.

## 2. Add a user

1. Run the list first; if the name exists, say so and stop.
2. Suggest a simple lowercase name without spaces (`alex`, `sam`) — it's what they type on the
   login screen.
3. Explain the match effect before adding (German, one sentence): with a third person, a flat
   only becomes a match once **all three** have liked it, and existing matches stay incomplete
   until the new user likes them too. Don't create test accounts on the live app — they block
   matches.
4. Hand over the command from the table (human runs it), e.g. `! bun run user alex`.
5. Verify with the list.

## 3. Reset a password

Hand over the `passwd` command (human runs it). Setting a new password logs that user out on
every device; tell them to log in again with the new one. Verify with the list (active sessions
for that user = 0).

## 4. Remove a user

Removing deletes the user, all their sessions and **all their swipes** — no undo, and the CLI
does not ask again. Before running it, ask in German and wait for an explicit yes that names
the user, e.g.:

> „Soll ich **sam** wirklich löschen? Dabei werden auch alle Swipes von sam (laut Liste: 214)
> gelöscht. Das lässt sich nicht rückgängig machen.“

Only after "ja, sam löschen" (or equivalent) run the remove command, then the list. Mention
that matches are recomputed from the remaining users: listings liked by everyone left can now
show up as matches. On the server, offer `make backup` first (downloads the latest nightly snapshot).

## Summary (German, short)

Ziel (lokal/Server), was geändert wurde, aktuelle Benutzerliste (Name, Swipes, Sessions).
