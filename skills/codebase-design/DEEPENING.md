# Deepening

How to deepen a cluster of shallow modules given its dependencies. Uses the
vocabulary in [SKILL.md](./SKILL.md): module, interface, seam, adapter.

## Dependency categories

Classify each dependency of a candidate. The category fixes how the deepened
module is tested across its seam.

1. **In-process**: pure computation or in-memory state, no I/O. Merge the
   modules and test through the new interface. No adapter.
2. **Local-substitutable**: a dependency with a local test stand-in (PGLite for
   Postgres, an in-memory filesystem). Deepen when the stand-in exists. The seam
   is internal; the external interface has no port.
3. **Remote but owned**: your own service across a network boundary. Define a
   port (interface) at the seam; the deep module owns the logic and receives the
   transport as an adapter. Tests use an in-memory adapter; production uses an
   HTTP, gRPC, or queue adapter.
4. **True external**: a third-party service (Stripe, Twilio). The module
   receives the dependency as an injected port; tests provide a mock adapter.

## Seam rules

1. One adapter is a hypothetical seam. Two adapters make a real one. Introduce
   no port unless at least two adapters are justified, typically production and
   test.
2. A deep module can have internal seams, private to its implementation and used
   by its own tests. Do not expose an internal seam through the interface.

## Testing: replace, do not layer

1. Delete unit tests on the old shallow modules once tests exist at the deepened
   module's interface.
2. Write new tests at the interface. The interface is the test surface.
3. Assert observable outcomes, never internal state.
4. A test that must change when the implementation changes was testing past the
   interface.
