# Reps development contract

## AI capability parity is the product

Reps is not a UI with an assistant attached. The human UI and the AI are two clients of the same typed command surface. Every product feature must be fully operable and inspectable by the AI.

Before implementing or extending a feature:

1. Inventory the existing commands, selectors, and external data tools. Reuse capabilities that already exist instead of creating a parallel path.
2. Write the AI workflow first: list the read/search/filter tools the AI needs to understand the state, then the write commands it needs to act.
3. Add or extend those typed commands before building the UI. UI event handlers must dispatch through `run()`/`useRunCommand()`.
4. Give the AI discovery tools, not hidden application decisions. If a feature uses a catalog or API, expose list/search/filter/facet commands and let the AI decide which tools to call and how to use their results. Code may validate permissions, IDs, schemas, safety constraints, and invariants; it must not silently make product decisions on the AI's behalf.
5. Make every meaningful value shown in the UI available through a read command backed by the same selector.
6. Verify the complete AI path, not only the button path: the AI must be able to discover IDs, inspect relevant state, perform the action, and read back the result.

Definition of done for every feature:

- There is no UI-only domain action.
- Every registered product command is automatically exposed as an AI tool.
- Required IDs and options are discoverable through typed list/search/filter/facet commands.
- Tool descriptions and schemas are sufficient for the AI to use without guessing.
- UI and AI writes use the same command handler, validation, audit log, and undo behavior.
- `npm run parity`, `npm run build`, and `npm run lint` pass.

Credential entry and ephemeral presentation state (for example, whether a dialog is visually open) are security/UI boundaries, not domain features. They may remain local, but any domain state or behavior behind them must still have command parity.
