# Local vault creation: development console checks

Run typecheck, tests, and build from the repository root. Stop the dev server
before building. Reload Siteward at `chrome://extensions`, reopen the side panel,
and open **the side panel's Inspect console**.

Use a disposable development password and vault for these checks. Console input
and results expose the test password and recovery key in DevTools history.
These commands create local data only; they do not create a backend account.

## Check the starting state

```js
await chrome.runtime.sendMessage({ channel: "siteward", type: "session.lock" });
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.discover",
});
```

Start the creation checks in a development profile with `vaultIds: []`. If a vault
already exists, creation returns `VAULT_ALREADY_EXISTS`; it never overwrites it.
Use a separate Chrome development profile for another fresh creation flow.

## Prepare without saving

```js
var creation = await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.create.prepare",
  password: "Siteward disposable development password",
});
creation;
```

Expected: `ok: true`, type `vault.create.prepare`, a `token`, `vaultId`, and
printable `recoveryKey`. Copy the development recovery key somewhere you can
refer to for this check. New master passwords require at least 12 characters;
passwords are not trimmed.

```js
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.discover",
});
```

Expected: still `vaultIds: []`. Preparation has not persisted anything.

## Verify cancellation and stale confirmation

```js
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.create.cancel",
});
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.create.confirm",
  token: creation.token,
  recoveryKeySaved: true,
});
```

Expected: successful cancellation followed by `CREATION_EXPIRED`.
An authorized `session.lock` also discards unconfirmed creation.

## Prepare again and confirm

```js
creation = await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.create.prepare",
  password: "Siteward disposable development password",
});
creation;
```

This generates a new vault and a new recovery key. Save this new development key
before continuing. Do not reuse the cancelled key.

```js
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.create.confirm",
  token: creation.token,
  recoveryKeySaved: false,
});
```

Expected: `INVALID_REQUEST`. This invalid request does not consume the token.

```js
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.create.confirm",
  token: creation.token,
  recoveryKeySaved: true,
});
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.discover",
});
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "session.status",
});
```

Expected: confirmation returns `ok: true` and the new `vaultId`; discovery returns
that ID; session status remains `locked`.

`recoveryKeySaved: true` is the user's acknowledgement, not proof that a file was
saved. The screen will need to explain this before sending confirmation.

## Unlock and lock the persisted vault

```js
var catalog = await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.discover",
});
var developmentVaultId = catalog.vaultIds[0];

await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.unlock",
  vaultId: developmentVaultId,
  password: "Incorrect development password",
});
```

Expected: `UNLOCK_FAILED`; the session remains locked.

```js
await chrome.runtime.sendMessage({
  channel: "siteward",
  type: "vault.unlock",
  vaultId: developmentVaultId,
  password: "Siteward disposable development password",
});
await chrome.runtime.sendMessage({ channel: "siteward", type: "vault.list" });
await chrome.runtime.sendMessage({ channel: "siteward", type: "session.lock" });
await chrome.runtime.sendMessage({ channel: "siteward", type: "vault.list" });
```

Expected: unlocked session; `sites: []`; locked session; `VAULT_LOCKED`.
Run the first list within the 60-second development unlock period.

## Restart and race behavior

- Before confirmation, a worker restart loses the pending setup. Old tokens then
  return `CREATION_EXPIRED`. Discover again and prepare a fresh vault if empty.
- After confirmation, extension reload preserves the encrypted setup in IndexedDB
  and clears the session. Discover and unlock using the saved development password.
- A duplicate prepare while preparing or awaiting confirmation returns
  `CREATION_BUSY`. Cancellation lets you start over after in-flight derivation
  finishes; it does not interrupt Argon2 computation.
- Before the confirmed save starts, cancellation prevents persistence. Once the
  database save starts, explicit cancellation returns `CREATION_BUSY`; the save
  finishes with a locked vault. Lock still locks the session during this phase.
- If confirmation loses its response or fails around a worker restart, discover
  first: the database transaction may have committed. Never infer that a vault
  was deleted from a missing response.

The automated tests cover these races with controlled pauses. UI screens and
the password-recovery/reset message flow are separate upcoming work.
