# Writing a new adapter

The broker is built around ports (interfaces) and adapters
(implementations). Adding a new backend means writing one adapter file,
registering it in the container, and adding a single line of test setup
so the contract suite runs against it.

## Recipe

1. **Pick the port.** All ports live under `src/ports/`. The two most
   common targets:
   - `JobStore` — persistence
   - `JobDispatcher` — queueing / wake-up
2. **Create the adapter file.** Put it under `src/adapters/<kind>/<name>.ts`.
   Implement the port methods exactly. Don't add public methods that
   aren't on the port — services should only see what the port exposes.
3. **Wire it in `src/lib/container.ts`.** Add a case to the relevant
   switch (currently `buildJobStore` for stores; the dispatcher branch
   already exists). Use dynamic `import()` for adapters with heavy or
   optional native dependencies.
4. **Run the contract tests.** Create
   `tests/adapters/<kind>.<name>.spec.ts` and call
   `runJobStoreContract('YourName', async () => ({ store, cleanup }))`
   (or `runJobDispatcherContract` for dispatchers). The shared contract
   already covers atomicity, idempotency, filtering, and TTL.
5. **Document the configuration knob.** Update `config/schema.ts` to
   accept the new driver enum and any extra fields. Update
   `config/default.yaml` with a commented example.

## Worked example: Postgres `JobStore`

The skeleton is already present at
`src/adapters/job-store/postgres.ts` and throws "not implemented".
What's needed:

- Add `pg` (or `postgres`) to dependencies.
- Translate `migrations/001_init.sql` to Postgres DDL (`TEXT` ↔ `text`,
  `INTEGER` ↔ `bigint`, `*_json TEXT` → `*_json jsonb`).
- Re-implement each method against the contract. Reach for `pg`'s
  parameterized queries directly; don't bring in an ORM.
- Implement `subscribe(handler)` with `LISTEN/NOTIFY` so the
  dispatcher can stop polling.
- Run `npx vitest run tests/adapters/job-store.postgres.spec.ts` (you
  add that file).

## Worked example: BullMQ `JobDispatcher`

- `notifyPending(sessionId, jobId)` becomes a `queue.add()`.
- A BullMQ `Worker` consumes the queue and calls into the broker's
  dispatch path (via a small in-broker handler the worker can reach,
  typically over the unix socket or in-process if co-located).
- The worker is responsible for honoring serial mode (one in-flight
  per session). Use BullMQ's group keys feature or maintain the same
  `busy` set the in-process dispatcher uses.
- Contract tests in `tests/adapters/contract/job-dispatcher.contract.ts`
  apply unchanged.

## Tips

- **Stay strict.** Don't return `unknown` where a port says `string`.
- **No singletons.** Constructors take their dependencies. Tests should
  be able to make a fresh adapter per test.
- **No business logic.** If you reach for it, the logic belongs in
  `JobService`, not in the adapter.
